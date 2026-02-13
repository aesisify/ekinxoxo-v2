import React from 'react';
import { ScatterChart, Spline, TrendingDown, Activity, MapPin, ArrowRight, ArrowLeft } from 'lucide-react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Label } from './ui/label';

export interface DisplayOptionsProps {
  showRawData: boolean;
  showSmoothedData: boolean;
  showBaseline: boolean;
  showDerivative: boolean;
  showPeakMarkers: boolean;
  showForwardScan: boolean;
  showReverseScan: boolean;
  hasReverseData: boolean;
  onToggleRawData: (show: boolean) => void;
  onToggleSmoothedData: (show: boolean) => void;
  onToggleBaseline: (show: boolean) => void;
  onToggleDerivative: (show: boolean) => void;
  onTogglePeakMarkers: (show: boolean) => void;
  onToggleForwardScan: (show: boolean) => void;
  onToggleReverseScan: (show: boolean) => void;
  className?: string;
}

export const DisplayOptions: React.FC<DisplayOptionsProps> = ({
  showRawData,
  showSmoothedData,
  showBaseline,
  showDerivative,
  showPeakMarkers,
  showForwardScan,
  showReverseScan,
  hasReverseData,
  onToggleRawData,
  onToggleSmoothedData,
  onToggleBaseline,
  onToggleDerivative,
  onTogglePeakMarkers,
  onToggleForwardScan,
  onToggleReverseScan,
  className = ""
}) => {
  const dataLayers = [
    { key: 'raw', label: 'Raw', icon: ScatterChart, color: '#3b82f6', isShown: showRawData, onToggle: onToggleRawData },
    { key: 'smoothed', label: 'Smoothed', icon: Spline, color: '#ef4444', isShown: showSmoothedData, onToggle: onToggleSmoothedData },
    { key: 'baseline', label: 'Baseline', icon: TrendingDown, color: '#10b981', isShown: showBaseline, onToggle: onToggleBaseline },
    { key: 'derivative', label: 'dI/dE', icon: Activity, color: '#f59e0b', isShown: showDerivative, onToggle: onToggleDerivative },
    { key: 'peaks', label: 'Peaks', icon: MapPin, color: '#a855f7', isShown: showPeakMarkers, onToggle: onTogglePeakMarkers },
  ];

  return (
    <Card className={`p-4 ${className}`}>
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-800">Display</h3>

        {/* Data Layers — icon toggle buttons */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Data Layers</Label>
          <div className="flex flex-wrap gap-1.5">
            {dataLayers.map((layer) => {
              const Icon = layer.icon;
              return (
                <Button
                  key={layer.key}
                  variant="outline"
                  size="sm"
                  onClick={() => layer.onToggle(!layer.isShown)}
                  className="h-8 px-2.5 gap-1.5"
                  style={layer.isShown ? { borderColor: layer.color, color: layer.color, backgroundColor: `${layer.color}10` } : {}}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="text-xs">{layer.label}</span>
                </Button>
              );
            })}
          </div>
        </div>

        {/* Scan Visibility — icon toggle buttons */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Scans</Label>
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onToggleForwardScan(!showForwardScan)}
              className="h-8 px-2.5 gap-1.5 flex-1"
              style={showForwardScan ? { borderColor: '#ef4444', color: '#ef4444', backgroundColor: '#ef444410' } : {}}
            >
              <ArrowRight className="w-3.5 h-3.5" />
              <span className="text-xs">Forward</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasReverseData}
              onClick={() => hasReverseData && onToggleReverseScan(!showReverseScan)}
              className="h-8 px-2.5 gap-1.5 flex-1"
              style={showReverseScan && hasReverseData ? { borderColor: '#8b5cf6', color: '#8b5cf6', backgroundColor: '#8b5cf610' } : {}}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="text-xs">Reverse</span>
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default DisplayOptions;
