"use client";

import { useMemo } from "react";
import { EChart, type EChartsOption } from "./EChart";
import { useI18n } from "@/lib/i18n";
import { SERIES, UI } from "@/lib/palette";
import { FIRST_YEAR, VIIRS_START_YEAR, fmt } from "@/lib/series";
import type { DisplayMode, MonthlyRow } from "@/lib/types";

const d = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-01`;

export function TimeSeries({ rows, mode }: { rows: MonthlyRow[]; mode: DisplayMode }) {
  const { t } = useI18n();
  const option = useMemo<EChartsOption>(() => {
    const sorted = [...rows].filter((r) => r.year >= FIRST_YEAR).sort((a, b) => a.year - b.year || a.month - b.month);
    const series: unknown[] = [];
    const legend: string[] = [];
    if (mode === "raw") {
      legend.push(t("modisRaw"), t("viirsRaw"));
      series.push(
        {
          name: t("modisRaw"),
          type: "line",
          showSymbol: false,
          lineStyle: { width: 1.4, color: SERIES.modis },
          itemStyle: { color: SERIES.modis },
          connectNulls: false,
          data: sorted.filter((r) => r.year < VIIRS_START_YEAR).map((r) => [d(r.year, r.month), r.raw_modis ?? null]),
        },
        {
          name: t("viirsRaw"),
          type: "line",
          showSymbol: false,
          lineStyle: { width: 1.4, color: SERIES.viirs },
          itemStyle: { color: SERIES.viirs },
          connectNulls: false,
          data: sorted.filter((r) => r.year >= VIIRS_START_YEAR).map((r) => [d(r.year, r.month), r.raw_viirs ?? null]),
        },
      );
    } else {
      legend.push(t("harmonized"), t("band"));
      series.push(
        {
          name: "p5",
          type: "line",
          stack: "band",
          symbol: "none",
          lineStyle: { opacity: 0 },
          tooltip: { show: false },
          data: sorted.map((r) => [d(r.year, r.month), r.harmonized_p5 ?? null]),
        },
        {
          name: t("band"),
          type: "line",
          stack: "band",
          symbol: "none",
          lineStyle: { opacity: 0 },
          itemStyle: { color: SERIES.harmonized },
          areaStyle: { color: SERIES.harmonized, opacity: 0.18 },
          data: sorted.map((r) => [
            d(r.year, r.month),
            r.harmonized_p95 != null && r.harmonized_p5 != null ? r.harmonized_p95 - r.harmonized_p5 : null,
          ]),
        },
        {
          name: t("harmonized"),
          type: "line",
          showSymbol: false,
          lineStyle: { width: 1.5, color: SERIES.harmonized },
          itemStyle: { color: SERIES.harmonized },
          connectNulls: false,
          data: sorted.map((r) => [d(r.year, r.month), r.harmonized ?? null]),
        },
      );
    }
    // 2012 marker on the last series
    const last = series[series.length - 1] as Record<string, unknown>;
    last.markLine = {
      silent: true,
      symbol: "none",
      lineStyle: { color: UI.text1, type: [3, 3], width: 1, opacity: 0.6 },
      label: { formatter: "2012", color: UI.text2, fontSize: 10 },
      data: [{ xAxis: d(VIIRS_START_YEAR, 1) }],
    };
    return {
      animation: false,
      textStyle: { fontFamily: "var(--font-sans), system-ui, sans-serif" },
      grid: { left: 52, right: 14, top: 26, bottom: 24 },
      legend: { data: legend, top: 0, right: 0, textStyle: { color: UI.text2, fontSize: 11 }, itemHeight: 2, itemWidth: 14, icon: "rect" },
      tooltip: {
        trigger: "axis",
        backgroundColor: UI.tooltip,
        borderColor: UI.line,
        extraCssText: "border-radius:6px;font-variant-numeric:tabular-nums;",
        textStyle: { color: UI.text1, fontSize: 12 },
        axisPointer: { lineStyle: { color: UI.line } },
        valueFormatter: (v: number | null) => (v == null ? t("noSensor") : fmt(v, 1)),
      },
      xAxis: {
        type: "time",
        axisLabel: { color: UI.text3, fontSize: 10 },
        axisLine: { lineStyle: { color: UI.line } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: UI.text3, fontSize: 10, formatter: (v: number) => (v >= 1000 ? `${v / 1000}k` : String(v)) },
        splitLine: { lineStyle: { color: UI.grid } },
      },
      series,
    };
  }, [rows, mode, t]);

  return (
    <EChart
      option={option}
      style={{ width: "100%", height: 190 }}
      ariaLabel={`${t("timeSeries")} (${mode === "raw" ? t("raw") : t("harmonized")})`}
    />
  );
}
