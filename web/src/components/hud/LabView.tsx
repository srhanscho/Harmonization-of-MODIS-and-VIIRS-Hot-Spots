"use client";

import { useMemo } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import type { DictKey } from "@/lib/i18n";
import { FlaskConical } from "lucide-react";
import { DataState } from "./DataState";
import { EChart, type EChartsOption } from "@/components/calendar/EChart";
import { useRegionAnalytics } from "@/lib/analytics";
import { ALERT_THRESHOLDS } from "@/lib/contract";
import { loadForecast } from "@/lib/data";
import { useI18n, type Lang } from "@/lib/i18n";
import { ALERT, MODEL, SERIES, UI } from "@/lib/palette";
import { fmt } from "@/lib/series";
import { useLoad, useRegion, useStore } from "@/lib/store";
import type { AlertLevel, Forecast, MonthlyRow, YearMonth } from "@/lib/types";

const COPY = {
  en: {
    title: "Predictive lab",
    experimental: "Experimental — statistical outlook, not an operational warning",
    pick: "Choose a region on the left to open its backtest and 3-month outlook.",
    model: "Model",
    backtest: "Backtest: does the old record predict the new one?",
    backtestBody:
      "A seasonal model is fitted only on the harmonized 2001–2015 series, then asked to predict 2016 onward, a period dominated by VIIRS. If the harmonization works, the observed series should mostly stay inside the model's band.",
    observed: "Observed (harmonized)",
    predicted: "Predicted",
    band: "{p}% interval",
    train: "Train",
    test: "Test",
    mape: "Mean abs. % error (test)",
    coverage: "Inside the {p}% interval",
    nominal: "nominal {p}%",
    testMonths: "Test months",
    trainPeriod: "Training period",
    outlook: "Next 3 months",
    outlookBody:
      "The same model refitted on all years. Probabilities are for the month's fire anomaly (HFAI z) exceeding 1 (moderate) and 2 (critical).",
    month: "Month",
    expected: "Expected",
    range: "{p}% range",
    pz1: "P(z > 1)",
    pz2: "P(z > 2)",
    alert: "Alert",
    yellow: "Yellow",
    red: "Red",
    none: "None",
    thresholds: `Yellow when P(z > 1) > ${ALERT_THRESHOLDS.yellow * 100}%, Red when P(z > 2) > ${ALERT_THRESHOLDS.red * 100}% (thresholds from the team report).`,
    noOutlook: "No outlook published for this region.",
    unit: "fire cell-days, VIIRS S-NPP equivalent (estimated)",
    worst: "Strongest outlook signal",
  },
  es: {
    title: "Laboratorio predictivo",
    experimental: "Experimental — perspectiva estadística, no es una alerta operativa",
    pick: "Elige una región a la izquierda para ver su backtest y la perspectiva a 3 meses.",
    model: "Modelo",
    backtest: "Backtest: ¿el registro antiguo predice el nuevo?",
    backtestBody:
      "Un modelo estacional se ajusta solo con la serie armonizada 2001–2015 y luego predice desde 2016, un período dominado por VIIRS. Si la armonización funciona, la serie observada debería quedar casi siempre dentro de la banda del modelo.",
    observed: "Observado (armonizado)",
    predicted: "Predicho",
    band: "Intervalo {p}%",
    train: "Entrenamiento",
    test: "Prueba",
    mape: "Error % absoluto medio (prueba)",
    coverage: "Dentro del intervalo {p}%",
    nominal: "nominal {p}%",
    testMonths: "Meses de prueba",
    trainPeriod: "Período de entrenamiento",
    outlook: "Próximos 3 meses",
    outlookBody:
      "El mismo modelo reajustado con todos los años. Las probabilidades son de que la anomalía de fuego del mes (HFAI z) supere 1 (moderada) y 2 (crítica).",
    month: "Mes",
    expected: "Esperado",
    range: "Rango {p}%",
    pz1: "P(z > 1)",
    pz2: "P(z > 2)",
    alert: "Alerta",
    yellow: "Amarilla",
    red: "Roja",
    none: "Ninguna",
    thresholds: `Amarilla si P(z > 1) > ${ALERT_THRESHOLDS.yellow * 100}%, Roja si P(z > 2) > ${ALERT_THRESHOLDS.red * 100}% (umbrales del informe del equipo).`,
    noOutlook: "No hay perspectiva publicada para esta región.",
    unit: "celdas-día con fuego, equivalente VIIRS S-NPP (estimado)",
    worst: "Señal más fuerte de la perspectiva",
  },
} satisfies Record<Lang, Record<string, string>>;

