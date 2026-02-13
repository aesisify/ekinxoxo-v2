import type { DataPoint } from '../types';

export interface ParseResult {
  data: DataPoint[];
  scanRate: number | null;      // Auto-detected scan rate (V/s)
  hasScanColumn: boolean;       // Whether instrument Scan column was found
  instrumentCharge: { qPlus: number; qMinus: number } | null; // Instrument-reported charge (last row)
  error: string | null;
  warnings: string[];
}

export const parseElectrochemicalData = (content: string): ParseResult => {
  const warnings: string[] = [];
  const data: DataPoint[] = [];

  try {
    // Split by lines and filter out empty lines
    const lines = content.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
      return { data: [], scanRate: null, hasScanColumn: false, instrumentCharge: null, error: 'File is empty', warnings };
    }

    // Find header line and identify column indices
    const headerLine = lines[0];
    const columns = headerLine.split('\t').map(col => col.trim());
    
    // Find the indices for potential and current columns
    const potentialIndex = columns.findIndex(col => 
      col.toLowerCase().includes('potential') && !col.toLowerCase().includes('applied')
    );
    const currentIndex = columns.findIndex(col => 
      col.toLowerCase().includes('current') && col.toLowerCase().includes('we')
    );
    const timeIndex = columns.findIndex(col =>
      col.toLowerCase() === 'time (s)' || col.toLowerCase() === 'time/s' || col.toLowerCase() === 'time'
    );
    const appliedPotentialIndex = columns.findIndex(col =>
      col.toLowerCase().includes('potential') && col.toLowerCase().includes('applied')
    );
    const scanIndex = columns.findIndex(col =>
      col.toLowerCase() === 'scan'
    );
    const indexIndex = columns.findIndex(col =>
      col.toLowerCase() === 'index'
    );
    const qPlusIndex = columns.findIndex(col =>
      col.toLowerCase() === 'q+'
    );
    const qMinusIndex = columns.findIndex(col =>
      col.toLowerCase() === 'q-'
    );

    if (potentialIndex === -1) {
      return { data: [], scanRate: null, hasScanColumn: false, instrumentCharge: null, error: 'Could not find potential column in header', warnings };
    }
    
    if (currentIndex === -1) {
      return { data: [], scanRate: null, hasScanColumn: false, instrumentCharge: null, error: 'Could not find current column in header', warnings };
    }

    // Parse data lines
    let validLines = 0;
    let skippedLines = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = line.split('\t');
      
      // Skip lines that don't have enough columns
      if (values.length <= Math.max(potentialIndex, currentIndex)) {
        skippedLines++;
        continue;
      }

      const potentialStr = values[potentialIndex].trim();
      const currentStr = values[currentIndex].trim();

      // Parse numbers with error handling
      const potential = parseFloat(potentialStr);
      const current = parseFloat(currentStr);

      // Skip invalid numbers
      if (isNaN(potential) || isNaN(current)) {
        skippedLines++;
        continue;
      }

      const point: DataPoint = { potential, current };

      // Parse optional columns
      if (timeIndex !== -1 && values.length > timeIndex) {
        const time = parseFloat(values[timeIndex].trim());
        if (!isNaN(time)) point.time = time;
      }
      if (appliedPotentialIndex !== -1 && values.length > appliedPotentialIndex) {
        const ap = parseFloat(values[appliedPotentialIndex].trim());
        if (!isNaN(ap)) point.appliedPotential = ap;
      }
      if (scanIndex !== -1 && values.length > scanIndex) {
        const s = parseInt(values[scanIndex].trim());
        if (!isNaN(s)) point.scan = s;
      }
      if (indexIndex !== -1 && values.length > indexIndex) {
        const idx = parseInt(values[indexIndex].trim());
        if (!isNaN(idx)) point.pointIndex = idx;
      }
      if (qPlusIndex !== -1 && values.length > qPlusIndex) {
        const qp = parseFloat(values[qPlusIndex].trim());
        if (!isNaN(qp)) point.qPlus = qp;
      }
      if (qMinusIndex !== -1 && values.length > qMinusIndex) {
        const qm = parseFloat(values[qMinusIndex].trim());
        if (!isNaN(qm)) point.qMinus = qm;
      }

      data.push(point);
      validLines++;
    }

    if (validLines === 0) {
      return { data: [], scanRate: null, hasScanColumn: false, instrumentCharge: null, error: 'No valid data points found', warnings };
    }

    if (skippedLines > 0) {
      warnings.push(`Skipped ${skippedLines} invalid or incomplete lines`);
    }

    // Validate data range
    const potentials = data.map(d => d.potential);
    const currents = data.map(d => d.current);
    
    const potentialRange = Math.max(...potentials) - Math.min(...potentials);
    const currentRange = Math.max(...currents) - Math.min(...currents);

    if (potentialRange === 0) {
      warnings.push('All potential values are identical');
    }

    if (currentRange === 0) {
      warnings.push('All current values are identical');
    }

    // Auto-detect scan rate from time and potential data
    const scanRate = detectScanRate(data);
    if (scanRate !== null) {
      warnings.push(`Auto-detected scan rate: ${scanRate.toFixed(1)} mV/s`);
    } else if (timeIndex === -1) {
      warnings.push('No time column found — charge values will be in V·A (not Coulombs)');
    }

    // Extract instrument charge from last data point (constant per scan in most potentiostats)
    const lastPoint = data[data.length - 1];
    const instrumentCharge = (lastPoint.qPlus !== undefined && lastPoint.qMinus !== undefined)
      ? { qPlus: lastPoint.qPlus, qMinus: lastPoint.qMinus }
      : null;

    const hasScanColumn = scanIndex !== -1;
    if (hasScanColumn) {
      const scanNumbers = new Set(data.map(d => d.scan).filter(s => s !== undefined));
      warnings.push(`Found Scan column with ${scanNumbers.size} cycle(s)`);
    }
    if (appliedPotentialIndex !== -1) {
      warnings.push('Found applied potential column — iR drop estimation available');
    }

    return { data, scanRate, hasScanColumn, instrumentCharge, error: null, warnings };

  } catch (error) {
    return { 
      data: [], 
      scanRate: null,
      hasScanColumn: false,
      instrumentCharge: null,
      error: `Parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`, 
      warnings 
    };
  }
};

/**
 * Auto-detects scan rate (V/s) from time and potential columns.
 * Uses the median of |dE/dt| over the first monotonic segment to be
 * robust against noise and switching-point artefacts.
 */
const detectScanRate = (data: DataPoint[]): number | null => {
  if (data.length < 10) return null;

  // Need time data
  const hasTime = data.every(d => typeof d.time === 'number');
  if (!hasTime) return null;

  // Collect |dE/dt| for consecutive points
  const rates: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const dt = (data[i].time as number) - (data[i - 1].time as number);
    if (dt <= 0) continue;
    const dE = Math.abs(data[i].potential - data[i - 1].potential);
    if (dE > 0) {
      rates.push(dE / dt);
    }
  }

  if (rates.length < 5) return null;

  // Use median for robustness against outliers at switching points
  rates.sort((a, b) => a - b);
  const mid = Math.floor(rates.length / 2);
  const medianRate = rates.length % 2 === 0
    ? (rates[mid - 1] + rates[mid]) / 2
    : rates[mid];

  return medianRate;
};
