/**
 * Unified CV analysis pipeline.
 * Single entry point that orchestrates all math modules:
 *   smoothing → derivative → baseline → peak detection on corrected signal
 *
 * Components and App.tsx should ONLY call analyzeCVScan() — no math outside src/math/.
 */

import { applySmoothing } from './smoothing-pipeline';
import { calculateDerivative } from './derivative-pipeline';
import { computeBaseline } from './baseline-fitting';
import { simpsons, trapz, type DataPoint2D } from './integration';
import type { DataPoint, AnalysisConfig } from '../types';

export interface CVPeakResult {
  index: number;            // Discrete index of peak apex in smoothed array
  potential: number;        // Interpolated peak potential (V) — parabolic fit for sub-index precision
  current: number;          // Smoothed current at peak apex (A)
  rawCurrent: number;       // Current before baseline correction (A) — for Ipa/Ipc reporting
  height: number;           // Baseline-corrected peak height |I_peak − I_baseline| (A)
  area: number;             // Integrated peak area (see chargeUnit for units)
  chargeUnit: 'C' | 'V·A'; // 'C' when time data available (Q=∫I·dt), 'V·A' otherwise (∫I·dE)
  startIndex: number;
  endIndex: number;
  startPotential: number;
  endPotential: number;
  type: 'oxidation' | 'reduction';
}

export interface CVScanResult {
  smoothed: DataPoint[];
  derivative: number[];
  baseline: DataPoint[];
  peaks: CVPeakResult[];
  warnings: string[];
}

/**
 * Analyzes a single CV scan (forward or reverse).
 *
 * Pipeline:
 *   1. Smooth raw data (Savitzky-Golay)
 *   2. Compute derivative dI/dE
 *   3. Compute rubberband baseline
 *   4. Subtract baseline → corrected signal
 *   5. Find all significant peaks in corrected signal
 *   6. For each peak, find boundaries & compute area
 */
export const analyzeCVScan = (
  scanData: DataPoint[],
  config: AnalysisConfig,
  scanDirection: 'forward' | 'reverse'
): CVScanResult => {
  const warnings: string[] = [];

  if (scanData.length === 0) {
    return { smoothed: [], derivative: [], baseline: [], peaks: [], warnings };
  }

  // Step 1: Smoothing (optional)
  let smoothed: DataPoint[];
  if (config.smoothingEnabled) {
    try {
      const smoothingResult = applySmoothing(scanData, config);
      smoothed = smoothingResult.smoothedData;
      warnings.push(...smoothingResult.warnings);
    } catch {
      smoothed = scanData;
      warnings.push('Smoothing failed, using raw data');
    }
  } else {
    smoothed = scanData;
  }

  // Step 2: Derivative (dI/dE)
  let derivative: number[];
  try {
    const derivativeResult = calculateDerivative(smoothed, config);
    derivative = derivativeResult.derivativeCurrent;
    warnings.push(...derivativeResult.warnings);
  } catch {
    derivative = new Array(smoothed.length).fill(0);
    warnings.push('Derivative calculation failed');
  }

  // Step 3: Baseline (rubberband, linear, or ASLS — per config)
  let baseline: DataPoint[];
  try {
    baseline = computeBaseline(smoothed, scanDirection, config);
  } catch {
    baseline = buildEndpointBaseline(smoothed);
    warnings.push('Baseline fitting failed, using endpoint interpolation');
  }

  // Step 4: Baseline-corrected signal
  const corrected = smoothed.map((p, i) => p.current - (baseline[i]?.current ?? 0));

  // Step 5: Find all significant peaks in corrected signal
  const peaks = findCVPeaks(smoothed, baseline, corrected, scanDirection, config.peakProminenceThreshold);

  return { smoothed, derivative, baseline, peaks, warnings };
};

// ---------------------------------------------------------------------------
// Peak detection on baseline-corrected signal
// ---------------------------------------------------------------------------

/**
 * Finds all significant peaks in the baseline-corrected signal.
 *
 * For forward (oxidation): peaks are positive excursions (current > baseline).
 * For reverse (reduction): peaks are negative excursions (current < baseline).
 *
 * Steps:
 *   1. Find all local extrema in corrected signal of the correct sign.
 *   2. Compute prominence for each.
 *   3. Filter by minimum prominence (5% of max corrected magnitude).
 *   4. For each surviving peak, walk outward to find boundaries where
 *      the corrected signal crosses zero (returns to baseline).
 *   5. Compute area via trapezoidal integration within boundaries.
 */
