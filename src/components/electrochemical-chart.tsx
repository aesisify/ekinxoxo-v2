import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import type { CVPeakResult as PeakMarker } from '../math/cv-analysis';
import type { DataPoint } from '../types';

export interface ChartDataPoint {
  potential: number;
  rawCurrent: number;
  smoothedCurrent: number;
  baselineCurrent?: number;
  derivativeCurrent?: number;
  scan?: 'forward' | 'reverse' | 'combined';
  dataIndex?: number;
}

export interface ElectrochemicalChartProps {
  data?: ChartDataPoint[];
  forwardData?: ChartDataPoint[];
  reverseData?: ChartDataPoint[];
  forwardPeaks?: PeakMarker[];
  reversePeaks?: PeakMarker[];
  title?: string;
  showForwardScan?: boolean;
  showReverseScan?: boolean;
  showRawData?: boolean;
  showSmoothedData?: boolean;
  showBaseline?: boolean;
  showDerivative?: boolean;
  showPeakMarkers?: boolean;
  width?: number;
  height?: number;
  className?: string;
}

const getDomainWithPadding = (values: number[]): [number, number] => {
  const finiteValues = values.filter(value => Number.isFinite(value));

  if (finiteValues.length === 0) {
    return [-1, 1];
  }

  const minValue = Math.min(...finiteValues);
  const maxValue = Math.max(...finiteValues);

  if (minValue === maxValue) {
    const padding = Math.abs(minValue || 1) * 0.1;
    return [minValue - padding, maxValue + padding];
  }

  const padding = (maxValue - minValue) * 0.1;
  return [minValue - padding, maxValue + padding];
};

const scanStyles: Record<string, { smoothed: string; raw: string }> = {
  forward: { smoothed: '#ef4444', raw: '#2563eb' },
  reverse: { smoothed: '#8b5cf6', raw: '#0ea5e9' },
  combined: { smoothed: '#ef4444', raw: '#2563eb' }
};