type Copy = (typeof COPY)["en"];
const fill = (s: string, p: number) => s.replaceAll("{p}", fmt(p * 100, 0));
const d = (t: YearMonth) => `${t.year}-${String(t.month).padStart(2, "0")}-01`;
const pct = (v: number | null) => (v == null ? "—" : `${fmt(v * 100, 0)}%`);

const tooltipBase = {
  trigger: "axis",
  backgroundColor: UI.tooltip,
  borderColor: UI.line,
  extraCssText: "border-radius:6px;font-variant-numeric:tabular-nums;",
  textStyle: { color: UI.text1, fontSize: 12 },
  axisPointer: { lineStyle: { color: UI.line } },
};
const axes = {
  xAxis: { type: "time", axisLabel: { color: UI.text3, fontSize: 10 }, axisLine: { lineStyle: { color: UI.line } }, axisTick: { show: false } },
  yAxis: {
    type: "value",
    axisLabel: { color: UI.text3, fontSize: 10, formatter: (v: number) => (v >= 1000 ? `${v / 1000}k` : String(v)) },
    splitLine: { lineStyle: { color: UI.grid } },
  },
};

export function AlertBadge({ level, c }: { level: AlertLevel | null; c: Pick<Copy, "yellow" | "red" | "none"> }) {
  if (!level) return <span className="text-[var(--text-3)]">{c.none}</span>;
  const color = ALERT[level];
  return (
    <span
      className="inline-flex h-5 items-center gap-1.5 rounded-[5px] border px-1.5 text-[11px] font-semibold"
      style={{ borderColor: `${color}80`, color, background: `${color}14` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} aria-hidden />
      {level === "red" ? c.red : c.yellow}
    </span>
  );
}

function bandSeries(name: string, pts: { t: YearMonth; lo: number | null; hi: number | null }[]) {
  return [
    {
      name: "lo",
      type: "line",
      stack: name,
      symbol: "none",
      lineStyle: { opacity: 0 },
      tooltip: { show: false },
      data: pts.map((p) => [d(p.t), p.lo]),
    },
    {
      name,
      type: "line",
      stack: name,
      symbol: "none",
      lineStyle: { opacity: 0 },
      itemStyle: { color: MODEL.band },
      areaStyle: { color: MODEL.band, opacity: 1 },
      tooltip: { show: false },
      data: pts.map((p) => [d(p.t), p.lo != null && p.hi != null ? p.hi - p.lo : null]),
    },
  ];
}

function BacktestChart({ f, rows, c }: { f: Forecast; rows: MonthlyRow[] | null; c: Copy }) {
  const option = useMemo<EChartsOption>(() => {
    const iv = f.metrics.interval;
    const testStart: YearMonth = f.metrics.train_end
      ? f.metrics.train_end.month === 12
        ? { year: f.metrics.train_end.year + 1, month: 1 }
        : { year: f.metrics.train_end.year, month: f.metrics.train_end.month + 1 }
      : (f.backtest[0] ?? { year: 2016, month: 1 });
    const observed = rows
      ? [...rows].sort((a, b) => a.year - b.year || a.month - b.month).map((r) => [d(r), r.harmonized ?? null])
      : f.backtest.map((b) => [d(b), b.observed]);
    const firstObs = rows?.length ? d(rows.reduce((a, b) => (a.year * 12 + a.month <= b.year * 12 + b.month ? a : b))) : d(f.backtest[0]);
    return {
      animation: false,
      textStyle: { fontFamily: "var(--font-sans), system-ui, sans-serif" },
      grid: { left: 48, right: 14, top: 30, bottom: 24 },
      legend: {
        data: [c.observed, c.predicted, fill(c.band, iv)],
        top: 0,
        right: 0,
        textStyle: { color: UI.text2, fontSize: 11 },
        itemHeight: 2,
        itemWidth: 14,
        icon: "rect",
      },
      tooltip: { ...tooltipBase, valueFormatter: (v: number | null) => fmt(v, 0) },
      ...axes,
      series: [
        ...bandSeries(fill(c.band, iv), f.backtest.map((b) => ({ t: b, lo: b.lo, hi: b.hi }))),
        {
          name: c.predicted,
          type: "line",
          showSymbol: false,
          lineStyle: { width: 1.2, color: MODEL.line, type: [4, 3] },
          itemStyle: { color: MODEL.line },
          data: f.backtest.map((b) => [d(b), b.predicted]),
        },
        {
          name: c.observed,
          type: "line",
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 1.5, color: SERIES.harmonized },
          itemStyle: { color: SERIES.harmonized },
          data: observed,
          markArea: {
            silent: true,
            itemStyle: { color: MODEL.train },
            label: { color: UI.text3, fontSize: 10, position: "insideTopLeft" },
            data: [[{ xAxis: firstObs, name: c.train }, { xAxis: d(testStart) }]],
          },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: UI.text1, type: [3, 3], width: 1, opacity: 0.6 },
            label: { formatter: `${c.test} · ${testStart.year}`, color: UI.text2, fontSize: 10, position: "insideEndTop" },
            data: [{ xAxis: d(testStart) }],
          },
        },
      ],
    };
  }, [f, rows, c]);
  return <EChart option={option} style={{ width: "100%", height: 250 }} ariaLabel={c.backtest} />;
}

