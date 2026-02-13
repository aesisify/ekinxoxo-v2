/**
 * Rubberband baseline fitting for cyclic voltammetry.
 *
 * Uses an iterative morphological approach:
 *   1. Start with the raw smoothed current as the "envelope".
 *   2. Repeatedly apply a moving-minimum filter (erosion) to push the
 *      envelope down below peaks, then a moving-average (dilation/smooth)
 *      to restore the background shape.
 *   3. After several iterations the envelope converges to the non-faradaic
 *      background current that curves just under the peaks.
 *
 * For reduction peaks (reverse scan) the logic is inverted (moving-maximum).
 */

import type { DataPoint, AnalysisConfig } from '../types';

export interface RubberbandConfig {
  iterations: number;
  windowSize: number;
}

/**
 * Computes a rubberband baseline for a CV scan.
 *
 * @param data      Smoothed scan data (monotonic in potential).
 * @param direction 'forward' → oxidation peaks point UP, baseline hugs below.
 *                  'reverse' → reduction peaks point DOWN, baseline hugs above.
 * @param config    Optional tuning parameters.
 * @returns         Baseline as DataPoint[] aligned 1-to-1 with input data.
 */
export const rubberbandBaseline = (
  data: DataPoint[],
  direction: 'forward' | 'reverse',
  config: RubberbandConfig = createDefaultRubberbandConfig()
): DataPoint[] => {
  if (data.length < 3) {
    return data.map(p => ({ potential: p.potential, current: p.current }));
  }

  const n = data.length;
  // Adaptive window: fraction of data length, clamped to config bounds
  const halfWin = Math.max(2, Math.min(Math.floor(n * 0.05), Math.floor(config.windowSize / 2)));

  // Start with the actual current values
  let envelope = data.map(p => p.current);

  for (let iter = 0; iter < config.iterations; iter++) {
    // Morphological erosion: moving-min (forward) or moving-max (reverse)
    const eroded = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - halfWin);
      const hi = Math.min(n - 1, i + halfWin);
      let extremum = envelope[lo];
      for (let j = lo + 1; j <= hi; j++) {
        if (direction === 'forward') {
          if (envelope[j] < extremum) extremum = envelope[j];
        } else {
          if (envelope[j] > extremum) extremum = envelope[j];
        }
      }
      eroded[i] = extremum;
    }

    // Morphological dilation: moving-max (forward) or moving-min (reverse)
    // This restores the general shape after erosion removed peaks.
    const dilated = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - halfWin);
      const hi = Math.min(n - 1, i + halfWin);
      let extremum = eroded[lo];
      for (let j = lo + 1; j <= hi; j++) {
        if (direction === 'forward') {
          if (eroded[j] > extremum) extremum = eroded[j];
        } else {
          if (eroded[j] < extremum) extremum = eroded[j];
        }
      }
      dilated[i] = extremum;
    }

    // Smooth the result to remove staircase artifacts
    envelope = smoothArray(dilated, halfWin);
  }

  // Ensure baseline never exceeds the data on the peak side
  for (let i = 0; i < n; i++) {
    if (direction === 'forward') {
      envelope[i] = Math.min(envelope[i], data[i].current);
    } else {
      envelope[i] = Math.max(envelope[i], data[i].current);
    }
  }

  return data.map((p, i) => ({ potential: p.potential, current: envelope[i] }));
};

/**
 * Simple moving-average smoother.
 */
const smoothArray = (arr: number[], halfWin: number): number[] => {
  const n = arr.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - halfWin);
    const hi = Math.min(n - 1, i + halfWin);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += arr[j];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
};

export const createDefaultRubberbandConfig = (): RubberbandConfig => ({
  iterations: 40,
  windowSize: 80
});

/**
 * Linear baseline fitting using least-squares regression.
 *
 * Selects anchor points from the first and last fractions of the scan
 * (regions assumed to be outside faradaic peaks) and fits y = mx + b.
 * This is the traditional baseline method used in most electrochemical
 * software (CHI, EC-Lab, NOVA).
 *
 * @param data      Smoothed scan data.
 * @param anchorFraction  Fraction of data at each end to use as anchors (default 0.1 = 10%).
 * @returns         Baseline as DataPoint[] aligned 1-to-1 with input data.
 */
