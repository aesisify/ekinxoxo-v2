/**
 * Savitzky-Golay kernel coefficients for signal processing
 * Pre-calculated coefficients for smoothing and first derivative
 * Based on standard SG filter tables for polynomial order 2
 */

export interface SGKernel {
  coefficients: number[];
  windowSize: number;
  polynomialOrder: number;
  type: 'smoothing' | 'derivative';
}

export interface SGKernelSet {
  smoothing: SGKernel;
  derivative: SGKernel;
}

/**
 * Savitzky-Golay kernels for window size 5
 * Polynomial order: 2
 */
export const SG_KERNELS_5: SGKernelSet = {
  smoothing: {
    coefficients: [-3, 12, 17, 12, -3],
    windowSize: 5,
    polynomialOrder: 2,
    type: 'smoothing'
  },
  derivative: {
    coefficients: [-2, -1, 0, 1, 2],
    windowSize: 5,
    polynomialOrder: 2,
    type: 'derivative'
  }
};

/**
 * Savitzky-Golay kernels for window size 9
 * Polynomial order: 2
 */
export const SG_KERNELS_9: SGKernelSet = {
  smoothing: {
    coefficients: [-21, 14, 39, 54, 59, 54, 39, 14, -21],
    windowSize: 9,
    polynomialOrder: 2,
    type: 'smoothing'
  },
  derivative: {
    coefficients: [-4, -3, -2, -1, 0, 1, 2, 3, 4],
    windowSize: 9,
    polynomialOrder: 2,
    type: 'derivative'
  }
};

/**
 * Savitzky-Golay kernels for window size 11
 * Polynomial order: 2
 */
export const SG_KERNELS_11: SGKernelSet = {
  smoothing: {
    coefficients: [
      -36, 9, 44, 69, 84, 89, 84, 69, 44, 9, -36
    ],
    windowSize: 11,
    polynomialOrder: 2,
    type: 'smoothing'
  },
  derivative: {
    coefficients: [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5],
    windowSize: 11,
    polynomialOrder: 2,
    type: 'derivative'
  }
};

/**
 * Savitzky-Golay kernels for window size 15
 * Polynomial order: 2
 */
export const SG_KERNELS_15: SGKernelSet = {
  smoothing: {
    coefficients: [
      -78, -13, 42, 87, 122, 147, 162, 167, 162, 147, 122, 87, 42, -13, -78
    ],
    windowSize: 15,
    polynomialOrder: 2,
    type: 'smoothing'
  },
  derivative: {
    coefficients: [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7],
    windowSize: 15,
    polynomialOrder: 2,
    type: 'derivative'
  }
};

/**
 * Savitzky-Golay kernels for window size 21
 * Polynomial order: 2
 */
export const SG_KERNELS_21: SGKernelSet = {
  smoothing: {
    coefficients: [
      -171, -76, 9, 84, 149, 204, 249, 284, 309, 324, 329, 324, 309, 284, 249, 204, 149, 84, 9, -76, -171
    ],
    windowSize: 21,
    polynomialOrder: 2,
    type: 'smoothing'
  },
  derivative: {
    coefficients: [-10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    windowSize: 21,
    polynomialOrder: 2,
    type: 'derivative'
  }
};

/**
 * Kernel registry for easy access
 */
export const SG_KERNEL_REGISTRY: Record<number, SGKernelSet> = {
  5: SG_KERNELS_5,
  9: SG_KERNELS_9,
  11: SG_KERNELS_11,
  15: SG_KERNELS_15,
  21: SG_KERNELS_21
};

/**
 * Get normalized smoothing kernel coefficients
 * Normalizes the coefficients to sum to 1 for proper amplitude preservation
 */
export const getNormalizedSmoothingKernel = (windowSize: number): number[] => {
  const kernel = SG_KERNEL_REGISTRY[windowSize]?.smoothing;
  
  if (!kernel) {
    throw new Error(`No smoothing kernel available for window size ${windowSize}`);
  }

  const coefficients = kernel.coefficients;
  const sum = coefficients.reduce((acc, val) => acc + val, 0);
  
  return coefficients.map(val => val / sum);
};

/**
 * Get derivative kernel coefficients
 * Derivative kernels are not normalized as they represent slope
 */
export const getDerivativeKernel = (windowSize: number): number[] => {
  const kernel = SG_KERNEL_REGISTRY[windowSize]?.derivative;
  
  if (!kernel) {
    throw new Error(`No derivative kernel available for window size ${windowSize}`);
  }

  return kernel.coefficients;
};
