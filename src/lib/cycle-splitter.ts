import type { DataPoint, CycleData } from '../types';

export interface SplitResult {
  cycles: CycleResult[];       // All detected cycles
  selectedIndex: number;       // Index of the default cycle (last one)
  warnings: string[];
}

export interface CycleResult {
  label: string;               // Display label, e.g. "Scan 6" or "Cycle 3"
  data: CycleData;
  switchingPotentials: { forward: number; reverse: number };
}

/**
 * Splits CV data into cycles, each with forward and reverse scans.
 *
 * When the instrument's Scan column is available, uses it directly.
 * Otherwise falls back to heuristic switching-point detection.
 *
 * Returns ALL cycles so the caller can let the user choose.
 */
export const splitCycles = (data: DataPoint[]): SplitResult => {
  const warnings: string[] = [];

  if (data.length < 10) {
    warnings.push('Dataset is very small, cycle detection may be unreliable');
  }

  // Prefer instrument Scan column when available
  const hasScanColumn = data.some(d => d.scan !== undefined);
  if (hasScanColumn) {
    return splitByScanColumn(data, warnings);
  }

  // Fallback: detect switching points heuristically
  return splitByHeuristic(data, warnings);
};

/**
 * Splits a single cycle's data into forward (oxidation) and reverse (reduction)
 * at the potential extrema.
 *
 * Handles 2-segment (fwd→rev) and 3-segment (fwd→rev→return) scans.
 * Forward = min potential → max potential (increasing E).
 * Reverse = max potential → min potential (decreasing E).
 */
const splitScanAtExtrema = (scanData: DataPoint[]): { data: CycleData; switchingPotentials: { forward: number; reverse: number } } => {
  const potentials = scanData.map(d => d.potential);
  const maxPot = Math.max(...potentials);
  const minPot = Math.min(...potentials);
  const maxIdx = potentials.indexOf(maxPot);
  const minIdx = potentials.indexOf(minPot);

  const lo = Math.min(maxIdx, minIdx);
  const hi = Math.max(maxIdx, minIdx);

  // The two monotonic half-scans are between the extrema
  const seg1 = scanData.slice(lo, hi + 1);  // lo → hi
  const seg2Exists = lo > 0 || hi < scanData.length - 1;

  // Determine which segment is forward (increasing E) vs reverse (decreasing E)
  const seg1GoesUp = seg1.length >= 2 && seg1[seg1.length - 1].potential > seg1[0].potential;

  let forward: DataPoint[];
  let reverse: DataPoint[];

  if (seg1GoesUp) {
    forward = seg1;
    // Reverse: hi → end + start → lo (wrapping the return leg)
    if (seg2Exists) {
      const tail = scanData.slice(hi);
      const head = scanData.slice(0, lo + 1);
      reverse = [...tail, ...head.slice(1)]; // avoid duplicating the junction point
    } else {
      reverse = [];
    }
  } else {
    reverse = seg1;
    if (seg2Exists) {
      const tail = scanData.slice(hi);
      const head = scanData.slice(0, lo + 1);
      forward = [...tail, ...head.slice(1)];
    } else {
      forward = [];
    }
  }

  return { data: { forward, reverse }, switchingPotentials: { forward: maxPot, reverse: minPot } };
};

/**
 * Splits data using the instrument's Scan column.
 * Returns one CycleResult per scan number.
 */
const splitByScanColumn = (data: DataPoint[], warnings: string[]): SplitResult => {
  const scanGroups = new Map<number, DataPoint[]>();
  for (const point of data) {
    const s = point.scan ?? 1;
    if (!scanGroups.has(s)) scanGroups.set(s, []);
    scanGroups.get(s)!.push(point);
  }

  const scanNumbers = Array.from(scanGroups.keys()).sort((a, b) => a - b);
  warnings.push('Cycle split using instrument Scan column');

  const cycles: CycleResult[] = scanNumbers.map(num => {
    const scanData = scanGroups.get(num)!;
    const { data: cycleData, switchingPotentials } = splitScanAtExtrema(scanData);
    return { label: `Scan ${num}`, data: cycleData, switchingPotentials };
  });

  return {
    cycles,
    selectedIndex: cycles.length - 1,
    warnings
  };
};