export const linearBaseline = (
  data: DataPoint[],
  anchorFraction: number = 0.1
): DataPoint[] => {
  if (data.length < 3) {
    return data.map(p => ({ potential: p.potential, current: p.current }));
  }

  const n = data.length;
  const anchorCount = Math.max(2, Math.floor(n * anchorFraction));

  // Collect anchor points from both ends of the scan
  const anchors: { x: number; y: number }[] = [];
  for (let i = 0; i < anchorCount; i++) {
    anchors.push({ x: data[i].potential, y: data[i].current });
  }
  for (let i = n - anchorCount; i < n; i++) {
    anchors.push({ x: data[i].potential, y: data[i].current });
  }

  // Least-squares linear regression: y = slope * x + intercept
  const { slope, intercept } = leastSquares(anchors);

  return data.map(p => ({
    potential: p.potential,
    current: slope * p.potential + intercept
  }));
};

/**
 * Simple least-squares fit for y = mx + b.
 */
const leastSquares = (points: { x: number; y: number }[]): { slope: number; intercept: number } => {
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const { x, y } of points) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-15) {
    return { slope: 0, intercept: sumY / n };
  }
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
};

// ---------------------------------------------------------------------------
// ASLS — Asymmetric Least Squares Smoothing baseline
// ---------------------------------------------------------------------------

export interface AslsConfig {
  lambda: number;      // Smoothness penalty (larger → smoother baseline). Typical: 1e5–1e8.
  p: number;           // Asymmetry weight (0 < p < 1). Smaller → baseline pushed further below peaks. Typical: 0.001–0.05.
  maxIterations: number;
  tolerance: number;   // Convergence threshold on weight change.
}

export const createDefaultAslsConfig = (): AslsConfig => ({
  lambda: 1e6,
  p: 0.01,
  maxIterations: 20,
  tolerance: 1e-6
});

/**
 * Asymmetric Least Squares Smoothing (AsLS / ALS) baseline.
 *
 * Reference:
 *   P.H.C. Eilers & H.F.M. Boelens,
 *   "Baseline Correction with Asymmetric Least Squares Smoothing" (2005).
 *
 * The algorithm minimises:
 *   sum_i  w_i (y_i - z_i)^2  +  λ sum_i (Δ²z_i)^2
 *
 * where z is the baseline, w are asymmetric weights (small when y > z,
 * i.e. at peaks), and Δ² is the second-difference operator enforcing
 * smoothness.
 *
 * Because we avoid external matrix libraries, we solve the banded
 * system iteratively using a Cholesky-like tridiagonal solver on the
 * pentadiagonal matrix  W + λ D'D  (approximated as tridiagonal for
 * speed — sufficient for electrochemical data densities).
 *
 * For reverse scans (reduction peaks pointing DOWN) the asymmetry is
 * flipped so the baseline hugs above the signal.
 *
 * @param data      Smoothed scan data.
 * @param direction 'forward' (peaks up) or 'reverse' (peaks down).
 * @param config    Tuning parameters.
 * @returns         Baseline as DataPoint[] aligned 1-to-1 with input.
 */
export const aslsBaseline = (
  data: DataPoint[],
  direction: 'forward' | 'reverse',
  config: AslsConfig = createDefaultAslsConfig()
): DataPoint[] => {
  const n = data.length;
  if (n < 5) {
    return data.map(p => ({ potential: p.potential, current: p.current }));
  }

  const y = data.map(p => p.current);
  const { lambda, p, maxIterations, tolerance } = config;

  // For reverse scans, flip the asymmetry so baseline hugs above
  const pAbove = direction === 'forward' ? p : 1 - p;
  const pBelow = 1 - pAbove;

  // Initialise weights uniformly
  const w = new Array<number>(n).fill(1);
  let z = Array.from(y);  // baseline estimate

  for (let iter = 0; iter < maxIterations; iter++) {
    // Solve (W + λ D₂ᵀD₂) z = W y  using Cholesky decomposition
    // on the pentadiagonal banded system.
    z = solvePentadiagonal(y, w, lambda, n);

    // Update weights asymmetrically
    let maxChange = 0;
    for (let i = 0; i < n; i++) {
      const newW: number = y[i] > z[i] ? pAbove : pBelow;
      maxChange = Math.max(maxChange, Math.abs(newW - w[i]));
      w[i] = newW;
    }

    if (maxChange < tolerance) break;
  }

  return data.map((pt, i) => ({ potential: pt.potential, current: z[i] }));
};

