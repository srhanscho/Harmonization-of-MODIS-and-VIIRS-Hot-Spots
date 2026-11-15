"use client";

import { useEffect, useMemo, useState } from "react";
import { EChart, type EChartClick, type EChartsOption } from "./EChart";
import { useI18n, type DictKey } from "@/lib/i18n";
import { classifyZ, Z_THRESHOLDS } from "@/lib/contract";
import { ANOMALY, ACCENT, ENSO, FIRE, HATCH, NO_DATA, UI } from "@/lib/palette";
import {
  VIIRS_START_YEAR,
  fmt,
  fmtSigned,
  indexRows,
  key,
  metricValue,
  recordYear,
  regimeFor,
  yearTotals,
} from "@/lib/series";
import type { CalendarMetric, DisplayMode, EnsoPhase, MonthlyRow, OniRow, ZClass } from "@/lib/types";

interface Props {
  rows: MonthlyRow[];
  years: number[];
  mode: DisplayMode;
  metric: CalendarMetric;
  peakMonth: number | null;
  selected: { year: number; month: number } | null;
  /** ONI by `${year}-${month}`; null hides the ENSO strip. */
  oni: Map<string, OniRow> | null;
  onSelect: (year: number, month: number, at?: { x: number; y: number }) => void;
}

// Sensor regimes: three steps of the warm neutral ramp (they describe the instrument, not fire).
const REGIME_COLORS: Record<string, string> = { R1: "#e3e8ee", R2: "#c3cdd9", R3: "#93a3b7" };
const GAP = UI.cellGap;
const PHASES: EnsoPhase[] = ["neutral", "el_nino", "la_nina"];

export const Z_CLASS_LABEL: Record<ZClass, DictKey> = {
  below: "zBelow",
  normal: "zNormal",
  moderate: "zModerate",
  critical: "zCritical",
};
export const PHASE_LABEL: Record<EnsoPhase, DictKey> = { el_nino: "elNino", la_nina: "laNina", neutral: "neutral" };

interface CustomApi {
  value: (i: number) => number;
  coord: (v: number[]) => number[];
  size: (v: number[]) => number[];
}

