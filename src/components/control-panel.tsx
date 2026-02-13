import React from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Label } from './ui/label';
import type { AnalysisConfig } from '../types';

export interface ControlPanelProps {
  config: AnalysisConfig;
  onConfigChange: (config: AnalysisConfig) => void;
  className?: string;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  config,
  onConfigChange,
  className = ""
}) => {
  const smoothingOptions = [5, 9, 15, 21];

  const defaultConfig: AnalysisConfig = {
    smoothingEnabled: true,
    smoothingWindow: 9,
    baselineMethod: 'rubberband',
    aslsLambda: 1e6,
    aslsP: 0.01,
    rubberbandIterations: 40,
    rubberbandWindowSize: 80,
    linearAnchorFraction: 0.1,
    peakProminenceThreshold: 0.05
  };

  return (
    <Card className={`p-4 ${className}`}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">Analysis</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onConfigChange({ ...defaultConfig, scanRate: config.scanRate })}
            className="h-5 px-1.5 text-[10px] text-gray-400 hover:text-gray-600"
          >
            Reset
          </Button>
        </div>

        {/* Smoothing toggle + window selector */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Smoothing</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onConfigChange({ ...config, smoothingEnabled: !config.smoothingEnabled })}
              className="h-6 px-2 text-xs"
              style={config.smoothingEnabled
                ? { borderColor: '#3b82f6', color: '#3b82f6', backgroundColor: '#3b82f610' }
                : {}
              }
            >
              {config.smoothingEnabled ? 'On' : 'Off'}
            </Button>
          </div>
          {config.smoothingEnabled && (
            <div className="flex gap-1.5">
              {smoothingOptions.map(w => (
                <Button
                  key={w}
                  variant="outline"
                  size="sm"
                  onClick={() => onConfigChange({ ...config, smoothingWindow: w })}
                  className="h-7 flex-1 text-xs"
                  style={config.smoothingWindow === w
                    ? { borderColor: '#3b82f6', color: '#3b82f6', backgroundColor: '#3b82f610' }
                    : {}
                  }
                >
                  {w}
                </Button>
              ))}
            </div>
          )}
        </div>

        {/* Baseline method selector */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Baseline</Label>
          <div className="flex gap-1.5">
            {([
              { key: 'rubberband' as const, label: 'Rubberband' },
              { key: 'linear' as const, label: 'Linear' },
              { key: 'asls' as const, label: 'ASLS' }
            ]).map(({ key, label }) => (
              <Button
                key={key}
                variant="outline"
                size="sm"
                onClick={() => onConfigChange({ ...config, baselineMethod: key })}
                className="h-7 flex-1 text-xs"
                style={config.baselineMethod === key
                  ? { borderColor: '#10b981', color: '#10b981', backgroundColor: '#10b98110' }
                  : {}
                }
              >
                {label}
              </Button>
            ))}
          </div>

          {/* ASLS parameters */}
          {config.baselineMethod === 'asls' && (
            <div className="space-y-2 pt-1">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-gray-500">λ (smoothness)</span>
                  <span className="text-[10px] font-mono text-gray-700">{config.aslsLambda.toExponential(0)}</span>
                </div>
                <input
                  type="range"
                  min={3}
                  max={9}
                  step={0.5}
                  value={Math.log10(config.aslsLambda)}
                  onChange={e => onConfigChange({ ...config, aslsLambda: Math.pow(10, parseFloat(e.target.value)) })}
                  className="w-full h-1.5 accent-emerald-500"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-gray-500">p (asymmetry)</span>
                  <span className="text-[10px] font-mono text-gray-700">{config.aslsP.toFixed(3)}</span>
                </div>
                <input
                  type="range"
                  min={0.001}
                  max={0.1}
                  step={0.001}
                  value={config.aslsP}
                  onChange={e => onConfigChange({ ...config, aslsP: parseFloat(e.target.value) })}
                  className="w-full h-1.5 accent-emerald-500"
                />
              </div>
            </div>
          )}

          {/* Rubberband parameters */}
          {config.baselineMethod === 'rubberband' && (
            <div className="space-y-2 pt-1">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-gray-500">Iterations</span>
                  <span className="text-[10px] font-mono text-gray-700">{config.rubberbandIterations}</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={config.rubberbandIterations}
                  onChange={e => onConfigChange({ ...config, rubberbandIterations: parseInt(e.target.value) })}
                  className="w-full h-1.5 accent-emerald-500"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-gray-500">Window size</span>
                  <span className="text-[10px] font-mono text-gray-700">{config.rubberbandWindowSize}</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={200}
                  step={10}
                  value={config.rubberbandWindowSize}
                  onChange={e => onConfigChange({ ...config, rubberbandWindowSize: parseInt(e.target.value) })}
                  className="w-full h-1.5 accent-emerald-500"
                />
              </div>
            </div>
          )}

          {/* Linear parameters */}
          {config.baselineMethod === 'linear' && (
            <div className="pt-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-gray-500">Anchor fraction</span>
                <span className="text-[10px] font-mono text-gray-700">{(config.linearAnchorFraction * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min={0.02}
                max={0.3}
                step={0.01}
                value={config.linearAnchorFraction}
                onChange={e => onConfigChange({ ...config, linearAnchorFraction: parseFloat(e.target.value) })}
                className="w-full h-1.5 accent-emerald-500"
              />
            </div>
          )}
        </div>

        {/* Peak detection */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Peak Detection</Label>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-gray-500">Min prominence</span>
              <span className="text-[10px] font-mono text-gray-700">{(config.peakProminenceThreshold * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min={0.01}
              max={0.3}
              step={0.01}
              value={config.peakProminenceThreshold}
              onChange={e => onConfigChange({ ...config, peakProminenceThreshold: parseFloat(e.target.value) })}
              className="w-full h-1.5 accent-blue-500"
            />
          </div>
        </div>
      </div>
    </Card>
  );
};

export default ControlPanel;
