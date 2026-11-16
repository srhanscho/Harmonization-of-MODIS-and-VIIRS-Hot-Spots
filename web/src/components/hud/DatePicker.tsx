"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRegionAnalytics } from "@/lib/analytics";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/lib/store";

/**
 * Compact year + month-grid date picker. It replaces the old bottom scrub timeline: one year at
 * a time, with a tiny activity bar per month so you can see which months had fire before
 * jumping to one. Sits right below the place search, so picking *where* and picking *when* are
 * two clearly separate steps.
 */
export function DatePicker() {
  const { state, dispatch } = useStore();
  const { t, monthShort } = useI18n();
  const a = useRegionAnalytics();
  // Browsing to another year is a temporary override. It only holds while the region and the
  // selected year stay the same: a new region, or a jump made elsewhere (search box, ranking link,
  // assistant) moves the selection and the picker follows it again.
  const [browse, setBrowse] = useState<{ regionId: string | null; selYear: number | null; year: number } | null>(null);

  if (state.tab !== "explore") return null;

  // Always visible in the explore tab. Until a place is open (home globe, or data still
  // loading) it shows the same card disabled, with a hint, so people know where dates live.
  const ready = !!state.regionId && state.view === "region" && !!a.rows && a.years.length > 0;
  if (!ready || !a.rows) {
    return (
      <section aria-label={t("dateLabel")} className="glass-panel pointer-events-auto flex shrink-0 flex-col gap-2.5 rounded-2xl p-3.5 text-xs text-white">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-slate-400">{t("dateLabel")}</span>
          <span className="num w-11 text-center text-[13px] font-bold text-slate-500">—</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5 opacity-40" aria-hidden>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <span key={m} className="flex h-11 items-end justify-center rounded-lg border border-slate-700/60 bg-[#081730]/70 pb-1 text-[10.5px] font-semibold">
              {monthShort(m)}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-slate-400">{t("dateNeedsPlace")}</p>
      </section>
    );
  }

  const sel = a.selected;
  const override = browse && browse.regionId === state.regionId && browse.selYear === (sel?.year ?? null) ? browse.year : null;
  const activeYear = override ?? sel?.year ?? a.years[a.years.length - 1];
  const yi = a.years.indexOf(activeYear);
  const atFirst = yi <= 0;
  const atLast = yi < 0 || yi >= a.years.length - 1;

  const byMonth = new Map<number, number | null>();
  for (const r of a.rows) if (r.year === activeYear) byMonth.set(r.month, r.harmonized);
  const max = Math.max(1, ...[...byMonth.values()].map((v) => v ?? 0));

  const goYear = (d: number) => {
    const next = a.years[Math.max(0, Math.min(a.years.length - 1, (yi < 0 ? a.years.length - 1 : yi) + d))];
    if (next != null) setBrowse({ regionId: state.regionId, selYear: sel?.year ?? null, year: next });
  };
  const pick = (m: number) => {
    if (!byMonth.has(m)) return;
    dispatch({ type: "selectMonth", year: activeYear, month: m });
  };

  return (
    <section aria-label={t("dateLabel")} className="glass-panel pointer-events-auto flex shrink-0 flex-col gap-2.5 rounded-2xl p-3.5 text-xs text-white">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-slate-400">{t("dateLabel")}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn btn-quiet btn-icon !size-6 disabled:cursor-not-allowed disabled:opacity-30"
            disabled={atFirst}
            aria-label={t("prevYear")}
            onClick={() => goYear(-1)}
          >
            <ChevronLeft className="size-3.5" aria-hidden />
          </button>
          <span className="num w-11 text-center text-[13px] font-bold text-white">{activeYear}</span>
          <button
            type="button"
            className="btn btn-quiet btn-icon !size-6 disabled:cursor-not-allowed disabled:opacity-30"
            disabled={atLast}
            aria-label={t("nextYear")}
            onClick={() => goYear(1)}
          >
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
          const v = byMonth.get(m);
          const has = byMonth.has(m);
          const active = sel?.year === activeYear && sel?.month === m;
          const barPct = has && v != null && max > 0 ? Math.max(8, Math.round((v / max) * 60)) : 0;
          return (
            <button
              key={m}
              type="button"
              disabled={!has}
              aria-pressed={active}
              title={has ? `${monthShort(m)} ${activeYear}` : undefined}
              onClick={() => pick(m)}
              className={`group relative flex h-11 items-end justify-center overflow-hidden rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-30 ${
                active
                  ? "border-cyan-400 bg-cyan-500/15 shadow-[0_0_10px_rgba(34,211,238,0.35)]"
                  : "border-slate-700/60 bg-[#081730]/70 hover:border-cyan-500/40 hover:bg-cyan-500/10"
              }`}
            >
              {has && (
                <span
                  aria-hidden
                  className={`absolute inset-x-1 bottom-0.5 rounded-sm transition-all ${active ? "bg-cyan-300" : "bg-cyan-500/50 group-hover:bg-cyan-400/70"}`}
                  style={{ height: `${barPct}%` }}
                />
              )}
              <span className="relative z-10 pb-1 text-[10.5px] font-semibold">{monthShort(m)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