export function BurnCalendar({ rows, years, mode, metric, peakMonth, selected, oni, onSelect }: Props) {
  const { t, monthShort } = useI18n();
  // Phones: one-letter month heads and no per-month total labels, so nothing collides.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const option = useMemo<EChartsOption>(() => {
    const idx = indexRows(rows);
    const isZ = metric === "anomaly";
    const value = (y: number, m: number) => metricValue(idx.get(key(y, m)), metric, mode);
    const main: unknown[] = [];
    const empty: [number, number, number][] = [];
    const values: number[] = [];
    years.forEach((y, yi) => {
      for (let m = 1; m <= 12; m++) {
        const v = value(y, m);
        if (v == null) {
          empty.push([m - 1, yi, 0]);
          continue;
        }
        values.push(v);
        const isSel = selected && selected.year === y && selected.month === m;
        main.push(
          isSel
            ? { value: [m - 1, yi, v], itemStyle: { borderColor: UI.text1, borderWidth: 2 } }
            : [m - 1, yi, v],
        );
      }
    });
    const vmax = values.length ? Math.max(...values) : 1;

    // Margins: sums for activity / FRP, means for z (a sum of z-scores has no meaning).
    const aggregate = (vals: number[]) =>
      vals.length === 0 ? null : isZ ? vals.reduce((s, v) => s + v, 0) / vals.length : vals.reduce((s, v) => s + v, 0);
    const yt = years.map((y) => {
      const vals: number[] = [];
      for (let m = 1; m <= 12; m++) {
        const v = value(y, m);
        if (v != null) vals.push(v);
      }
      return { year: y, total: aggregate(vals) };
    });
    const mt = Array.from({ length: 12 }, (_, mi) =>
      aggregate(years.map((y) => value(y, mi + 1)).filter((v): v is number => v != null)),
    );
    // Record year always comes from the harmonized activity series (a raw "record" would be a sensor artifact).
    const rec = recordYear(yearTotals(rows, years, "harmonized"));
    const marginLabel = (v: number) => (isZ ? fmtSigned(v, 1) : compact(v));
    const rowTotals = yt.map((tt, yi) =>
      tt.total == null
        ? { value: [0, yi, 0], itemStyle: { color: NO_DATA }, label: { formatter: "—" } }
        : {
            value: [0, yi, tt.total],
            itemStyle: rec && rec.year === tt.year ? { borderColor: ACCENT, borderWidth: 1.5 } : undefined,
          },
    );
    const colTotals = mt.map((v, mi) =>
      v == null
        ? { value: [mi, 0, 0], itemStyle: { color: NO_DATA }, label: { formatter: "—" } }
        : {
            value: [mi, 0, v],
            itemStyle: peakMonth === mi + 1 ? { borderColor: ACCENT, borderWidth: 1.5 } : undefined,
          },
    );
    const range = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x != null);
      const lo = Math.min(0, ...v);
      return [lo, Math.max(lo + 1e-6, ...v, isZ ? 0 : 1)];
    };
    const [rowMin, rowMax] = range(yt.map((x) => x.total));
    const [colMin, colMax] = range(mt);

    const regimeData = years.map((y, yi) => {
      const a = regimeFor(y, 1);
      const b = regimeFor(y, 12);
      const label = a && b && a !== b ? `${a}→${b.slice(1)}` : (b ?? "");
      return { value: [0, yi, Number((b ?? "R1").slice(1))], label: { formatter: label } };
    });

    const ensoData: [number, number, number][] = [];
    if (oni) {
      years.forEach((y, yi) => {
        for (let m = 1; m <= 12; m++) {
          const o = oni.get(key(y, m));
          if (o) ensoData.push([m - 1, yi, PHASES.indexOf(o.phase)]);
        }
      });
    }

    const monthLabels = Array.from({ length: 12 }, (_, i) => monthShort(i + 1));
    const yearLabels = years.map(String);
    const split = years.indexOf(VIIRS_START_YEAR);

    const top = 26;
    const bottom = 40;
    const left = 74;
    // The ENSO strip, when on, is its own narrow column between the grid and the totals.
    const ensoW = oni ? 36 : 0;
    const right = 82 + (oni ? ensoW + 10 : 0);
    const textColor = UI.text2;
    const unitLabel = metric === "frp" ? "MW" : t("unit");

    const cellText = (v: number) => {
      if (isZ) {
        const c = classifyZ(v);
        return `<b>z ${fmtSigned(v, 2)}</b>${c ? ` · ${t(Z_CLASS_LABEL[c])}` : ""}`;
      }
      return `<b>${fmt(v, metric === "frp" ? 0 : 1)}</b> ${unitLabel}`;
    };
    const ensoText = (mi: number, yi: number) => {
      const o = oni?.get(key(years[yi], mi + 1));
      return o ? `<br/><span style="color:${UI.text3}">${t("oni")} ${fmtSigned(o.oni, 1)} · ${t(PHASE_LABEL[o.phase])}</span>` : "";
    };

    return {
      animation: false,
      aria: { enabled: true, label: { enabled: false } },
      textStyle: { fontFamily: "var(--font-sans), system-ui, sans-serif" },
      tooltip: {
        trigger: "item",
        backgroundColor: UI.tooltip,
        borderColor: UI.line,
        borderWidth: 1,
        padding: [6, 10],
        extraCssText: "border-radius:6px;box-shadow:0 8px 24px -12px rgba(11,31,58,.25);font-variant-numeric:tabular-nums;",
        textStyle: { color: UI.text1, fontSize: 12 },
        formatter: (p: { seriesId?: string; value?: [number, number, number] }) => {
          const v = p.value;
          if (!v) return "";
          const head = `${monthLabels[v[0]]} ${yearLabels[v[1]]}`;
          if (p.seriesId === "main") return `${head}<br/>${cellText(v[2])}${ensoText(v[0], v[1])}`;
          if (p.seriesId === "empty") return `${head}<br/>${t("noSensor")}${ensoText(v[0], v[1])}`;
          const agg = isZ ? t("mean") : t("total");
          if (p.seriesId === "rowTotals") return `${agg} ${yearLabels[v[1]]}: <b>${isZ ? fmtSigned(v[2], 2) : fmt(v[2], 0)}</b>`;
          if (p.seriesId === "colTotals") return `${agg} ${monthLabels[v[0]]}: <b>${isZ ? fmtSigned(v[2], 2) : fmt(v[2], 0)}</b>`;
          return "";
        },
      },
      grid: [
        { id: "band", left: 44, width: 26, top, bottom },
        { id: "main", left, right, top, bottom },
        { id: "rows", right: 8, width: 68, top, bottom },
        { id: "cols", left, right, bottom: 6, height: bottom - 12 },
        { id: "enso", right: 84, width: Math.max(1, ensoW), top, bottom },
      ],
      xAxis: [
        { gridIndex: 0, type: "category", data: [""], show: false },
        {
          gridIndex: 1,
          type: "category",
          data: monthLabels,
          position: "top",
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: textColor,
            fontSize: 11,
            interval: 0,
            formatter: (val: string, i: number) => {
              const v = narrow ? val.slice(0, 1) : val;
              return peakMonth === i + 1 ? `{peak|${v}}` : v;
            },
            rich: { peak: { color: ACCENT, fontWeight: 600 } },
          },
        },
        {
          gridIndex: 2,
          type: "category",
          data: [isZ ? t("mean") : t("total")],
          position: "top",
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: textColor, fontSize: 11 },
        },
        { gridIndex: 3, type: "category", data: monthLabels, show: false },
        {
          gridIndex: 4,
          type: "category",
          data: monthLabels,
          position: "top",
          show: !!oni,
          name: "ENSO",
          nameLocation: "middle",
          nameGap: 8,
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
        },
      ],
      yAxis: [
        {
          gridIndex: 0,
          type: "category",
          data: yearLabels,
          inverse: true,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: textColor,
            fontSize: 11,
            margin: 6,
            interval: 0,
            formatter: (val: string) => (rec && String(rec.year) === val ? `{rec|${val}}` : val),
            rich: { rec: { color: ACCENT, fontWeight: 600 } },
          },
        },
        { gridIndex: 1, type: "category", data: yearLabels, inverse: true, show: false },
        { gridIndex: 2, type: "category", data: yearLabels, inverse: true, show: false },
        { gridIndex: 3, type: "category", data: [t("total")], show: false },
        { gridIndex: 4, type: "category", data: yearLabels, inverse: true, show: false },
      ],
      // ECharts 6 requires a visualMap for every heatmap series.
      visualMap: [
        {
          seriesIndex: 0,
          show: false,
          type: "piecewise",
          pieces: [
            { value: 1, color: REGIME_COLORS.R1 },
            { value: 2, color: REGIME_COLORS.R2 },
            { value: 3, color: REGIME_COLORS.R3 },
          ],
        },
        { seriesIndex: 1, show: false, min: 0, max: 1, inRange: { color: [NO_DATA, NO_DATA] } },
        isZ
          ? {
              seriesIndex: 2,
              show: false,
              type: "piecewise",
              pieces: [
                { lt: Z_THRESHOLDS.below, color: ANOMALY.below },
                { gte: Z_THRESHOLDS.below, lte: Z_THRESHOLDS.moderate, color: ANOMALY.normal },
                { gt: Z_THRESHOLDS.moderate, lte: Z_THRESHOLDS.critical, color: ANOMALY.moderate },
                { gt: Z_THRESHOLDS.critical, color: ANOMALY.critical },
              ],
            }
          : { seriesIndex: 2, show: false, min: 0, max: vmax, inRange: { color: FIRE } },
        { seriesIndex: 3, show: false, min: rowMin, max: rowMax, inRange: { color: ["#eef2f6", "#b3c0cf"] } },
        { seriesIndex: 4, show: false, min: colMin, max: colMax, inRange: { color: ["#eef2f6", "#b3c0cf"] } },
      ],
      series: [
        {
          id: "band",
          type: "heatmap",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: regimeData,
          label: { show: true, color: UI.text2, fontSize: 9 },
          itemStyle: { borderColor: GAP, borderWidth: 1 },
          silent: true,
        },
        {
          id: "empty",
          type: "heatmap",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: empty,
          itemStyle: {
            color: NO_DATA,
            borderColor: GAP,
            borderWidth: 1,
            decal: {
              symbol: "rect",
              symbolSize: 1,
              dashArrayX: [1, 0],
              dashArrayY: [1, 4],
              rotation: -Math.PI / 4,
              color: HATCH,
            },
          },
          emphasis: { disabled: true },
        },
        {
          id: "main",
          type: "heatmap",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: main,
          itemStyle: { borderColor: GAP, borderWidth: 1 },
          emphasis: { itemStyle: { borderColor: UI.text1, borderWidth: 1.5 } },
          markLine:
            split > 0
              ? {
                  silent: true,
                  symbol: "none",
                  lineStyle: { color: UI.text1, type: [3, 3], width: 1, opacity: 0.7 },
                  label: { formatter: t("viirsJoins"), position: "insideEndTop", color: UI.text1, fontSize: 10, fontWeight: 500 },
                  data: [{ yAxis: split - 0.5 }],
                }
              : undefined,
        },
        {
          id: "rowTotals",
          type: "heatmap",
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: rowTotals,
          label: {
            show: true,
            color: UI.text1,
            fontSize: 10,
            formatter: (p: { value: [number, number, number] }) => (isZ ? fmtSigned(p.value[2], 1) : fmt(p.value[2], 0)),
          },
          itemStyle: { borderColor: GAP, borderWidth: 1 },
        },
        {
          id: "colTotals",
          type: "heatmap",
          xAxisIndex: 3,
          yAxisIndex: 3,
          data: colTotals,
          label: {
            show: !narrow,
            color: UI.text1,
            fontSize: 9,
            formatter: (p: { value: [number, number, number] }) => marginLabel(p.value[2]),
          },
          itemStyle: { borderColor: GAP, borderWidth: 1 },
        },
        // ENSO strip: a separate narrow month × year column, so the heatmap itself stays clean.
        {
          id: "enso",
          type: "custom",
          xAxisIndex: 4,
          yAxisIndex: 4,
          silent: true,
          z: 3,
          data: ensoData,
          renderItem: (_: unknown, api: CustomApi) => {
            const c = api.coord([api.value(0), api.value(1)]);
            const s = api.size([1, 1]);
            return {
              type: "rect",
              shape: { x: c[0] - s[0] / 2, y: c[1] - s[1] / 2 + 0.5, width: s[0], height: Math.max(1, s[1] - 1) },
              style: { fill: ENSO[PHASES[api.value(2)] ?? "neutral"] },
            };
          },
        },
      ],
    };
  }, [rows, years, mode, metric, peakMonth, selected, oni, t, monthShort, narrow]);

  const handleClick = (p: EChartClick) => {
    if (p.seriesId !== "main" && p.seriesId !== "empty") return;
    const raw = p.data as { value?: number[] } | number[] | undefined;
    const v = Array.isArray(raw) ? raw : raw?.value;
    if (!v) return;
    onSelect(years[v[1]], v[0] + 1, p.event ? { x: p.event.offsetX, y: p.event.offsetY } : undefined);
  };

  const metricName = metric === "anomaly" ? t("metricAnomaly") : metric === "frp" ? t("metricFrp") : t("metricActivity");
  const height = years.length * 15 + 66;
  return (
    <EChart
      option={option}
      onClick={handleClick}
      style={{ width: "100%", height }}
      ariaLabel={`${t("calendarTitle")}: ${metricName}${metric === "anomaly" ? "" : `, ${mode === "raw" ? t("raw") : t("harmonized")}`}`}
    />
  );
}

function compact(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${Math.round(v / 1e3)}k`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return fmt(v, 0);
}