export const ElectrochemicalChart: React.FC<ElectrochemicalChartProps> = ({
  data: combinedDataProp = [],
  forwardData = [],
  reverseData = [],
  forwardPeaks = [],
  reversePeaks = [],
  title = "Electrochemical Analysis",
  showForwardScan = true,
  showReverseScan = true,
  showRawData = true,
  showSmoothedData = true,
  showBaseline = false,
  showDerivative = false,
  showPeakMarkers = false,
  width,
  height,
  className = ""
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 400 });

  // Auto-calculate dimensions based on container
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const aspectRatio = 16 / 10; // 1.6:1 aspect ratio for charts
        const calculatedHeight = Math.max(300, Math.min(600, containerWidth / aspectRatio));
        
        setDimensions({
          width: containerWidth || 800,
          height: height || calculatedHeight
        });
      }
    };

    updateDimensions();
    
    // Add resize observer for responsive behavior
    const resizeObserver = new ResizeObserver(updateDimensions);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [height]);

  // Use provided dimensions or auto-calculated ones
  const chartWidth = width || dimensions.width;
  const chartHeight = height || dimensions.height;

  useEffect(() => {
    if (!svgRef.current) return;

    const splitSeriesProvided = forwardData.length > 0 || reverseData.length > 0;
    const activeSeries = [] as Array<{
      key: 'forward' | 'reverse' | 'combined';
      label: string;
      data: ChartDataPoint[];
      peaks: PeakMarker[];
    }>;

    if (splitSeriesProvided) {
      if (showForwardScan && forwardData.length > 0) {
        activeSeries.push({ key: 'forward', label: 'Forward Scan', data: forwardData, peaks: forwardPeaks });
      }

      if (showReverseScan && reverseData.length > 0) {
        activeSeries.push({ key: 'reverse', label: 'Reverse Scan', data: reverseData, peaks: reversePeaks });
      }
    } else if (combinedDataProp.length > 0) {
      activeSeries.push({ key: 'combined', label: 'Scan', data: combinedDataProp, peaks: [] });
    }

    // Clear previous content
    d3.select(svgRef.current).selectAll("*").remove();

    if (activeSeries.length === 0) {
      return;
    }

    const mergedData = activeSeries.flatMap(series => series.data);

    // Set up dimensions and margins
    const margin = { top: 20, right: 80, bottom: 50, left: 70 };
    const innerWidth = chartWidth - margin.left - margin.right;
    const innerHeight = chartHeight - margin.top - margin.bottom;

    // Create SVG
    const svg = d3.select(svgRef.current)
      .attr("width", chartWidth)
      .attr("height", chartHeight);

    // Create main group
    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Calculate scales
    const potentials = mergedData.map(d => d.potential);
    const currents = mergedData.map(d => d.rawCurrent);
    const smoothedCurrents = mergedData.map(d => d.smoothedCurrent);
    const derivativeCurrents = mergedData.map(d => d.derivativeCurrent ?? 0);
    const baselineCurrents = mergedData
      .filter(d => typeof d.baselineCurrent === 'number')
      .map(d => d.baselineCurrent as number);

    const xScale = d3.scaleLinear()
      .domain([
        Math.min(...potentials) - 0.1 * (Math.max(...potentials) - Math.min(...potentials)),
        Math.max(...potentials) + 0.1 * (Math.max(...potentials) - Math.min(...potentials))
      ])
      .range([0, innerWidth]);

    const allCurrents = [...currents, ...smoothedCurrents];
    if (showBaseline && baselineCurrents.length > 0) {
      allCurrents.push(...baselineCurrents);
    }
    const yScale = d3.scaleLinear()
      .domain(getDomainWithPadding(allCurrents))
      .range([innerHeight, 0]);

    const derivativeDomain = showDerivative && derivativeCurrents.length > 0
      ? getDomainWithPadding(derivativeCurrents)
      : null;

    const yDerivativeScale = derivativeDomain
      ? d3.scaleLinear()
          .domain(derivativeDomain)
          .range([innerHeight, 0])
      : null;

    // Create axes
    const xAxis = d3.axisBottom(xScale);
    const yAxis = d3.axisLeft(yScale);
    const yAxisRight = yDerivativeScale ? d3.axisRight(yDerivativeScale) : null;

    // Add X axis
    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(xAxis)
      .append("text")
      .attr("x", innerWidth / 2)
      .attr("y", 40)
      .attr("fill", "black")
      .style("text-anchor", "middle")
      .text("Potential (V)");

    // Add Y axis
    g.append("g")
      .call(yAxis)
      .append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", -50)
      .attr("x", -innerHeight / 2)
      .attr("fill", "black")
      .style("text-anchor", "middle")
      .text("Current (A)");

    if (yAxisRight) {
      g.append("g")
        .attr("transform", `translate(${innerWidth},0)`)
        .call(yAxisRight)
        .append("text")
        .attr("transform", "rotate(90)")
        .attr("y", -40)
        .attr("x", innerHeight / 2)
        .attr("fill", "#f59e0b")
        .style("text-anchor", "middle")
        .text("dI/dV (A/V)");
    }

    // Add grid lines
    g.append("g")
      .attr("class", "grid")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale)
        .tickSize(-innerHeight)
        .tickFormat(() => "")
      )
      .style("stroke-dasharray", "3,3")
      .style("opacity", 0.3);

    g.append("g")
      .attr("class", "grid")
      .call(d3.axisLeft(yScale)
        .tickSize(-innerWidth)
        .tickFormat(() => "")
      )
      .style("stroke-dasharray", "3,3")
      .style("opacity", 0.3);

    // Create line generators
    const smoothedLine = d3.line<ChartDataPoint>()
      .x(d => xScale(d.potential))
      .y(d => yScale(d.smoothedCurrent))
      .curve(d3.curveMonotoneX);

    const baselineLine = d3.line<ChartDataPoint>()
      .x(d => xScale(d.potential))
      .y(d => yScale(d.baselineCurrent ?? 0))
      .curve(d3.curveMonotoneX);

    const derivativeLine = yDerivativeScale
      ? d3.line<ChartDataPoint>()
          .x(d => xScale(d.potential))
          .y(d => yDerivativeScale(d.derivativeCurrent ?? 0))
          .curve(d3.curveMonotoneX)
      : null;

    // Draw each active series
    activeSeries.forEach(series => {
      const style = scanStyles[series.key] ?? scanStyles.combined;

      if (showRawData) {
        g.selectAll(`.raw-point-${series.key}`)
          .data(series.data)
          .enter()
          .append("circle")
          .attr("class", `raw-point-${series.key}`)
          .attr("cx", d => xScale(d.potential))
          .attr("cy", d => yScale(d.rawCurrent))
          .attr("r", 2)
          .attr("fill", style.raw)
          .attr("fill-opacity", 0.6);
      }

      if (showSmoothedData && series.data.length > 0) {
        g.append("path")
          .datum(series.data)
          .attr("fill", "none")
          .attr("stroke", style.smoothed)
          .attr("stroke-width", 2)
          .attr("d", smoothedLine);
      }

      if (showBaseline && series.data.some(d => d.baselineCurrent !== undefined)) {
        g.append("path")
          .datum(series.data)
          .attr("fill", "none")
          .attr("stroke", style.smoothed)
          .attr("stroke-width", 1.5)
          .attr("stroke-dasharray", "5,5")
          .attr("opacity", 0.7)
          .attr("d", baselineLine);
      }

      if (
        showDerivative &&
        derivativeLine &&
        series.data.some(d => typeof d.derivativeCurrent === 'number')
      ) {
        g.append("path")
          .datum(series.data)
          .attr("fill", "none")
          .attr("stroke", "#f59e0b")
          .attr("stroke-width", 1.5)
          .attr("stroke-dasharray", "2,2")
          .attr("opacity", series.key === 'reverse' ? 0.8 : 1)
          .attr("d", derivativeLine);
      }
    });

    // Add legend
    const legend = svg.append("g")
      .attr("class", "legend")
      .attr("transform", `translate(${chartWidth - 150}, 20)`);

    const legendItems: Array<{ color: string; text: string }> = [];
    activeSeries.forEach(series => {
      if (showSmoothedData) {
        const style = scanStyles[series.key] ?? scanStyles.combined;
        legendItems.push({ color: style.smoothed, text: series.label });
      }
    });
    if (showDerivative) legendItems.push({ color: "#f59e0b", text: "Derivative (dI/dV)" });

    legendItems.forEach((item, index) => {
      const legendRow = legend.append("g")
        .attr("transform", `translate(0, ${index * 20})`);

      legendRow.append("rect")
        .attr("width", 15)
        .attr("height", 15)
        .attr("fill", item.color);

      legendRow.append("text")
        .attr("x", 20)
        .attr("y", 12)
        .attr("font-size", "12px")
        .text(item.text);
    });

    // Add peak markers if enabled
    if (showPeakMarkers) {
      const peakLayer = g.append("g").attr("class", "peak-markers-layer");

      activeSeries.forEach(series => {
        if (!series.peaks?.length) return;

        const style = scanStyles[series.key] ?? scanStyles.combined;
        const indexMap = new Map<number, ChartDataPoint>();
        series.data.forEach(point => {
          if (typeof point.dataIndex === 'number') {
            indexMap.set(point.dataIndex, point);
          }
        });

        series.peaks.forEach(peak => {
          const point = indexMap.get(peak.index);
          if (!point) return;

          const x = xScale(point.potential);
          const yPeak = yScale(point.smoothedCurrent);
          const yBase = yScale(point.baselineCurrent ?? 0);

          const group = peakLayer.append("g")
            .attr("class", `peak-marker peak-${series.key}`)
            .attr("opacity", 0.9);

          // Shaded area between smoothed data and baseline within peak bounds
          const peakAreaData = series.data.filter(d => {
            if (typeof d.dataIndex !== 'number') return false;
            return d.dataIndex >= peak.startIndex && d.dataIndex <= peak.endIndex;
          });
          if (peakAreaData.length > 1) {
            const areaGen = d3.area<ChartDataPoint>()
              .x(d => xScale(d.potential))
              .y0(d => yScale(d.baselineCurrent ?? 0))
              .y1(d => yScale(d.smoothedCurrent))
              .curve(d3.curveMonotoneX);

            group.append("path")
              .datum(peakAreaData)
              .attr("d", areaGen)
              .attr("fill", style.smoothed)
              .attr("opacity", 0.15);
          }

          // Height line from baseline to peak (the measured peak height)
          group.append("line")
            .attr("x1", x)
            .attr("y1", yBase)
            .attr("x2", x)
            .attr("y2", yPeak)
            .attr("stroke", style.smoothed)
            .attr("stroke-dasharray", "4,4")
            .attr("stroke-width", 1.5);

          // Baseline dot
          group.append("circle")
            .attr("cx", x)
            .attr("cy", yBase)
            .attr("r", 3)
            .attr("fill", "white")
            .attr("stroke", style.smoothed)
            .attr("stroke-width", 1.5);

          // Peak dot
          group.append("circle")
            .attr("cx", x)
            .attr("cy", yPeak)
            .attr("r", 4)
            .attr("fill", style.smoothed)
            .attr("stroke", "white")
            .attr("stroke-width", 2);
        });
      });
    }

    // Add tooltip functionality
    const tooltip = d3.select("body").append("div")
      .attr("class", "tooltip")
      .style("position", "absolute")
      .style("visibility", "hidden")
      .style("background", "white")
      .style("border", "1px solid #ddd")
      .style("padding", "8px")
      .style("border-radius", "4px")
      .style("font-size", "12px");

    interface ChartDataPoint {
  potential: number;
  rawCurrent: number;
  smoothedCurrent: number;
  derivativeCurrent?: number;
  baselineCurrent?: number;
  scan?: 'forward' | 'reverse' | 'combined';
  dataIndex?: number;
}

