export interface DataPoint {
  potential: number;          // Measured potential at working electrode (V)
  current: number;            // Current value (A)
  time?: number;              // Time value (s) — used for charge calculation (Q = ∫I·dt)
  appliedPotential?: number;  // Applied/programmed potential (V) — difference from measured reveals iR drop
  scan?: number;              // Scan/cycle number from instrument (1-indexed)
  pointIndex?: number;        // Point index from instrument
  qPlus?: number;             // Instrument-reported anodic charge (C)
  qMinus?: number;            // Instrument-reported cathodic charge (C)
}

export interface AnalysisConfig {
  smoothingEnabled: boolean;           // Whether to apply Savitzky-Golay smoothing
  smoothingWindow: number;             // Window size for Savitzky-Golay smoothing (5, 9, 15, or 21)
  baselineMethod: 'rubberband' | 'linear' | 'asls'; // Baseline fitting method
  scanRate?: number;                   // Scan rate (V/s) — auto-detected from data or user-provided

  // ASLS baseline parameters
  aslsLambda: number;                  // Smoothness penalty (typical: 1e4–1e8, default 1e6)
  aslsP: number;                       // Asymmetry weight 0<p<1 (typical: 0.001–0.1, default 0.01)

  // Rubberband baseline parameters
  rubberbandIterations: number;        // Morphological iterations (default 40)
  rubberbandWindowSize: number;        // Erosion/dilation window (default 80)

  // Linear baseline parameters
  linearAnchorFraction: number;        // Fraction of data at each end used as anchors (default 0.1)

  // Peak detection
  peakProminenceThreshold: number;     // Min prominence as fraction of max magnitude (default 0.05)
}

/**
 * Summary of paired oxidation/reduction peak parameters.
 * Computed after individual peak detection on forward and reverse scans.
 */
export interface CVPairParameters {
  deltaEp: number;      // ΔEp = Epa − Epc (V) — peak-to-peak separation
  halfWavePotential: number; // E½ = (Epa + Epc) / 2 (V)
  peakCurrentRatio: number;  // |Ipa / Ipc| — reversibility indicator (ideal ≈ 1.0)
}

export interface CycleData {
  forward: DataPoint[];     // Forward (oxidation) scan data
  reverse: DataPoint[];     // Reverse (reduction) scan data
}
