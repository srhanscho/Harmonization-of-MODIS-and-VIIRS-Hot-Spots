"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useRegionAnalytics } from "@/lib/analytics";
import { useI18n } from "@/lib/i18n";
import { ACCENT, SERIES } from "@/lib/palette";
import { FIRST_YEAR, VIIRS_START_YEAR, displayValue } from "@/lib/series";
import { useStore } from "@/lib/store";

const W = 1000;
const H = 44;
const PAD = 3;
const SPEEDS = [1, 2, 4] as const;

/**
 * Bottom timeline: the whole harmonized record as one line, the raw record as a faint ghost
 * (so the 2012 jump vs the harmonized continuity is visible at a glance), a scrubber synced
 * with the calendar selection, and month-by-month playback that drives the map.
 */
export function Timeline() {
  const { state, dispatch } = useStore();
  const { t, monthShort } = useI18n();
  const a = useRegionAnalytics();
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  const months = useMemo(
    () =>
      (a.rows ?? [])
        .filter((r) => r.year >= FIRST_YEAR && r.harmonized != null)
        .sort((x, y) => x.year - y.year || x.month - y.month),
    [a.rows],
  );
  const geom = useMemo(() => {
    if (months.length < 2) return null;
    const raw = months.map((r) => displayValue(r, "raw"));
    const harm = months.map((r) => r.harmonized as number);
    const max = Math.max(1, ...harm, ...raw.map((v) => v ?? 0));
    const x = (i: number) => (i / (months.length - 1)) * W;
    const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
    const line = (vals: (number | null)[]) => {
      let d = "";
      let pen = false;
      vals.forEach((v, i) => {
        if (v == null) {
          pen = false;
          return;
        }
        d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      return d;
    };
    const harmD = line(harm);
    const seam = months.findIndex((r) => r.year >= VIIRS_START_YEAR);
    const years = months.map((r, i) => (r.month === 1 && r.year % 5 === 0 ? { i, year: r.year } : null)).filter((v) => v != null);
    return { rawD: line(raw), harmD, area: `${harmD}L${W},${H}L0,${H}Z`, x, seam, years };
  }, [months]);

  const sel = a.selected;
  const idx = sel ? months.findIndex((r) => r.year === sel.year && r.month === sel.month) : -1;

  // Playback: advance one month per tick; stop at the last observed month.
  const idxRef = useRef(idx);
  useEffect(() => {
    idxRef.current = idx;
  }, [idx]);
  useEffect(() => {
    if (!playing || months.length === 0) return;
    const id = window.setInterval(() => {
      const next = idxRef.current + 1;
      if (next >= months.length) {
        setPlaying(false);
        return;
      }
      dispatch({ type: "selectMonth", year: months[next].year, month: months[next].month });
    }, 900 / speed);
    return () => window.clearInterval(id);
  }, [playing, speed, months, dispatch]);

  if (!state.regionId || state.view !== "region" || state.tab !== "explore" || !geom) return null;

  const pick = (clientX: number) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const i = Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (months.length - 1));
    const m = months[i];
    if (m) dispatch({ type: "selectMonth", year: m.year, month: m.month });
  };
  const step = (d: number) => {
    const m = months[Math.max(0, Math.min(months.length - 1, (idx < 0 ? months.length - 1 : idx) + d))];
    if (m) dispatch({ type: "selectMonth", year: m.year, month: m.month });
  };
  const togglePlay = () => {
    if (!playing && idx >= months.length - 1) {
      const m = months[0];
      dispatch({ type: "selectMonth", year: m.year, month: m.month });
    }
    setPlaying((p) => !p);
  };
  const sx = idx >= 0 ? geom.x(idx) : null;

  return (
    <section aria-label={t("tlLabel")} className="panel flex w-full items-center gap-3 px-2.5 py-2">
      <button
        className="btn btn-primary btn-icon !size-8 shrink-0 !rounded-full"
        aria-label={playing ? t("tlPause") : t("tlPlay")}
        onClick={togglePlay}
      >
        {playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="ml-0.5 size-3.5" aria-hidden />}
      </button>
      <div role="group" aria-label={t("tlSpeed")} className="seg hidden shrink-0 sm:inline-flex">
        {SPEEDS.map((s) => (
          <button key={s} aria-pressed={speed === s} className="num !h-6 !px-2 !text-[12px]" onClick={() => setSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      <p className="num w-[4.75rem] shrink-0 text-[14px] font-semibold text-[var(--text-1)]" aria-live="polite">
        {sel ? `${monthShort(sel.month)} ${sel.year}` : "—"}
      </p>
      <div className="relative min-w-0 flex-1">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-9 w-full cursor-ew-resize touch-none select-none focus-visible:outline-2"
          role="slider"
          tabIndex={0}
          aria-label={t("tlScrub")}
          aria-valuemin={0}
          aria-valuemax={months.length - 1}
          aria-valuenow={Math.max(0, idx)}
          aria-valuetext={sel ? `${monthShort(sel.month)} ${sel.year}` : undefined}
          onPointerDown={(e) => {
            dragging.current = true;
            (e.target as Element).setPointerCapture?.(e.pointerId);
            setPlaying(false);
            pick(e.clientX);
          }}
          onPointerMove={(e) => dragging.current && pick(e.clientX)}
          onPointerUp={() => (dragging.current = false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") step(e.shiftKey ? 12 : 1);
            else if (e.key === "ArrowLeft") step(e.shiftKey ? -12 : -1);
            else if (e.key === " ") togglePlay();
            else return;
            e.preventDefault();
          }}
        >
          {geom.seam > 0 && (
            <line x1={geom.x(geom.seam)} x2={geom.x(geom.seam)} y1="0" y2={H} stroke="#5b6a7e" strokeDasharray="3 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          )}
          <path d={geom.rawD} fill="none" stroke="#5b6a7e" strokeOpacity="0.38" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d={geom.area} fill={SERIES.harmonized} fillOpacity="0.1" />
          <path d={geom.harmD} fill="none" stroke={SERIES.harmonized} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          {sx != null && <line x1={sx} x2={sx} y1="0" y2={H} stroke={ACCENT} strokeWidth="2" vectorEffect="non-scaling-stroke" />}
        </svg>
        <div className="relative h-3.5" aria-hidden>
          {geom.years.map((g) => (
            <span key={g.year} className="num absolute top-0 -translate-x-1/2 text-[10px] leading-none text-[var(--text-3)]" style={{ left: `${(geom.x(g.i) / W) * 100}%` }}>
              {g.year}
            </span>
          ))}
        </div>
        {sx != null && (
          <span
            className="pointer-events-none absolute top-0 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--sci)] shadow"
            style={{ left: `${(sx / W) * 100}%` }}
            aria-hidden
          />
        )}
      </div>
      <div className="hidden shrink-0 flex-col gap-0.5 text-[11px] text-[var(--text-3)] md:flex">
        <span className="flex items-center gap-1.5">
          <span className="h-[2px] w-3.5 rounded-full" style={{ background: SERIES.harmonized }} aria-hidden />
          {t("tlHarm")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-px w-3.5 bg-[#5b6a7e] opacity-60" aria-hidden />
          {t("tlRaw")}
        </span>
      </div>
    </section>
  );
}