interface D3MouseEvent {
  pageX: number;
  pageY: number;
}

// Add hover interactions
    if (showRawData) {
      activeSeries.forEach(series => {
        g.selectAll(`.raw-point-${series.key}`)
          .on("mouseover", function(event: any, d: any) {
            const chartData = d as ChartDataPoint;
            const mouseEvent = event as D3MouseEvent;
            d3.select(this)
              .attr("r", 4)
              .attr("fill-opacity", 1);
            
            tooltip.style("visibility", "visible")
              .html(`
                <strong>Potential:</strong> ${chartData.potential.toFixed(4)} V<br/>
                <strong>Raw Current:</strong> ${chartData.rawCurrent.toExponential(3)} A<br/>
                <strong>Smoothed Current:</strong> ${chartData.smoothedCurrent.toExponential(3)} A
                ${typeof chartData.derivativeCurrent === 'number' ? `<br/><strong>Derivative:</strong> ${chartData.derivativeCurrent.toExponential(3)} A/V` : ''}
                ${typeof chartData.baselineCurrent === 'number' ? `<br/><strong>Baseline:</strong> ${chartData.baselineCurrent.toExponential(3)} A` : ''}
                ${chartData.scan ? `<br/><strong>Scan:</strong> ${chartData.scan === 'forward' ? 'Forward' : chartData.scan === 'reverse' ? 'Reverse' : 'Combined'}` : ''}
              `)
              .style("left", (mouseEvent.pageX + 10) + "px")
              .style("top", (mouseEvent.pageY - 28) + "px");
          })
          .on("mouseout", function() {
            d3.select(this)
              .attr("r", 2)
              .attr("fill-opacity", 0.6);
            tooltip.style("visibility", "hidden");
          });
      });
    }

  }, [
    combinedDataProp,
    forwardData,
    reverseData,
    forwardPeaks,
    reversePeaks,
    showForwardScan,
    showReverseScan,
    showRawData,
    showSmoothedData,
    showBaseline,
    showDerivative,
    showPeakMarkers,
    chartWidth,
    chartHeight
  ]);

  return (
    <div ref={containerRef} className={`w-full ${className}`}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      </div>
      <svg ref={svgRef}></svg>
    </div>
  );
};

