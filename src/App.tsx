import { useState, useCallback } from 'react';
import { Code, Heart } from 'lucide-react';
import { FileUploader } from './components/file-uploader';
import { ElectrochemicalChart, type ChartDataPoint } from './components/electrochemical-chart';
import { ControlPanel } from './components/control-panel';
import { DisplayOptions } from './components/display-options';
import { parseElectrochemicalData } from './lib/data-parser';
import { splitCycles, type CycleResult } from './lib/cycle-splitter';
import { analyzeCVScan, type CVPeakResult } from './math/cv-analysis';
import type { DataPoint, AnalysisConfig, CVPairParameters } from './types';

interface ScanState {
  raw: DataPoint[];
  smoothed: DataPoint[];
  derivative: number[];
  baseline: DataPoint[];
  peaks: CVPeakResult[];
}

const emptyScan: ScanState = { raw: [], smoothed: [], derivative: [], baseline: [], peaks: [] };

const buildChartData = (
  scanType: 'forward' | 'reverse',
  scan: ScanState
): ChartDataPoint[] => {
  if (scan.smoothed.length === 0) return [];

  return scan.smoothed.map((point, index) => ({
    potential: point.potential,
    rawCurrent: scan.raw[index]?.current ?? 0,
    smoothedCurrent: point.current,
    baselineCurrent: scan.baseline[index]?.current ?? 0,
    derivativeCurrent: scan.derivative[index] ?? 0,
    scan: scanType,
    dataIndex: index
  }));
};