/**
 * Solves the ASLS pentadiagonal system  (W + λ D₂ᵀD₂) z = W y
 * using banded Cholesky (LLᵀ) decomposition.
 *
 * The matrix A = W + λ D₂ᵀD₂ is symmetric positive-definite with
 * half-bandwidth 2.  We compute the lower Cholesky factor L (also
 * banded with half-bandwidth 2) such that A = LLᵀ, then solve
 * via forward and back substitution.
 *
 * This is the standard O(n) algorithm used by Eilers (2003) for
 * Whittaker smoothers in spectroscopy and electrochemistry.
 */
const solvePentadiagonal = (
  y: number[],
  w: number[],
  lambda: number,
  n: number
): number[] => {
  // Build the 3 bands of the symmetric matrix A = W + λ D₂ᵀD₂
  // We store the lower triangle: diag a[0..n-1], sub1 e[0..n-2], sub2 f[0..n-3]
  //
  // D₂ᵀD₂ band values:
  //   diag:  1, 5, 6, ..., 6, 5, 1
  //   sub1: -2,-4,-4, ...,-4,-2
  //   sub2:  1, 1, 1, ..., 1

  const a = new Array<number>(n);   // main diagonal of A
  const e = new Array<number>(n);   // first sub-diagonal of A  (e[i] = A[i+1][i])
  const f = new Array<number>(n);   // second sub-diagonal of A (f[i] = A[i+2][i])

  for (let i = 0; i < n; i++) {
    let dtd: number;
    if (i === 0 || i === n - 1) dtd = 1;
    else if (i === 1 || i === n - 2) dtd = 5;
    else dtd = 6;
    a[i] = w[i] + lambda * dtd;
  }
  for (let i = 0; i < n - 1; i++) {
    e[i] = (i === 0 || i === n - 2) ? lambda * (-2) : lambda * (-4);
  }
  for (let i = 0; i < n - 2; i++) {
    f[i] = lambda;
  }

  // Banded Cholesky: A = LLᵀ where L has bandwidth 2.
  // L is stored in-place: L[i][i] in a[i], L[i+1][i] in e[i], L[i+2][i] in f[i].
  //
  // Column-by-column factorisation:
  //   For column j (j = 0, 1, ..., n-1):
  //     a[j] = sqrt( a[j] - e[j-1]² - f[j-2]² )           (diagonal)
  //     e[j] = ( e[j] - e[j-1]*f[j-2] ) / a[j]            (if j < n-1)
  //     f[j] = f[j] / a[j]                                  (if j < n-2)
  //
  //   where out-of-bounds terms are 0.

  for (let j = 0; j < n; j++) {
    // Subtract contributions from earlier columns
    if (j >= 1) a[j] -= e[j - 1] * e[j - 1];
    if (j >= 2) a[j] -= f[j - 2] * f[j - 2];

    a[j] = Math.sqrt(Math.max(a[j], 1e-30));  // clamp for numerical safety

    if (j < n - 1) {
      if (j >= 1) e[j] -= e[j - 1] * f[j - 1];
      e[j] /= a[j];
    }

    if (j < n - 2) {
      f[j] /= a[j];
    }
  }

  // Forward substitution: solve L·g = rhs  (rhs = W·y)
  const g = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let val = w[i] * y[i];
    if (i >= 1) val -= e[i - 1] * g[i - 1];
    if (i >= 2) val -= f[i - 2] * g[i - 2];
    g[i] = val / a[i];
  }

  // Back substitution: solve Lᵀ·z = g
  const z = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let val = g[i];
    if (i + 1 < n) val -= e[i] * z[i + 1];
    if (i + 2 < n) val -= f[i] * z[i + 2];
    z[i] = val / a[i];
  }

  return z;
};

/**
 * Unified baseline dispatcher.
 * Selects rubberband, linear, or ASLS method and passes config parameters.
 */
export const computeBaseline = (
  data: DataPoint[],
  direction: 'forward' | 'reverse',
  config: AnalysisConfig
): DataPoint[] => {
  switch (config.baselineMethod) {
    case 'linear':
      return linearBaseline(data, config.linearAnchorFraction);
    case 'asls':
      return aslsBaseline(data, direction, {
        lambda: config.aslsLambda,
        p: config.aslsP,
        maxIterations: 20,
        tolerance: 1e-6
      });
    case 'rubberband':
    default:
      return rubberbandBaseline(data, direction, {
        iterations: config.rubberbandIterations,
        windowSize: config.rubberbandWindowSize
      });
  }
};