function OutlookChart({ f, rows, c }: { f: Forecast; rows: MonthlyRow[] | null; c: Copy }) {
  const option = useMemo<EChartsOption>(() => {
    const iv = f.metrics.interval;
    const recent = (rows ? [...rows] : [])
      .filter((r) => r.harmonized != null)
      .sort((a, b) => a.year - b.year || a.month - b.month)
      .slice(-24);
    return {
      animation: false,
      textStyle: { fontFamily: "var(--font-sans), system-ui, sans-serif" },
      grid: { left: 48, right: 14, top: 30, bottom: 24 },
      legend: {
        data: [c.observed, c.expected, fill(c.range, iv)],
        top: 0,
        right: 0,
        textStyle: { color: UI.text2, fontSize: 11 },
        itemHeight: 2,
        itemWidth: 14,
        icon: "rect",
      },
      tooltip: { ...tooltipBase, valueFormatter: (v: number | null) => fmt(v, 0) },
      ...axes,
      series: [
        ...bandSeries(fill(c.range, iv), f.outlook.map((o) => ({ t: o, lo: o.lo, hi: o.hi }))),
        {
          name: c.observed,
          type: "line",
          showSymbol: false,
          lineStyle: { width: 1.5, color: SERIES.harmonized },
          itemStyle: { color: SERIES.harmonized },
          data: recent.map((r) => [d(r), r.harmonized]),
        },
        {
          name: c.expected,
          type: "line",
          symbol: "circle",
          symbolSize: 5,
          lineStyle: { width: 1.2, color: MODEL.line, type: [4, 3] },
          itemStyle: { color: MODEL.line },
          data: f.outlook.map((o) => [d(o), o.predicted]),
        },
      ],
    };
  }, [f, rows, c]);
  return <EChart option={option} style={{ width: "100%", height: 210 }} ariaLabel={c.outlook} />;
}

function Metric({ label, value, sub, info }: { label: string; value: string; sub?: string; info?: DictKey }) {
  return (
    <div className="rounded-xl border border-cyan-500/25 bg-[rgba(8,23,48,0.65)] px-3.5 py-3 shadow-sm">
      <p className="t-label flex items-center gap-1 text-slate-300">
        {label}
        {info && <InfoTip k={info} label={label} />}
      </p>
      <p className="t-figure num mt-1 !text-[24px] font-bold text-white">{value}</p>
      {sub && <p className="t-caption num mt-0.5 text-cyan-300/80">{sub}</p>}
    </div>
  );
}