export function App() {
  const [rawData, setRawData] = useState<DataPoint[]>([]);
  const [allCycles, setAllCycles] = useState<CycleResult[]>([]);
  const [selectedCycleIndex, setSelectedCycleIndex] = useState(0);
  const [forward, setForward] = useState<ScanState>(emptyScan);
  const [reverse, setReverse] = useState<ScanState>(emptyScan);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [showRawData, setShowRawData] = useState(false);
  const [showSmoothedData, setShowSmoothedData] = useState(true);
  const [showBaseline, setShowBaseline] = useState(false);
  const [showDerivative, setShowDerivative] = useState(false);
  const [showPeakMarkers, setShowPeakMarkers] = useState(true);
  const [showForwardScan, setShowForwardScan] = useState(true);
  const [showReverseScan, setShowReverseScan] = useState(true);
  const [instrumentCharge, setInstrumentCharge] = useState<{ qPlus: number; qMinus: number } | null>(null);

  // Default analysis configuration
  const [config, setConfig] = useState<AnalysisConfig>({
    smoothingEnabled: true,
    smoothingWindow: 9,
    baselineMethod: 'rubberband',
    aslsLambda: 1e6,
    aslsP: 0.01,
    rubberbandIterations: 40,
    rubberbandWindowSize: 80,
    linearAnchorFraction: 0.1,
    peakProminenceThreshold: 0.05
  });

  const analyzeCycle = useCallback((cycle: CycleResult, cfg: AnalysisConfig) => {
    const fwdResult = analyzeCVScan(cycle.data.forward, cfg, 'forward');
    setForward({ raw: cycle.data.forward, ...fwdResult });

    const revResult = analyzeCVScan(cycle.data.reverse, cfg, 'reverse');
    setReverse({ raw: cycle.data.reverse, ...revResult });
  }, []);

  const processData = useCallback((data: DataPoint[], cfg: AnalysisConfig) => {
    const splitResult = splitCycles(data);
    setAllCycles(splitResult.cycles);
    setSelectedCycleIndex(splitResult.selectedIndex);

    if (splitResult.cycles.length > 0) {
      analyzeCycle(splitResult.cycles[splitResult.selectedIndex], cfg);
    }

    if (splitResult.warnings.length > 0) {
      console.warn('Cycle split warnings:', splitResult.warnings);
    }
  }, [analyzeCycle]);

  const handleFileLoad = async (content: string) => {
    setIsLoading(true);
    setError('');

    try {
      const parseResult = parseElectrochemicalData(content);

      if (parseResult.error) {
        throw new Error(parseResult.error);
      }
      if (parseResult.data.length === 0) {
        throw new Error('No valid data found in file');
      }

      // Apply auto-detected scan rate to config
      const updatedConfig: AnalysisConfig = {
        ...config,
        scanRate: parseResult.scanRate ?? config.scanRate
      };
      setConfig(updatedConfig);

      setRawData(parseResult.data);
      setInstrumentCharge(parseResult.instrumentCharge);
      processData(parseResult.data, updatedConfig);

      if (parseResult.warnings.length > 0) {
        console.warn('Parse warnings:', parseResult.warnings);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process file');
      setRawData([]);
      setAllCycles([]);
      setForward(emptyScan);
      setReverse(emptyScan);
      setInstrumentCharge(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfigChange = (newConfig: AnalysisConfig) => {
    setConfig(newConfig);

    if (allCycles.length > 0) {
      setIsLoading(true);
      try {
        analyzeCycle(allCycles[selectedCycleIndex], newConfig);
      } catch {
        setError('Failed to re-process data with new settings');
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleCycleChange = (index: number) => {
    setSelectedCycleIndex(index);
    if (allCycles[index]) {
      setIsLoading(true);
      try {
        analyzeCycle(allCycles[index], config);
      } catch {
        setError('Failed to analyze selected cycle');
      } finally {
        setIsLoading(false);
      }
    }
  };

  const forwardChartData = buildChartData('forward', forward);
  const reverseChartData = buildChartData('reverse', reverse);
  const hasChartData = forwardChartData.length > 0 || reverseChartData.length > 0;

  // Compute iR drop from applied vs measured potential
  const iRDrop: { mean: number; max: number } | null = (() => {
    const withApplied = rawData.filter(d => d.appliedPotential !== undefined);
    if (withApplied.length === 0) return null;
    const drops = withApplied.map(d => Math.abs(d.appliedPotential! - d.potential));
    const mean = drops.reduce((a, b) => a + b, 0) / drops.length;
    const max = Math.max(...drops);
    return { mean, max };
  })();

  // Compute CV pair parameters (ΔEp, E½, Ipa/Ipc) when both scans have peaks
  const cvPairParams: CVPairParameters | null = (() => {
    if (forward.peaks.length === 0 || reverse.peaks.length === 0) return null;
    // Use the most prominent peak from each scan (first in sorted list)
    const fwdPeak = forward.peaks[0];
    const revPeak = reverse.peaks[0];
    const epa = fwdPeak.potential;  // Anodic peak potential
    const epc = revPeak.potential;  // Cathodic peak potential
    const ipa = fwdPeak.height;     // Anodic peak current (baseline-corrected)
    const ipc = revPeak.height;     // Cathodic peak current (baseline-corrected)
    return {
      deltaEp: epa - epc,
      halfWavePotential: (epa + epc) / 2,
      peakCurrentRatio: ipc > 0 ? ipa / ipc : 0
    };
  })();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Left Sidebar - Controls */}
          <div className="lg:col-span-1 space-y-4">
            <FileUploader onFileLoad={handleFileLoad} />

            {rawData.length > 0 && (
              <>
                {allCycles.length > 1 && (
                  <div className="bg-white border border-gray-200 rounded-lg p-3">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Cycle</p>
                    <div className="flex flex-wrap gap-1.5">
                      {allCycles.map((cycle, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleCycleChange(idx)}
                          className={`h-7 px-2.5 text-xs rounded-md border transition-colors ${
                            idx === selectedCycleIndex
                              ? 'border-violet-500 text-violet-600 bg-violet-50 font-medium'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {cycle.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <ControlPanel
                  config={config}
                  onConfigChange={handleConfigChange}
                />
                <DisplayOptions
                  showRawData={showRawData}
                  showSmoothedData={showSmoothedData}
                  showBaseline={showBaseline}
                  showDerivative={showDerivative}
                  showPeakMarkers={showPeakMarkers}
                  showForwardScan={showForwardScan}
                  showReverseScan={showReverseScan}
                  hasReverseData={reverse.raw.length > 0}
                  onToggleRawData={setShowRawData}
                  onToggleSmoothedData={setShowSmoothedData}
                  onToggleBaseline={setShowBaseline}
                  onToggleDerivative={setShowDerivative}
                  onTogglePeakMarkers={setShowPeakMarkers}
                  onToggleForwardScan={setShowForwardScan}
                  onToggleReverseScan={setShowReverseScan}
                />
              </>
            )}

            {isLoading && (
              <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-blue-800 text-sm">Processing...</span>
                </div>
              </div>
            )}
          </div>

          {/* Main Content - Chart */}
          <div className="lg:col-span-3">
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-800">{error}</p>
              </div>
            )}

            {isLoading && (
              <div className="flex items-center justify-center h-96">
                <div className="text-gray-500">Processing data...</div>
              </div>
            )}

            {!isLoading && rawData.length === 0 && (
              <div className="flex items-center justify-center h-96 border-2 border-dashed border-gray-300 rounded-lg">
                <div className="text-center">
                  <p className="text-gray-500 mb-2">No data loaded</p>
                  <p className="text-sm text-gray-400">Upload an electrochemical data file to begin analysis</p>
                </div>
              </div>
            )}

            {!isLoading && hasChartData && (
              <>
                <ElectrochemicalChart
                  forwardData={forwardChartData}
                  reverseData={reverseChartData}
                  forwardPeaks={forward.peaks}
                  reversePeaks={reverse.peaks}
                  showForwardScan={showForwardScan}
                  showReverseScan={showReverseScan}
                  showRawData={showRawData}
                  showSmoothedData={showSmoothedData}
                  showBaseline={showBaseline}
                  showDerivative={showDerivative}
                  showPeakMarkers={showPeakMarkers}
                  className="bg-white p-4 rounded-lg border border-gray-200"
                />

                {/* CV Pair Parameters */}
                {(cvPairParams || iRDrop || instrumentCharge) && (
                  <div className="mt-4 bg-white border border-gray-200 rounded-lg p-4">
                    <p className="text-sm font-semibold text-gray-800 mb-3">Electrochemical Parameters</p>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      {cvPairParams && (
                        <>
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">ΔEp</p>
                            <p className="text-lg font-semibold text-gray-900">{(cvPairParams.deltaEp * 1000).toFixed(1)} <span className="text-xs font-normal text-gray-500">mV</span></p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">E½</p>
                            <p className="text-lg font-semibold text-gray-900">{cvPairParams.halfWavePotential.toFixed(4)} <span className="text-xs font-normal text-gray-500">V</span></p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">|Ipa/Ipc|</p>
                            <p className="text-lg font-semibold text-gray-900">{cvPairParams.peakCurrentRatio.toFixed(3)}</p>
                          </div>
                        </>
                      )}
                      {iRDrop && (
                        <>
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">iR drop (mean)</p>
                            <p className="text-lg font-semibold text-gray-900">{(iRDrop.mean * 1000).toFixed(2)} <span className="text-xs font-normal text-gray-500">mV</span></p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">iR drop (max)</p>
                            <p className="text-lg font-semibold text-gray-900">{(iRDrop.max * 1000).toFixed(2)} <span className="text-xs font-normal text-gray-500">mV</span></p>
                          </div>
                        </>
                      )}
                      {instrumentCharge && (
                        <>
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">Q+ (instr.)</p>
                            <p className="text-lg font-semibold text-gray-900">{instrumentCharge.qPlus.toExponential(2)} <span className="text-xs font-normal text-gray-500">C</span></p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">Q− (instr.)</p>
                            <p className="text-lg font-semibold text-gray-900">{instrumentCharge.qMinus.toExponential(2)} <span className="text-xs font-normal text-gray-500">C</span></p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-sm font-semibold text-gray-800 mb-3">Peaks</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                      { label: 'Oxidation', peaks: forward.peaks },
                      { label: 'Reduction', peaks: reverse.peaks }
                    ].map(({ label, peaks }) => (
                      <div key={label} className="bg-white border border-gray-200 rounded-md p-3">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
                        {peaks.length === 0 ? (
                          <p className="text-xs text-gray-400 mt-2">No peaks detected.</p>
                        ) : (
                          <div className="overflow-x-auto mt-2">
                            <table className="min-w-full text-xs text-left text-gray-600">
                              <thead>
                                <tr className="text-gray-500 border-b border-gray-100">
                                  <th className="py-1 pr-2">#</th>
                                  <th className="py-1 pr-2">Ep (V)</th>
                                  <th className="py-1 pr-2">Ip (A)</th>
                                  <th className="py-1 pr-2">Q ({peaks[0]?.chargeUnit ?? 'C'})</th>
                                </tr>
                              </thead>
                              <tbody>
                                {peaks.map((peak, index) => (
                                  <tr key={`${label}-peak-${peak.index}-${index}`} className="border-b border-gray-50">
                                    <td className="py-1 pr-2 text-gray-700">{index + 1}</td>
                                    <td className="py-1 pr-2">{peak.potential.toFixed(4)}</td>
                                    <td className="py-1 pr-2">{peak.height.toExponential(2)}</td>
                                    <td className="py-1 pr-2">{peak.area.toExponential(2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-3 space-y-1">
        <p className="text-[11px] text-gray-400">All processing happens in your browser — no data is uploaded or stored.</p>
        <div className="text-xs flex gap-1 items-center justify-center text-gray-400">
          <Code className="h-4 w-4" />
          <span>with</span>
          <Heart className="h-4 w-4 text-red-500" />
          <span>by</span>
          <a href="https://github.com/aesisify/ekinxoxo-v2" target="_blank" className="underline text-indigo-300">Oğuz Gergin</a>
          <span>and</span>
          <a href="https://metal-urjia.blogspot.com/" target="_blank" className="underline text-indigo-300">Ekin Metin</a>
        </div>
      </div>
    </div>
  );
}

export default App;