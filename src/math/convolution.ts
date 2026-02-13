/**
 * Generic convolution function for signal processing
 * Implements sliding window weighted sum for Savitzky-Golay filtering
 */

export interface ConvolutionResult {
  result: number[];
  edgeHandling: 'mirror' | 'constant' | 'extend';
  warnings: string[];
}

/**
 * Performs 1D convolution of data with a kernel
 * @param data Input data array
 * @param kernel Convolution kernel (coefficients)
 * @param edgeHandling Strategy for handling edges: 'mirror', 'constant', or 'extend'
 * @returns Convolution result with metadata
 */
export const convolve = (
  data: number[],
  kernel: number[],
  edgeHandling: 'mirror' | 'constant' | 'extend' = 'mirror'
): ConvolutionResult => {
  const warnings: string[] = [];
  const result: number[] = [];

  // Validate inputs
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Data must be a non-empty array');
  }

  if (!Array.isArray(kernel) || kernel.length === 0) {
    throw new Error('Kernel must be a non-empty array');
  }

  if (kernel.length > data.length) {
    warnings.push('Kernel is larger than data array, results may be unreliable');
  }

  // Check for NaN or infinite values
  const hasInvalidData = data.some(val => !isFinite(val));
  const hasInvalidKernel = kernel.some(val => !isFinite(val));

  if (hasInvalidData) {
    warnings.push('Data contains NaN or infinite values');
  }

  if (hasInvalidKernel) {
    throw new Error('Kernel contains NaN or infinite values');
  }

  // Normalize kernel (sum to 1 for smoothing, but allow other values for derivatives)
  // Note: kernel normalization is optional and depends on use case
  const normalizedKernel = kernel.map(val => val);

  const kernelSize = kernel.length;
  const halfKernel = Math.floor(kernelSize / 2);

  // Perform convolution (dot product of kernel with windowed data)
  for (let i = 0; i < data.length; i++) {
    let sum = 0;

    for (let j = 0; j < kernelSize; j++) {
      const dataIndex = i - halfKernel + j;
      const dataValue = getDataValue(data, dataIndex, edgeHandling);
      const kernelValue = normalizedKernel[j];

      if (isFinite(dataValue)) {
        sum += dataValue * kernelValue;
      }
    }

    result.push(sum);
  }

  return {
    result,
    edgeHandling,
    warnings
  };
};

/**
 * Gets data value with specified edge handling strategy
 */
const getDataValue = (
  data: number[],
  index: number,
  edgeHandling: 'mirror' | 'constant' | 'extend'
): number => {
  if (index >= 0 && index < data.length) {
    return data[index];
  }

  switch (edgeHandling) {
    case 'mirror': {
      // Mirror the data at edges with clamping to prevent out-of-bounds
      let mirroredIndex: number;
      if (index < 0) {
        mirroredIndex = Math.min(Math.abs(index), data.length - 1);
      } else {
        mirroredIndex = Math.max(0, 2 * data.length - index - 2);
      }
      return data[mirroredIndex];
    }

    case 'constant':
    case 'extend':
      return index < 0 ? data[0] : data[data.length - 1];

    default:
      return 0;
  }
};
