"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import { ArrowLeft, Download, X } from "lucide-react";
import { BurnCalendar, PHASE_LABEL, Z_CLASS_LABEL } from "./BurnCalendar";
import { TimeSeries } from "./TimeSeries";
import { EventMode } from "./EventMode";
import { RankingPanel } from "./RankingPanel";
import { DataState } from "@/components/hud/DataState";
import { Switch } from "@/components/hud/Counters";
import { useRegionAnalytics } from "@/lib/analytics";
import { downloadText, monthlyToCsv } from "@/lib/csv";
import { loadOni } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { ANOMALY, ENSO, FIRE_GRADIENT } from "@/lib/palette";
import { displayValue, fmt, fmtSigned, hasMetric, key } from "@/lib/series";
import { useLoad, useRegion, useStore } from "@/lib/store";
import type { CalendarMetric, DisplayMode, EnsoPhase, OniRow, ZClass } from "@/lib/types";

export function ModeToggle({
  mode,
  onChange,
  disabled,
  disabledHint,
}: {
  mode: DisplayMode;
  onChange: (m: DisplayMode) => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      role="radiogroup"
      aria-label={`${t("raw")} / ${t("harmonized")}`}
      aria-disabled={disabled || undefined}
      title={disabled ? disabledHint : undefined}
      className={`seg seg-hero transition-opacity duration-150 ${disabled ? "opacity-40" : ""}`}
    >
      {(["raw", "harmonized"] as const).map((m) => (
        <button key={m} role="radio" aria-checked={mode === m} disabled={disabled} className="disabled:cursor-not-allowed" onClick={() => onChange(m)}>
          {m === "raw" ? t("raw") : t("harmonized")}
        </button>
      ))}
    </div>
  );
}

const METRICS: { k: CalendarMetric; label: "metricActivity" | "metricAnomaly" | "metricFrp" }[] = [
  { k: "activity", label: "metricActivity" },
  { k: "anomaly", label: "metricAnomaly" },
  { k: "frp", label: "metricFrp" },
];

function MetricSelect({
  metric,
  available,
  onChange,
}: {
  metric: CalendarMetric;
  available: (m: CalendarMetric) => boolean;
  onChange: (m: CalendarMetric) => void;
}) {
  const { t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t("metricLabel")} className="seg">
      {METRICS.map(({ k, label }) => {
        const ok = available(k);
        return (
          <button
            key={k}
            role="radio"
            aria-checked={metric === k}
            disabled={!ok}
            title={ok ? undefined : t("metricUnavailable")}
            className="disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => onChange(k)}
          >
            {t(label)}
          </button>
        );
      })}
    </div>
  );
}

