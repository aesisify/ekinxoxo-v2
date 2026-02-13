/**
 * Numerical integration for electrochemical charge calculation.
 *
 * Provides trapezoidal and Simpson's rule with Richardson error estimation.
 * Used by cv-analysis.ts for peak area / charge integration.
 */

export interface IntegrationResult {
  area: number;
  error: number | null;
}

export interface DataPoint2D {
  x: number;
  y: number;
}

/**
 * Trapezoidal rule integration for discrete data points.
 * Includes Richardson extrapolation error estimate.
 */
export const trapz = (points: DataPoint2D[]): IntegrationResult => {
  if (points.length < 2) return { area: 0, error: null };

  let area = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    area += dx * (points[i - 1].y + points[i].y) / 2;
  }

  let error: number | null = null;
  if (points.length >= 4) {
    error = estimateIntegrationError(points, area);
  }

  return { area, error };
};

/**
 * Simpson's 1/3 rule for higher-order integration accuracy.
 * Requires an odd number of points (≥ 3).  Falls back to trapezoidal
 * if the count is even or too small.
 */
export const simpsons = (points: DataPoint2D[]): IntegrationResult => {
  const n = points.length;
  if (n < 3 || n % 2 === 0) return trapz(points);

  let area = 0;
  for (let i = 0; i < n - 2; i += 2) {
    const h = points[i + 1].x - points[i].x;
    area += (h / 3) * (points[i].y + 4 * points[i + 1].y + points[i + 2].y);
  }

  return { area, error: null };
};

/**
 * Estimate integration error using Richardson extrapolation.
 * Compares full-grid trapezoidal with half-grid trapezoidal.
 */
const estimateIntegrationError = (points: DataPoint2D[], fullArea: number): number => {
  if (points.length < 4) return 0;

  const coarsePoints: DataPoint2D[] = [];
  for (let i = 0; i < points.length; i += 2) coarsePoints.push(points[i]);

  const coarseArea = trapz(coarsePoints).area;
  return Math.abs(coarseArea - fullArea) / 3; // Richardson factor for order-2
};