const findCVPeaks = (
  smoothed: DataPoint[],
  baseline: DataPoint[],
  corrected: number[],
  direction: 'forward' | 'reverse',
  prominenceThreshold: number = 0.05
): CVPeakResult[] => {
  const n = corrected.length;
  if (n < 5) return [];

  const isOxidation = direction === 'forward';

  // Find local extrema of the correct sign
  const candidates: { index: number; magnitude: number }[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (isOxidation) {
      // Oxidation peaks: local maxima in corrected signal where corrected > 0
      if (corrected[i] > corrected[i - 1] &&
          corrected[i] > corrected[i + 1] &&
          corrected[i] > 0) {
        candidates.push({ index: i, magnitude: corrected[i] });
      }
    } else {
      // Reduction peaks: local minima in corrected signal where corrected < 0
      if (corrected[i] < corrected[i - 1] &&
          corrected[i] < corrected[i + 1] &&
          corrected[i] < 0) {
        candidates.push({ index: i, magnitude: Math.abs(corrected[i]) });
      }
    }
  }

  if (candidates.length === 0) return [];

  // Minimum prominence threshold as fraction of max corrected magnitude
  const maxMag = Math.max(...candidates.map(c => c.magnitude));
  const minProminence = maxMag * prominenceThreshold;

  // Compute prominence for each candidate
  const withProminence = candidates
    .map(c => ({ ...c, prominence: computeProminence(corrected, c.index, isOxidation) }))
    .filter(c => c.prominence >= minProminence)
    .sort((a, b) => b.prominence - a.prominence);

  // Merge peaks that are too close (within minSeparation indices)
  const minSeparation = Math.max(5, Math.floor(n * 0.02));
  const merged = mergePeaks(withProminence, minSeparation);

  // Build CVPeakResult for each surviving peak
  const peaks: CVPeakResult[] = [];
  for (const peak of merged) {
    const { startIndex, endIndex } = findPeakBoundaries(corrected, peak.index, isOxidation);
    const height = Math.abs(corrected[peak.index]);

    // Precise peak potential via parabolic (3-point) interpolation on corrected signal
    const precisePotential = interpolatePeakPotential(smoothed, corrected, peak.index);

    // Charge: use time-based integration (Q=∫I·dt) when time data is available,
    // otherwise fall back to potential-based (∫I·dE) which has units V·A not Coulombs.
    const hasTime = smoothed[0]?.time !== undefined;
    const area = integratePeakArea(smoothed, baseline, startIndex, endIndex, hasTime);
    const chargeUnit: 'C' | 'V·A' = hasTime ? 'C' : 'V·A';

    peaks.push({
      index: peak.index,
      potential: precisePotential,
      current: smoothed[peak.index].current,
      rawCurrent: smoothed[peak.index].current,
      height,
      area,
      chargeUnit,
      startIndex,
      endIndex,
      startPotential: smoothed[startIndex].potential,
      endPotential: smoothed[endIndex].potential,
      type: isOxidation ? 'oxidation' : 'reduction'
    });
  }

  // Sort by potential (ascending for forward, descending for reverse)
  peaks.sort((a, b) => isOxidation ? a.potential - b.potential : b.potential - a.potential);

  return peaks;
};

/**
 * Computes prominence of a peak in the corrected signal.
 * Prominence = how far the peak rises above the higher of the two
 * lowest points on either side before reaching a higher peak.
 */
const computeProminence = (corrected: number[], peakIdx: number, isMax: boolean): number => {
  const peakVal = corrected[peakIdx];

  // Walk left to find the deepest valley before a higher peak
  let leftValley = peakVal;
  for (let i = peakIdx - 1; i >= 0; i--) {
    if (isMax) {
      leftValley = Math.min(leftValley, corrected[i]);
      if (corrected[i] > peakVal) break;
    } else {
      leftValley = Math.max(leftValley, corrected[i]);
      if (corrected[i] < peakVal) break;
    }
  }

  // Walk right
  let rightValley = peakVal;
  for (let i = peakIdx + 1; i < corrected.length; i++) {
    if (isMax) {
      rightValley = Math.min(rightValley, corrected[i]);
      if (corrected[i] > peakVal) break;
    } else {
      rightValley = Math.max(rightValley, corrected[i]);
      if (corrected[i] < peakVal) break;
    }
  }

  // Prominence = peak value minus the higher of the two valleys
  if (isMax) {
    return peakVal - Math.max(leftValley, rightValley);
  } else {
    return Math.min(leftValley, rightValley) - peakVal;
  }
};

/**
 * Merges peaks that are closer than minSeparation, keeping the more prominent one.
 */
const mergePeaks = (
  peaks: { index: number; magnitude: number; prominence: number }[],
  minSeparation: number
): { index: number; magnitude: number; prominence: number }[] => {
  if (peaks.length <= 1) return peaks;

  const result: typeof peaks = [];
  const used = new Set<number>();

  for (const peak of peaks) {
    if (used.has(peak.index)) continue;

    // Mark all nearby lower-prominence peaks as used
    let best = peak;
    for (const other of peaks) {
      if (other.index === peak.index || used.has(other.index)) continue;
      if (Math.abs(other.index - peak.index) < minSeparation) {
        used.add(other.index);
        if (other.prominence > best.prominence) {
          used.add(best.index);
          best = other;
        }
      }
    }

    result.push(best);
    used.add(best.index);
  }

  return result;
};

