import { convolve } from './convolution';
import { getDerivativeKernel } from './savitzky-golay-kernels';
import type { DataPoint, AnalysisConfig } from '../types';

export interface DerivativeResult {
  derivativeCurrent: number[];
  derivativeData: DataPoint[];
  warnings: string[];
  kernelInfo: {
    windowSize: number;
    coefficients: number[];
  };
  statistics: {
    maxSlope: number;
    minSlope: number;
    meanSlope: number;
    zeroCrossings: number;
  };
}

/**
 * Applies Savitzky-Golay derivative calculation to electrochemical data
 * @param data Electrochemical data (typically smoothed data)
 * @param config Analysis configuration
 * @returns Derivative data with statistics
 */
export const calculateDerivative = (
  data: DataPoint[],
  config: AnalysisConfig
): DerivativeResult => {
  const warnings: string[] = [];

  // Validate input
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Data must be a non-empty array');
  }

  if (data.length < config.smoothingWindow) {
    warnings.push(
      `Data length (${data.length}) is smaller than derivative window (${config.smoothingWindow}). Results may be unreliable.`
    );
  }

  // Extract current values for derivative calculation
  const currentValues = data.map(point => point.current);

  // Check for invalid current values
  const invalidCurrents = currentValues.filter(val => !isFinite(val));
  if (invalidCurrents.length > 0) {
    warnings.push(`Found ${invalidCurrents.length} invalid current values, they will be ignored in derivative calculation`);
  }

  try {
    // Get appropriate derivative kernel
    const kernel = getDerivativeKernel(config.smoothingWindow);

    // Apply convolution for derivative calculation
    const convolutionResult = convolve(currentValues, kernel, 'mirror');
    const derivativeCurrent = convolutionResult.result;

    // Scale derivative: dI/dE = convolution_result / (norm * h)
    // where norm = sum(i^2) for the derivative kernel indices and h = potential spacing
    const potentialSpacing = calculatePotentialSpacing(data);
    const halfWindow = Math.floor(kernel.length / 2);
    let norm = 0;
    for (let i = 1; i <= halfWindow; i++) {
      norm += i * i;
    }
    norm *= 2; // symmetric: sum from -m to m of i^2 = 2 * sum from 1 to m of i^2
    const scaleFactor = norm * potentialSpacing;
    const scaledDerivative = derivativeCurrent.map(val => scaleFactor > 0 ? val / scaleFactor : 0);

    // Combine derivative with original potential values
    const derivativeData: DataPoint[] = data.map((point, index) => ({
      potential: point.potential,
      current: scaledDerivative[index] ?? 0 // Derivative as "current" for plotting
    }));

    // Add convolution warnings
    warnings.push(...convolutionResult.warnings);

    // Calculate derivative statistics
    const statistics = calculateDerivativeStatistics(scaledDerivative);

    // Validate derivative results
    const qualityWarnings = validateDerivativeQuality(scaledDerivative, potentialSpacing);
    warnings.push(...qualityWarnings);

    return {
      derivativeCurrent: scaledDerivative,
      derivativeData,
      warnings,
      kernelInfo: {
        windowSize: config.smoothingWindow,
        coefficients: kernel
      },
      statistics
    };

  } catch (error) {
    warnings.push(`Derivative calculation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    
    // Return zero derivative as fallback
    const zeroDerivative = new Array(data.length).fill(0);
    const zeroDerivativeData = data.map(point => ({ ...point, current: 0 }));

    return {
      derivativeCurrent: zeroDerivative,
      derivativeData: zeroDerivativeData,
      warnings,
      kernelInfo: {
        windowSize: config.smoothingWindow,
        coefficients: []
      },
      statistics: {
        maxSlope: 0,
        minSlope: 0,
        meanSlope: 0,
        zeroCrossings: 0
      }
    };
  }
};

/**
 * Calculates average potential spacing for derivative scaling
 */
const calculatePotentialSpacing = (data: DataPoint[]): number => {
  if (data.length < 2) return 1;

  const spacings: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const spacing = Math.abs(data[i].potential - data[i - 1].potential);
    if (spacing > 0) {
      spacings.push(spacing);
    }
  }

  if (spacings.length === 0) return 1;

  // Use median spacing to avoid outliers
  spacings.sort((a, b) => a - b);
  const medianIndex = Math.floor(spacings.length / 2);
  
  return spacings.length % 2 === 0
    ? (spacings[medianIndex - 1] + spacings[medianIndex]) / 2
    : spacings[medianIndex];
};

/**
 * Calculates derivative statistics for quality assessment
 */
const calculateDerivativeStatistics = (derivative: number[]) => {
  const validValues = derivative.filter(isFinite);
  
  if (validValues.length === 0) {
    return {
      maxSlope: 0,
      minSlope: 0,
      meanSlope: 0,
      zeroCrossings: 0
    };
  }

  const maxSlope = Math.max(...validValues);
  const minSlope = Math.min(...validValues);
  const meanSlope = validValues.reduce((sum, val) => sum + val, 0) / validValues.length;

  // Count zero crossings
  let zeroCrossings = 0;
  for (let i = 1; i < derivative.length; i++) {
    const prev = derivative[i - 1];
    const curr = derivative[i];
    
    if (isFinite(prev) && isFinite(curr)) {
      if ((prev >= 0 && curr < 0) || (prev < 0 && curr >= 0)) {
        zeroCrossings++;
      }
    }
  }

  return {
    maxSlope,
    minSlope,
    meanSlope,
    zeroCrossings
  };
};

/**
 * Validates derivative calculation quality
 */
const validateDerivativeQuality = (
  derivative: number[],
  potentialSpacing: number
): string[] => {
  const warnings: string[] = [];

  if (derivative.length === 0) {
    warnings.push('Derivative array is empty');
    return warnings;
  }

  // Check for extreme derivative values
  const maxDerivative = Math.max(...derivative.filter(isFinite));
  const minDerivative = Math.min(...derivative.filter(isFinite));

  if (Math.abs(maxDerivative) > 1e6 || Math.abs(minDerivative) > 1e6) {
    warnings.push('Extreme derivative values detected - may indicate numerical instability');
  }

  // Check for flat derivative (no variation)
  const derivativeStdDev = calculateStandardDeviation(derivative);
  if (derivativeStdDev < 1e-10) {
    warnings.push('Derivative is nearly constant - data may be too smooth or linear');
  }

  // Check potential spacing
  if (potentialSpacing < 1e-6) {
    warnings.push('Very small potential spacing - derivative scaling may be inaccurate');
  }

  // Check for excessive noise in derivative
  const noiseLevel = estimateDerivativeNoise(derivative);
  if (noiseLevel > 0.5) {
    warnings.push('High noise level in derivative - consider increasing smoothing window');
  }

  return warnings;
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
 * Estimates noise level in derivative
 */
const estimateDerivativeNoise = (derivative: number[]): number => {
  if (derivative.length < 10) return 0.1;

  // Use high-frequency component as noise estimate
  const highFreqComponent: number[] = [];
  for (let i = 2; i < derivative.length - 2; i++) {
    const localMean = (derivative[i - 2] + derivative[i - 1] + derivative[i] + derivative[i + 1] + derivative[i + 2]) / 5;
    highFreqComponent.push(Math.abs(derivative[i] - localMean));
  }

  if (highFreqComponent.length === 0) return 0.1;

  const noiseEstimate = highFreqComponent.reduce((sum, val) => sum + val, 0) / highFreqComponent.length;
  const signalAmplitude = Math.max(...derivative.filter(isFinite)) - Math.min(...derivative.filter(isFinite));

  return signalAmplitude > 0 ? noiseEstimate / signalAmplitude : 0;
};