export function CalendarPanel() {
  const { state, dispatch } = useStore();
  const region = useRegion();
  const a = useRegionAnalytics();
  const { t, monthLong } = useI18n();
  const [popover, setPopover] = useState<{ left: number; top: number; flipX: boolean } | null>(null);
  const [tab, setTab] = useState<"series" | "event" | "ranking">("series");
  const [ensoOn, setEnsoOn] = useState(false);
  const calRef = useRef<HTMLDivElement>(null);
  const oniRes = useLoad("oni", loadOni);
  const oni = useMemo(() => {
    if (oniRes?.status !== "ok") return null;
    const m = new Map<string, OniRow>();
    for (const o of oniRes.data) m.set(key(o.year, o.month), o);
    return m;
  }, [oniRes]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPopover(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!state.regionId) return null;
  const regionFile = `/data/monthly/${state.regionId}.json`;

  const sel = a.selected;
  const row = a.selectedRow;
  const an = a.anomaly;
  // A metric the published rows do not carry falls back to Activity instead of an empty calendar.
  const metric: CalendarMetric = hasMetric(a.rows, state.metric) ? state.metric : "activity";
  const isZ = metric === "anomaly";
  const selOni = sel ? oni?.get(key(sel.year, sel.month)) : undefined;

  const explain =
    metric === "anomaly"
      ? t("anomalyExplain")
      : metric === "frp"
        ? state.mode === "raw"
          ? t("frpExplainRaw")
          : t("frpExplainHarm")
        : state.mode === "raw"
          ? t("rawExplain")
          : t("harmonizedExplain");
  const unit =
    metric === "anomaly" ? t("unitZ") : metric === "frp" ? t("unitFrp") : state.mode === "raw" ? t("unitRaw") : t("unitHarm");

  return (
    <section aria-label={t("calendarTitle")} className="panel rise flex flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-[var(--line)] px-5 pt-4 pb-3.5">
        <h2 className="min-w-0 flex-1 basis-full text-[20px] leading-tight font-semibold tracking-[-0.015em] text-[var(--text-1)] sm:basis-auto">
          {region?.name ?? state.regionId}
          <span className="ml-2 text-[15px] font-normal tracking-normal whitespace-nowrap text-[var(--text-3)]">{t("calendarTitle")}</span>
        </h2>
        <span className="flex items-center gap-1">
          <ModeToggle
            mode={state.mode}
            onChange={(m) => dispatch({ type: "setMode", mode: m })}
            disabled={isZ}
            disabledHint={t("modeNotApplicable")}
          />
          <InfoTip k={state.mode === "raw" ? "infoRaw" : "infoHarmonized"} label={state.mode === "raw" ? t("raw") : t("harmonized")} />
        </span>
        <div className="flex gap-1">
          <button
            className="btn btn-quiet"
            disabled={!a.rows}
            onClick={() => a.rows && downloadText(`${state.regionId}_monthly.csv`, monthlyToCsv(state.regionId!, a.rows))}
          >
            <Download className="size-4" aria-hidden /> {t("downloadCsv")}
          </button>
          <button className="btn btn-quiet" onClick={() => dispatch({ type: "backToGlobe" })}>
            <ArrowLeft className="size-4" aria-hidden /> {t("backToGlobe")}
          </button>
        </div>
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex items-center gap-1">
            <MetricSelect
              metric={metric}
              available={(m) => hasMetric(a.rows, m)}
              onChange={(m) => dispatch({ type: "setMetric", metric: m })}
            />
            <InfoTip k={metric === "anomaly" ? "infoHfai" : metric === "frp" ? "infoFrp" : "infoViirsEq"} />
          </span>
          <p className="min-w-0 flex-1 basis-60 text-[13px] text-[var(--text-2)]">
            {explain} <span className="t-caption">· {unit}</span>
            {isZ && <span className="t-caption block">{t("modeNotApplicable")}</span>}
          </p>
        </div>
      </header>

      {!a.rows ? (
        <DataState result={a.monthly} file={regionFile} />
      ) : (
        <div className="grid gap-y-5 px-4 pt-3 pb-4">
          <div ref={calRef} className="relative min-w-0">
            <BurnCalendar
              rows={a.rows}
              years={a.years}
              mode={state.mode}
              metric={metric}
              peakMonth={a.peak}
              selected={sel}
              oni={ensoOn ? oni : null}
              onSelect={(year, month, at) => {
                dispatch({ type: "selectMonth", year, month });
                const p = at ?? { x: 120, y: 80 };
                const h = calRef.current?.clientHeight ?? 9999;
                const w = calRef.current?.clientWidth ?? 9999;
                // Keep the card inside the calendar: flip up/left near the edges.
                setPopover({
                  left: p.x + 12,
                  top: p.y + 420 > h ? Math.max(0, p.y - 420) : p.y + 12,
                  flipX: p.x + 300 > w,
                });
              }}
            />
            <Legend metric={metric} />
            <EnsoLegend available={oni != null} on={ensoOn} onToggle={() => setEnsoOn((v) => !v)} />
            {popover && sel && (
              <div
                role="dialog"
                aria-label={t("detail")}
                className="panel panel-solid absolute z-20 w-72 p-3.5 text-[13px]"
                style={{
                  left: popover.left,
                  top: popover.top,
                  transform: popover.flipX ? "translateX(calc(-100% - 24px))" : undefined,
                }}
              >
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[14px] font-semibold text-[var(--text-1)]">
                    {monthLong(sel.month)} {sel.year}
                  </p>
                  <button className="btn btn-quiet btn-icon !size-7" aria-label={t("close")} onClick={() => setPopover(null)}>
                    <X className="size-3.5" />
                  </button>
                </div>
                {row ? (
                  <dl className="num grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-[var(--text-3)]">{t("value")}</dt>
                    <dd className="text-right font-medium text-[var(--text-1)]">
                      {fmt(displayValue(row, state.mode), 1)}{" "}
                      <span className="text-[var(--text-3)]">({state.mode === "raw" ? t("observed") : t("estimated")})</span>
                    </dd>
                    <dt className="text-[var(--text-3)]">{t("median")}</dt>
                    <dd className="text-right">{fmt(an?.median, 1)}</dd>
                    <dt className="text-[var(--text-3)]">{t("percentile")}</dt>
                    <dd className="text-right">
                      {an?.percentile != null ? `P${fmt(an.percentile, 0)}` : "—"}{" "}
                      <span className="text-[var(--text-3)]">({t("basedOnYears", { n: an?.nYears ?? 0 })})</span>
                    </dd>
                    {row.z != null && (
                      <>
                        <dt className="text-[var(--text-3)]">{t("hfai")}</dt>
                        <dd className="flex items-center justify-end gap-1.5 text-right">
                          {row.z_class && <ClassSwatch c={row.z_class} />}
                          {fmtSigned(row.z, 2)}
                          {row.z_class && <span className="text-[var(--text-3)]">({t(Z_CLASS_LABEL[row.z_class])})</span>}
                        </dd>
                      </>
                    )}
                    {row.frp_harmonized != null && (
                      <>
                        <dt className="text-[var(--text-3)]">{t("frpHarm")}</dt>
                        <dd className="text-right">{fmt(row.frp_harmonized, 0)} MW</dd>
                      </>
                    )}
                    {selOni && (
                      <>
                        <dt className="text-[var(--text-3)]">{t("oni")}</dt>
                        <dd className="text-right">
                          {fmtSigned(selOni.oni, 1)} <span className="text-[var(--text-3)]">({t(PHASE_LABEL[selOni.phase])})</span>
                        </dd>
                      </>
                    )}
                    <dt className="text-[var(--text-3)]">{t("sourceSat")}</dt>
                    <dd className="text-right">{row.source ?? "—"}</dd>
                    <dt className="text-[var(--text-3)]">{t("factor")}</dt>
                    <dd className="text-right">{fmt(row.factor, 2)}</dd>
                    <dt className="text-[var(--text-3)]">{t("regimeLabel")}</dt>
                    <dd className="text-right">{row.regime ?? "—"}</dd>
                    <dt className="t-label col-span-2 mt-2 border-t border-[var(--line)] pt-2">{t("rawVsHarm")}</dt>
                    <dt className="text-[var(--text-3)]">{t("modisRaw")}</dt>
                    <dd className="text-right">{fmt(row.raw_modis, 0)}</dd>
                    <dt className="text-[var(--text-3)]">{t("viirsRaw")}</dt>
                    <dd className="text-right">{fmt(row.raw_viirs, 0)}</dd>
                    <dt className="text-[var(--text-3)]">{t("harmonized")}</dt>
                    <dd className="text-right">{fmt(row.harmonized, 1)}</dd>
                    <dt className="text-[var(--text-3)]">{t("uncertainty")}</dt>
                    <dd className="text-right">
                      {fmt(row.harmonized_p5, 1)}–{fmt(row.harmonized_p95, 1)}
                    </dd>
                    {an?.diff != null && (
                      <>
                        <dt className="text-[var(--text-3)]">Δ</dt>
                        <dd className="text-right">{fmtSigned(an.diff, 1)}</dd>
                      </>
                    )}
                  </dl>
                ) : (
                  <p className="text-[var(--text-2)]">{t("noSensor")}</p>
                )}
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <div role="tablist" className="flex gap-4 border-b border-[var(--line)]">
              {(["series", "event", "ranking"] as const).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  className={`-mb-px h-8 border-b text-[13px] font-medium whitespace-nowrap transition-colors duration-150 ${
                    tab === k
                      ? "border-[var(--text-1)] text-[var(--text-1)]"
                      : "border-transparent text-[var(--text-3)] hover:text-[var(--text-2)]"
                  }`}
                  onClick={() => setTab(k)}
                >
                  {k === "series" ? t("timeSeries") : k === "event" ? t("eventMode") : t("rankingTab")}
                </button>
              ))}
            </div>
            {tab === "series" ? (
              <TimeSeries rows={a.rows} mode={state.mode} />
            ) : tab === "ranking" ? (
              sel && region ? <RankingPanel country={region.country} year={sel.year} month={sel.month} /> : null
            ) : sel ? (
              <EventMode
                rows={a.rows}
                years={a.years}
                year={sel.year}
                month={sel.month}
                onChange={(year, month) => dispatch({ type: "selectMonth", year, month })}
              />
            ) : null}
            {a.clim && a.clim.status !== "ok" && (
              <DataState result={a.clim} file={`/data/climatology/${state.regionId}.json`} />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ClassSwatch({ c }: { c: ZClass }) {
  return <span className="inline-block h-2.5 w-3.5 shrink-0 rounded-[2px]" style={{ background: ANOMALY[c] }} aria-hidden />;
}

const Z_LEGEND: { c: ZClass; range: string }[] = [
  { c: "below", range: "z < −0.5" },
  { c: "normal", range: "−0.5 to 1" },
  { c: "moderate", range: "1 to 2" },
  { c: "critical", range: "z > 2" },
];

function Legend({ metric }: { metric: CalendarMetric }) {
  const { t } = useI18n();
  return (
    <div className="t-caption mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1">
      {metric === "anomaly" ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{t("anomalyClasses")}:</span>
          {Z_LEGEND.map(({ c, range }) => (
            <span key={c} className="flex items-center gap-1.5">
              <ClassSwatch c={c} />
              <span className="text-[var(--text-2)]">{t(Z_CLASS_LABEL[c])}</span>
              <span className="num">({range})</span>
            </span>
          ))}
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <span>{t("low")}</span>
          <span className="h-1.5 w-24 rounded-full" style={{ background: FIRE_GRADIENT }} aria-hidden />
          <span>
            {t("high")}
            {metric === "frp" ? " · MW" : ""}
          </span>
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <span className="hatch h-2.5 w-3.5 rounded-[2px]" aria-hidden />
        {t("noSensor")}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-3.5 rounded-[2px] border border-[var(--sci)]" aria-hidden />
        <span className="text-[var(--sci)]">{t("peakMonth")}</span> / <span className="text-[var(--sci)]">{t("recordYear")}</span>
      </span>
      <span>{t("regimes")}: R1 Terra · R2 Terra+Aqua · R3 MODIS+VIIRS</span>
    </div>
  );
}

const PHASE_ORDER: EnsoPhase[] = ["el_nino", "neutral", "la_nina"];

function EnsoLegend({ available, on, onToggle }: { available: boolean; on: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  return (
    <div className="t-caption mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
      <button
        aria-pressed={available && on}
        disabled={!available}
        onClick={onToggle}
        className="-ml-1 flex h-6 items-center gap-2 rounded-md px-1 text-[var(--text-2)] transition-colors duration-150 hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Switch on={available && on} />
        {t("ensoBand")}
      </button>
      {available ? (
        PHASE_ORDER.map((p) => (
          <span key={p} className="flex items-center gap-1.5">
            <span className="h-[3px] w-4 rounded-full" style={{ background: ENSO[p] }} aria-hidden />
            {t(PHASE_LABEL[p])}
            <span className="num">({p === "el_nino" ? "ONI ≥ +0.5" : p === "la_nina" ? "ONI ≤ −0.5" : "±0.5"})</span>
          </span>
        ))
      ) : (
        <span>{t("ensoMissing")}</span>
      )}
    </div>
  );
}