/**
 * Finds peak boundaries by walking outward from peak center until
 * the corrected signal crosses zero (returns to baseline).
 */
const findPeakBoundaries = (
  corrected: number[],
  peakIdx: number,
  isMax: boolean
): { startIndex: number; endIndex: number } => {
  const n = corrected.length;

  // Walk left until corrected crosses zero or we reach the edge
  let startIndex = peakIdx;
  for (let i = peakIdx - 1; i >= 0; i--) {
    if (isMax ? corrected[i] <= 0 : corrected[i] >= 0) {
      startIndex = i;
      break;
    }
    startIndex = i;
  }

  // Walk right
  let endIndex = peakIdx;
  for (let i = peakIdx + 1; i < n; i++) {
    if (isMax ? corrected[i] <= 0 : corrected[i] >= 0) {
      endIndex = i;
      break;
    }
    endIndex = i;
  }

  return { startIndex, endIndex };
};

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Builds a simple endpoint-interpolated baseline (line connecting first and last data points).
 * Used as fallback when rubberband baseline fails.
 */
const buildEndpointBaseline = (data: DataPoint[]): DataPoint[] => {
  if (data.length < 2) {
    return data.map(p => ({ potential: p.potential, current: 0 }));
  }

  const first = data[0];
  const last = data[data.length - 1];
  const potentialRange = last.potential - first.potential;

  if (Math.abs(potentialRange) < 1e-10) {
    const avg = (first.current + last.current) / 2;
    return data.map(p => ({ potential: p.potential, current: avg }));
  }

  const slope = (last.current - first.current) / potentialRange;
  const intercept = first.current - slope * first.potential;

  return data.map(p => ({
    potential: p.potential,
    current: slope * p.potential + intercept
  }));
};

/**
 * Parabolic (3-point) interpolation for precise peak potential.
 *
 * Fits a parabola through the peak and its two neighbours in the
 * corrected signal, then returns the vertex potential.  This gives
 * sub-data-point precision and is the standard method used in
 * commercial electrochemical software (CHI, Autolab NOVA, EC-Lab).
 */
const interpolatePeakPotential = (
  smoothed: DataPoint[],
  corrected: number[],
  peakIdx: number
): number => {
  // Fall back to discrete value at boundaries
  if (peakIdx <= 0 || peakIdx >= corrected.length - 1) {
    return smoothed[peakIdx].potential;
  }

  const yL = corrected[peakIdx - 1];
  const yC = corrected[peakIdx];
  const yR = corrected[peakIdx + 1];

  const denom = 2 * (2 * yC - yL - yR);
  if (Math.abs(denom) < 1e-30) {
    return smoothed[peakIdx].potential;
  }

  // Fractional index offset from peakIdx
  const offset = (yL - yR) / denom;

  // Interpolate potential at that fractional index
  const eL = smoothed[peakIdx - 1].potential;
  const eC = smoothed[peakIdx].potential;
  const eR = smoothed[peakIdx + 1].potential;

  // Linear interpolation of potential at peakIdx + offset
  if (offset >= 0) {
    return eC + offset * (eR - eC);
  } else {
    return eC + offset * (eC - eL);
  }
};

/**
 * Builds integration points from baseline-corrected signal.
 * x-axis is either time (for Coulombs) or potential (for V·A).
 */
const buildIntegrationPoints = (
  data: DataPoint[],
  baseline: DataPoint[],
  startIndex: number,
  endIndex: number,
  useTime: boolean
): DataPoint2D[] => {
  const points: DataPoint2D[] = [];
  for (let i = startIndex; i <= endIndex && i < data.length; i++) {
    const y = data[i].current - (baseline[i]?.current ?? 0);
    const x = useTime && data[i].time !== undefined
      ? data[i].time as number
      : data[i].potential;
    points.push({ x, y });
  }
  return points;
};

/**
 * Integrates baseline-corrected peak area using Simpson's rule
 * (with trapezoidal fallback for even point counts).
 *
 * When time data is available, integrates over time (∫I·dt → Coulombs).
 * Otherwise integrates over potential (∫I·dE → V·A).
 */
const integratePeakArea = (
  data: DataPoint[],
  baseline: DataPoint[],
  startIndex: number,
  endIndex: number,
  useTime: boolean
): number => {
  const pts = buildIntegrationPoints(data, baseline, startIndex, endIndex, useTime);
  if (pts.length < 2) return 0;

  // Prefer Simpson's for higher accuracy; falls back to trapezoidal internally
  const result = pts.length >= 3 && pts.length % 2 === 1
    ? simpsons(pts)
    : trapz(pts);

  return Math.abs(result.area);
};