/**
 * Simplified chart for quick visualization
 */
export const SimpleElectrochemicalChart: React.FC<{
  rawData: DataPoint[];
  smoothedData: DataPoint[];
  className?: string;
}> = ({ rawData, smoothedData, className = "" }) => {
  // Combine data
  const combinedData: ChartDataPoint[] = rawData.map((point, index) => ({
    potential: point.potential,
    rawCurrent: point.current,
    smoothedCurrent: smoothedData[index]?.current ?? 0
  }));

  return (
    <ElectrochemicalChart
      data={combinedData}
      showRawData={true}
      showSmoothedData={true}
      showBaseline={false}
      showDerivative={false}
      className={className}
    />
  );
};

/**
 * Advanced chart with peak markers and annotations
 */
export const AdvancedElectrochemicalChart: React.FC<{
  rawData: DataPoint[];
  smoothedData: DataPoint[];
  baselineData?: DataPoint[];
  peakIndex?: number;
  startIndex?: number;
  endIndex?: number;
  className?: string;
}> = ({ 
  rawData, 
  smoothedData, 
  baselineData = [], 
  peakIndex, 
  startIndex, 
  endIndex, 
  className = "" 
}) => {
  // Combine data
  const combinedData: ChartDataPoint[] = rawData.map((point, index) => ({
    potential: point.potential,
    rawCurrent: point.current,
    smoothedCurrent: smoothedData[index]?.current ?? 0,
    baselineCurrent: baselineData[index]?.current
  }));

  return (
    <div className={`w-full ${className}`}>
      <ElectrochemicalChart
        data={combinedData}
        showRawData={true}
        showSmoothedData={true}
        showBaseline={baselineData.length > 0}
        showDerivative={false}
      />
      
      {/* Peak markers */}
      {peakIndex !== undefined && (
        <div className="mt-2 text-sm text-gray-600">
          Peak detected at: {combinedData[peakIndex]?.potential?.toFixed(4)} V, 
          Current: {combinedData[peakIndex]?.smoothedCurrent?.toExponential(3)} A
        </div>
      )}
      
      {/* Boundary markers */}
      {(startIndex !== undefined && endIndex !== undefined) && (
        <div className="mt-2 text-sm text-gray-600">
          Peak boundaries: {combinedData[startIndex]?.potential?.toFixed(4)} V - 
          {combinedData[endIndex]?.potential?.toFixed(4)} V
        </div>
      )}
    </div>
  );
};
