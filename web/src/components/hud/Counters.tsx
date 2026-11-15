"use client";

import { ClimateCard } from "./ClimateCard";
import { InfoTip } from "@/components/ui/InfoTip";
import { useRegionAnalytics } from "@/lib/analytics";
import { useI18n, type DictKey } from "@/lib/i18n";
import { activeSatellites, fmt, fmtSigned, regimeFor } from "@/lib/series";
import { useStore, type Layers } from "@/lib/store";

function Stat({ label, value, sub, accent, info }: { label: string; value: string; sub?: string; accent?: boolean; info?: DictKey }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="t-label flex items-center gap-1">
        {label}
        {info && <InfoTip k={info} label={label} />}
      </p>
      <p className={`t-figure num ${accent ? "!text-[var(--sci)]" : ""}`}>{value}</p>
      {sub && <p className="t-caption num">{sub}</p>}
    </div>
  );
}

export function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors duration-150 ${
        on ? "border-transparent bg-[var(--sci)]" : "border-[var(--line-strong)] bg-[var(--ink-2)]"
      }`}
    >
      <span
        className={`absolute size-2.5 rounded-full transition-transform duration-150 ${
          on ? "translate-x-[14px] bg-white" : "translate-x-[2px] bg-[var(--text-3)]"
        }`}
      />
    </span>
  );
}

const LAYERS: { key: keyof Layers; label: DictKey }[] = [
  { key: "cells", label: "layerCells" },
  { key: "outline", label: "layerOutline" },
  { key: "boundaries", label: "layerBoundaries" },
  { key: "wind", label: "layerWind" },
  { key: "basemap", label: "layerBasemap" },
];

export function Counters() {
  const { state, dispatch } = useStore();
  const a = useRegionAnalytics();
  const { t, monthLong, monthShort } = useI18n();
  const sel = a.selected;
  const an = a.anomaly;
  const sats = sel ? activeSatellites(sel.year, sel.month) : [];

  return (
    <aside aria-label={t("indicators")} className="panel flex flex-col">
      <div className="px-4 pt-3.5 pb-3">
        <h2 className="t-label mb-3 !text-[var(--text-2)]">{t("indicators")}</h2>
        {!state.regionId ? (
          <p className="text-[13px] text-[var(--text-2)]">{t("selectRegionPrompt")}</p>
        ) : !a.rows ? (
          <p className="text-[13px] text-[var(--text-3)]">{a.monthly == null ? t("loading") : t("notGenerated")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 [&>*]:border-t [&>*]:border-[var(--line)] [&>*]:py-3">
            <Stat
              label={`${t("selectedMonth")}${sel ? ` · ${monthShort(sel.month)} ${sel.year}` : ""}`}
              value={an?.diff != null ? fmtSigned(an.diff, 0) : "—"}
              sub={
                an?.value != null
                  ? `${fmt(an.value, 0)} vs ${fmt(an.median, 0)} · ${an.percentile != null ? `P${fmt(an.percentile, 0)}` : "—"} · ${t("basedOnYears", { n: an.nYears })}`
                  : t("noSensor")
              }
              accent={an?.percentile != null && an.percentile >= 90}
              info="infoPercentile"
            />
            {sel && (
              <Stat
                label={t("periodTotal", { year: sel.year })}
                value={fmt(a.selectedYearTotal?.total, 0)}
                sub={a.selectedYearTotal ? `${a.selectedYearTotal.months}/12 ${t("months")} · ${t("unit")}` : undefined}
                info="infoViirsEq"
              />
            )}
            <div className="grid grid-cols-2 gap-x-4">
              <div className="flex flex-col gap-1">
                <p className="t-label flex items-center gap-1">
                  {t("peakMonth")} <InfoTip k="infoPeak" label={t("peakMonth")} />
                </p>
                <p className="text-[15px] font-medium text-[var(--text-1)]">{a.peak ? monthLong(a.peak) : "—"}</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="t-label flex items-center gap-1">
                  {t("seasonLength")} <InfoTip k="infoSeason" label={t("seasonLength")} />
                </p>
                <p className="num text-[15px] font-medium text-[var(--text-1)]">
                  {a.season.length ? `${a.season.length} ${t("months")}` : "—"}
                </p>
              </div>
              {a.season.length > 0 && (
                <p className="t-caption col-span-2 mt-1">{a.season.map((m) => monthShort(m)).join(" · ")}</p>
              )}
            </div>
            <Stat
              label={t("recordYear")}
              value={a.record ? String(a.record.year) : "—"}
              sub={
                a.record
                  ? `${fmt(a.record.total, 0)} ${t("unit")} (${t("harmonized").toLowerCase()})${
                      a.record.months < 12 ? ` · ${a.record.months}/12 ${t("months")}` : ""
                    }`
                  : undefined
              }
              info="infoRecord"
            />
            {sel && (
              <div className="flex flex-col gap-1.5">
                <p className="t-label flex items-center gap-1">
                  {t("activeSatellites")} · {monthShort(sel.month)} {sel.year}
                  <InfoTip k="infoSatellites" label={t("activeSatellites")} />
                </p>
                <ul className="flex flex-wrap gap-1">
                  {sats.map((s) => (
                    <li
                      key={s.name}
                      className="rounded-[5px] border border-[var(--line-strong)] px-1.5 py-0.5 text-xs text-[var(--text-1)]"
                    >
                      {s.name}
                      {s.note && <span className="text-[var(--text-3)]"> ({s.note})</span>}
                    </li>
                  ))}
                </ul>
                <p className="t-caption">
                  {t("regimeLabel")} {a.selectedRow?.regime ?? regimeFor(sel.year, sel.month) ?? "—"}
                  {a.selectedRow?.source ? ` · ${t("sourceSat")}: ${a.selectedRow.source}` : ""}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      {state.regionId && <ClimateCard regionId={state.regionId} />}
      <div className="border-t border-[var(--line)] px-4 pt-3 pb-3.5">
        <h2 className="t-label mb-1.5">{t("layers")}</h2>
        <ul className="-mx-2 flex flex-col">
          {LAYERS.map((l) => {
            const on = state.layers[l.key];
            return (
              <li key={l.key}>
                <button
                  aria-pressed={on}
                  onClick={() => dispatch({ type: "toggleLayer", layer: l.key })}
                  className="flex h-7 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-xs text-[var(--text-2)] transition-colors duration-150 hover:bg-[var(--ink-2)] hover:text-[var(--text-1)]"
                >
                  <span className={on ? "text-[var(--text-1)]" : ""}>{t(l.label)}</span>
                  <Switch on={on} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
