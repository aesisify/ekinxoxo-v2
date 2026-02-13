import { convolve } from './convolution';
import { getNormalizedSmoothingKernel } from './savitzky-golay-kernels';
import type { DataPoint, AnalysisConfig } from '../types';

export interface SmoothingResult {
  smoothedData: DataPoint[];
  smoothedCurrent: number[];
  warnings: string[];
  kernelInfo: {
    windowSize: number;
    coefficients: number[];
  };
}

/**
 * Applies Savitzky-Golay smoothing to electrochemical data
 * @param data Raw electrochemical data points
 * @param config Analysis configuration with smoothing parameters
 * @returns Smoothed data with metadata
 */
export const applySmoothing = (
  data: DataPoint[],
  config: AnalysisConfig
): SmoothingResult => {
  const warnings: string[] = [];

  // Validate input
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Data must be a non-empty array');
  }

  if (data.length < config.smoothingWindow) {
    warnings.push(
      `Data length (${data.length}) is smaller than smoothing window (${config.smoothingWindow}). Results may be unreliable.`
    );
  }

  // Extract current values for convolution
  const currentValues = data.map(point => point.current);

  // Check for invalid current values
  const invalidCurrents = currentValues.filter(val => !isFinite(val));
  if (invalidCurrents.length > 0) {
    warnings.push(`Found ${invalidCurrents.length} invalid current values, they will be ignored in smoothing`);
  }

  try {
    // Get appropriate smoothing kernel
    const kernel = getNormalizedSmoothingKernel(config.smoothingWindow);

    // Apply convolution for smoothing
    const convolutionResult = convolve(currentValues, kernel, 'mirror');
    const smoothedCurrent = convolutionResult.result;

    // Combine smoothed current with original potential values
    const smoothedData: DataPoint[] = data.map((point, index) => ({
      potential: point.potential,
      current: smoothedCurrent[index] ?? point.current
    }));

    // Add convolution warnings
    warnings.push(...convolutionResult.warnings);

    // Validate smoothing results
    const smoothingQuality = validateSmoothingQuality(currentValues, smoothedCurrent);
    warnings.push(...smoothingQuality.warnings);

    return {
      smoothedData,
      smoothedCurrent,
      warnings,
      kernelInfo: {
        windowSize: config.smoothingWindow,
        coefficients: kernel
      }
    };

  } catch (error) {
    warnings.push(`Smoothing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    
    // Return unsmoothed data as fallback
    return {
      smoothedData: data,
      smoothedCurrent: currentValues,
      warnings,
      kernelInfo: {
        windowSize: config.smoothingWindow,
        coefficients: []
      }
    };
  }
};

/**
 * Validates the quality of smoothing results
 */
const validateSmoothingQuality = (
  original: number[],
  smoothed: number[]
): { warnings: string[] } => {
  const warnings: string[] = [];

  if (original.length !== smoothed.length) {
    warnings.push('Original and smoothed arrays have different lengths');
    return { warnings };
  }

  // Calculate smoothing metrics
  const originalStdDev = calculateStandardDeviation(original);
  const smoothedStdDev = calculateStandardDeviation(smoothed);
  const noiseReduction = (originalStdDev - smoothedStdDev) / originalStdDev;

  // Check for over-smoothing
  if (noiseReduction > 0.9) {
    warnings.push('Heavy smoothing detected - peaks may be significantly flattened');
  }

  // Check for under-smoothing
  if (noiseReduction < 0.1) {
    warnings.push('Minimal smoothing detected - noise may still be present');
  }

  // Check for smoothing artifacts
  const artifacts = detectSmoothingArtifacts(original, smoothed);
  if (artifacts > 0) {
    warnings.push(`Detected ${artifacts} potential smoothing artifacts`);
  }

  // Check for amplitude preservation
  const amplitudeRatio = calculateAmplitudeRatio(original, smoothed);
  if (amplitudeRatio < 0.8 || amplitudeRatio > 1.2) {
    warnings.push('Smoothing may have distorted peak amplitudes');
  }

  return { warnings };
};

/**
 * Calculates standard deviation
 */
const calculateStandardDeviation = (values: number[]): number => {
  const validValues = values.filter(isFinite);
  if (validValues.length === 0) return 0;

  const mean = validValues.reduce((sum, val) => sum + val, 0) / validValues.length;
  const variance = validValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / validValues.length;
  
  return Math.sqrt(variance);
};

/**
 * Detects potential smoothing artifacts
 */
const detectSmoothingArtifacts = (original: number[], smoothed: number[]): number => {
  let artifactCount = 0;

  // Look for oscillations that weren't present in original
  for (let i = 2; i < smoothed.length - 2; i++) {
    const originalChange = Math.abs(original[i] - original[i - 1]);
    const smoothedChange = Math.abs(smoothed[i] - smoothed[i - 1]);

    // Check for excessive local variations
    if (smoothedChange > originalChange * 3) {
      artifactCount++;
    }
  }

  return artifactCount;
};

/**
 * Calculates amplitude ratio between original and smoothed data
 */
const calculateAmplitudeRatio = (original: number[], smoothed: number[]): number => {
  const originalMax = Math.max(...original.filter(isFinite));
  const originalMin = Math.min(...original.filter(isFinite));
  const smoothedMax = Math.max(...smoothed.filter(isFinite));
  const smoothedMin = Math.min(...smoothed.filter(isFinite));

  const originalAmplitude = originalMax - originalMin;
  const smoothedAmplitude = smoothedMax - smoothedMin;

  if (originalAmplitude === 0) return 1;
  return smoothedAmplitude / originalAmplitude;
};