export function LabView() {
  const { lang, monthShort } = useI18n();
  const c = COPY[lang];
  const { state } = useStore();
  const region = useRegion();
  const a = useRegionAnalytics();
  const res = useLoad(state.regionId ? `forecast:${state.regionId}` : null, () => loadForecast(state.regionId!));
  const f = res?.status === "ok" ? res.data : null;
  const worst: AlertLevel | null = f?.outlook.some((o) => o.alert === "red")
    ? "red"
    : f?.outlook.some((o) => o.alert === "yellow")
      ? "yellow"
      : null;
  const iv = f?.metrics.interval ?? 0.8;
  const trainEnd = f?.metrics.train_end;

  return (
    <article className="glass-panel pointer-events-auto mx-auto max-h-full w-full max-w-5xl overflow-y-auto rounded-2xl px-6 py-6 text-[14px] leading-relaxed text-slate-200 sm:px-8 sm:py-7">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-[26px] leading-tight font-bold tracking-tight text-white">
            {c.title}
            {region && <span className="ml-2 text-[17px] font-normal tracking-normal text-cyan-300">{region.name}</span>}
          </h2>
          {f?.model && (
            <p className="t-caption mt-1 text-slate-400">
              {c.model}: <span className="font-mono text-cyan-200">{f.model}</span>
            </p>
          )}
        </div>
        {f && f.outlook.length > 0 && (
          <div className="flex items-center gap-2 text-[12px]">
            <span className="t-caption text-slate-400">{c.worst}</span>
            <AlertBadge level={worst} c={c} />
          </div>
        )}
      </div>
      <p className="mt-3.5 inline-flex items-center gap-2 rounded-full border border-amber-400/35 bg-amber-500/10 px-3 py-1 text-[12px] font-semibold text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.15)]">
        <FlaskConical className="size-3.5 text-amber-400" aria-hidden />
        {c.experimental}
      </p>

      {!state.regionId ? (
        <p className="mt-6 text-slate-300">{c.pick}</p>
      ) : !f ? (
        <div className="mt-4">
          <DataState result={res} file={`/data/forecast/${state.regionId}.json`} />
        </div>
      ) : (
        <>
          <section className="mt-7">
            <h3 className="text-[17px] font-bold tracking-tight text-white">{c.backtest}</h3>
            <p className="mt-1 max-w-[72ch] text-[13.5px] text-slate-300">{c.backtestBody}</p>
            <div className="mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-4">
              <Metric label={c.mape} value={pct(f.metrics.mape)} info="infoMape" />
              <Metric label={fill(c.coverage, iv)} value={pct(f.metrics.coverage)} sub={fill(c.nominal, iv)} info="infoCoverage" />
              <Metric label={c.testMonths} value={fmt(f.metrics.n_test ?? f.backtest.length, 0)} />
              <Metric label={c.trainPeriod} value={trainEnd ? `2001–${trainEnd.year}` : "—"} />
            </div>
            {f.backtest.length > 0 && (
              <div className="mt-3">
                <BacktestChart f={f} rows={a.rows} c={c} />
                <p className="t-caption text-slate-400">{c.unit}</p>
              </div>
            )}
          </section>

          <section className="mt-8">
            <h3 className="flex items-center gap-1.5 text-[17px] font-bold tracking-tight text-white">
              {c.outlook} <InfoTip k="infoOutlook" label={c.outlook} />
            </h3>
            <p className="mt-1 max-w-[72ch] text-[13.5px] text-slate-300">{c.outlookBody}</p>
            {f.outlook.length === 0 ? (
              <p className="mt-3 text-[13px] text-slate-400">{c.noOutlook}</p>
            ) : (
              <div className="mt-3 grid gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                <OutlookChart f={f} rows={a.rows} c={c} />
                <div className="min-w-0 overflow-x-auto">
                  <table className="num w-full text-xs">
                    <thead className="text-slate-400">
                      <tr>
                        <th className="py-1 text-left font-normal">{c.month}</th>
                        <th className="text-right font-normal">{c.expected}</th>
                        <th className="text-right font-normal">{fill(c.range, iv)}</th>
                        <th className="text-right font-normal">{c.pz1}</th>
                        <th className="text-right font-normal">{c.pz2}</th>
                        <th className="pl-3 text-left font-normal">{c.alert}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.outlook.map((o) => (
                        <tr key={`${o.year}-${o.month}`} className="border-t border-cyan-500/20">
                          <td className="py-1.5 whitespace-nowrap font-medium text-white">
                            {monthShort(o.month)} {o.year}
                          </td>
                          <td className="text-right font-semibold text-cyan-200">{fmt(o.predicted, 0)}</td>
                          <td className="text-right whitespace-nowrap text-slate-400">
                            {fmt(o.lo, 0)}–{fmt(o.hi, 0)}
                          </td>
                          <td className="text-right text-slate-300">{pct(o.p_above_z1)}</td>
                          <td className="text-right text-slate-300">{pct(o.p_above_z2)}</td>
                          <td className="pl-3">
                            <AlertBadge level={o.alert} c={c} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="t-caption mt-2 text-slate-400">{c.thresholds}</p>
                  <p className="t-caption mt-1 font-medium text-slate-300">{c.experimental}</p>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </article>
  );
}