/**
 * Heuristic cycle splitting when no Scan column is available.
 * Detects switching points via sustained direction changes, then
 * pairs consecutive segments into cycles.
 */
const splitByHeuristic = (data: DataPoint[], warnings: string[]): SplitResult => {
  if (data.length < 20) {
    const { data: cycleData, switchingPotentials } = splitScanAtExtrema(data);
    return {
      cycles: [{ label: 'Cycle 1', data: cycleData, switchingPotentials }],
      selectedIndex: 0,
      warnings: [...warnings, 'Dataset too small for multi-cycle detection']
    };
  }

  const potentials = data.map(d => d.potential);
  const totalRange = Math.max(...potentials) - Math.min(...potentials);
  const minSwing = totalRange * 0.1;

  // Find switching points (sustained direction reversals)
  interface SwitchPoint { index: number; potential: number }
  const switches: SwitchPoint[] = [];
  let lastExtremumIdx = 0;
  let lastExtremumVal = potentials[0];
  let direction = 0;

  for (let i = 1; i < data.length; i++) {
    const diff = potentials[i] - lastExtremumVal;

    if (direction === 0) {
      if (Math.abs(diff) > minSwing * 0.5) {
        direction = diff > 0 ? 1 : -1;
      }
      continue;
    }

    if (direction === 1 && diff < 0 && (lastExtremumVal - potentials[0]) > minSwing * 0.3) {
      if (Math.abs(lastExtremumVal - (switches.length > 0 ? switches[switches.length - 1].potential : potentials[0])) > minSwing) {
        switches.push({ index: lastExtremumIdx, potential: lastExtremumVal });
      }
      direction = -1;
      lastExtremumIdx = i;
      lastExtremumVal = potentials[i];
    } else if (direction === -1 && diff > 0 && (potentials[0] - lastExtremumVal) > minSwing * 0.3) {
      if (Math.abs(lastExtremumVal - (switches.length > 0 ? switches[switches.length - 1].potential : potentials[0])) > minSwing) {
        switches.push({ index: lastExtremumIdx, potential: lastExtremumVal });
      }
      direction = 1;
      lastExtremumIdx = i;
      lastExtremumVal = potentials[i];
    } else {
      if ((direction === 1 && potentials[i] > lastExtremumVal) ||
          (direction === -1 && potentials[i] < lastExtremumVal)) {
        lastExtremumIdx = i;
        lastExtremumVal = potentials[i];
      }
    }
  }

  if (switches.length === 0) {
    warnings.push('No switching points detected, treating all data as one cycle');
    const { data: cycleData, switchingPotentials } = splitScanAtExtrema(data);
    return {
      cycles: [{ label: 'Cycle 1', data: cycleData, switchingPotentials }],
      selectedIndex: 0,
      warnings
    };
  }

  // Build cycles from pairs of switching points
  const boundaries = [0, ...switches.map(s => s.index), data.length - 1];
  const cycles: CycleResult[] = [];

  for (let seg = 0; seg < boundaries.length - 2; seg += 2) {
    const start = boundaries[seg];
    const mid = boundaries[seg + 1];
    const end = boundaries[seg + 2] ?? data.length - 1;

    const segA = data.slice(start, mid + 1);
    const segB = data.slice(mid, end + 1);

    if (segA.length < 5 || segB.length < 5) continue;

    const aGoesUp = segA[segA.length - 1].potential > segA[0].potential;
    const forward = aGoesUp ? segA : segB;
    const reverse = aGoesUp ? segB : segA;

    const maxPot = Math.max(forward[forward.length - 1].potential, forward[0].potential);
    const minPot = Math.min(reverse[reverse.length - 1].potential, reverse[0].potential);

    cycles.push({
      label: `Cycle ${cycles.length + 1}`,
      data: { forward, reverse },
      switchingPotentials: { forward: maxPot, reverse: minPot }
    });
  }

  if (cycles.length === 0) {
    const { data: cycleData, switchingPotentials } = splitScanAtExtrema(data);
    return {
      cycles: [{ label: 'Cycle 1', data: cycleData, switchingPotentials }],
      selectedIndex: 0,
      warnings: [...warnings, 'Could not build complete cycles from switching points']
    };
  }

  return {
    cycles,
    selectedIndex: cycles.length - 1,
    warnings
  };
};
