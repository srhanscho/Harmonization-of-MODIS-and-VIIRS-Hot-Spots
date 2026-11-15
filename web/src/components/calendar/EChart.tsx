"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, CustomChart, HeatmapChart, LineChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  HeatmapChart,
  LineChart,
  BarChart,
  CustomChart,
  GridComponent,
  VisualMapComponent,
  TooltipComponent,
  MarkAreaComponent,
  MarkLineComponent,
  LegendComponent,
  AriaComponent,
  CanvasRenderer,
]);

export type EChartsOption = echarts.EChartsCoreOption;
export interface EChartClick {
  seriesId?: string;
  seriesIndex?: number;
  data?: unknown;
  event?: { offsetX: number; offsetY: number };
}

interface Props {
  option: EChartsOption;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel: string;
  onClick?: (p: EChartClick) => void;
}

/** Minimal ECharts wrapper (tree-shaken core, resize-aware). */
export function EChart({ option, className, style, ariaLabel, onClick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onClick);

  useEffect(() => {
    clickRef.current = onClick;
  }, [onClick]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    if (process.env.NODE_ENV !== "production") {
      const w = window as unknown as { __charts?: echarts.ECharts[] };
      (w.__charts ??= []).push(chart);
    }
    chart.on("click", (p) => {
      const ev = (p as unknown as { event?: { offsetX: number; offsetY: number } }).event;
      clickRef.current?.({
        seriesId: (p as { seriesId?: string }).seriesId,
        seriesIndex: p.seriesIndex,
        data: p.data,
        event: ev ? { offsetX: ev.offsetX, offsetY: ev.offsetY } : undefined,
      });
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option]);

  return <div ref={ref} className={className} style={style} role="img" aria-label={ariaLabel} />;
}
