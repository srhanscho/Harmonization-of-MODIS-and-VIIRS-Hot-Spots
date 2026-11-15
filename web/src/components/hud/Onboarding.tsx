"use client";

import { useEffect } from "react";
import { ArrowRight, X } from "lucide-react";
import { DEMOS } from "./RegionPicker";
import { useI18n, type DictKey } from "@/lib/i18n";
import { FIRE } from "@/lib/palette";
import { useStore } from "@/lib/store";
import type { Action } from "@/lib/store";
import type { Region } from "@/lib/types";

const KEY = "hotspots.guide.dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
function writeDismissed() {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    /* storage blocked: the card simply returns next visit */
  }
}

interface Story {
  title: DictKey;
  sub: DictKey;
  demo: number;
  /** Extra actions after the region opens (mode / metric / month). */
  then: (r: Region) => Action[];
}

const STORIES: Story[] = [
  { title: "obStory1", sub: "obStory1Sub", demo: 0, then: () => [{ type: "setMode", mode: "harmonized" }, { type: "setMetric", metric: "activity" }] },
  // Opens in Raw so the 2012 jump is on screen; the Harmonized switch then removes it.
  { title: "obStory2", sub: "obStory2Sub", demo: 1, then: () => [{ type: "setMode", mode: "raw" }, { type: "setMetric", metric: "activity" }] },
  // Strong El Niño season 2015–16, read as HFAI anomaly.
  { title: "obStory3", sub: "obStory3Sub", demo: 2, then: () => [{ type: "setMetric", metric: "anomaly" }, { type: "selectMonth", year: 2016, month: 2 }] },
];

/** A tiny 3x2 pixel glyph per story, in the data ramp, so the stories read as map content. */
function Glyph({ i }: { i: number }) {
  const sets = [
    [FIRE[1], FIRE[4], FIRE[6], FIRE[2], FIRE[7], FIRE[5]],
    [FIRE[2], FIRE[5], FIRE[1], FIRE[6], FIRE[3], FIRE[2]],
    [FIRE[3], FIRE[1], FIRE[5], FIRE[4], FIRE[2], FIRE[1]],
  ][i];
  return (
    <svg width="26" height="18" viewBox="0 0 26 18" aria-hidden className="shrink-0">
      {sets.map((c, k) => (
        <rect key={k} x={(k % 3) * 9} y={Math.floor(k / 3) * 9} width="8" height="8" fill={c} />
      ))}
    </svg>
  );
}

export function Onboarding() {
  const { state, dispatch, regions } = useStore();
  const { t } = useI18n();
  useEffect(() => {
    if (readDismissed()) dispatch({ type: "setGuide", open: false });
  }, [dispatch]);

  if (!state.guide || state.view !== "globe" || state.tab !== "explore") return null;
  const list = regions?.status === "ok" ? regions.data : [];

  const dismiss = () => {
    writeDismissed();
    dispatch({ type: "setGuide", open: false });
  };
  const open = (s: Story) => {
    const d = DEMOS[s.demo];
    const r = d?.find(list);
    if (!r) return;
    dispatch({ type: "selectRegion", regionId: r.id, year: d.year, month: d.month });
    for (const a of s.then(r)) dispatch(a);
  };

  return (
    <section aria-labelledby="guide-title" className="glass-panel rise pointer-events-auto w-full max-w-[34rem] overflow-hidden rounded-2xl">
      <div className="flex items-start justify-between gap-4 px-5 pt-4">
        <h2 id="guide-title" className="text-[19px] leading-snug font-bold tracking-tight text-balance text-white">
          {t("obTitle")}
        </h2>
        <button className="btn btn-quiet btn-icon -mt-1 -mr-2 shrink-0 text-slate-400 hover:text-white" aria-label={t("obDismiss")} onClick={dismiss}>
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <ol className="mt-3 flex flex-col gap-2.5 px-5 text-[13.5px] text-slate-200">
        {(["obStep1", "obStep2", "obStep3"] as const).map((k, i) => (
          <li key={k} className="grid grid-cols-[1.375rem_1fr] items-baseline gap-2">
            <span className="num flex size-5 items-center justify-center rounded-full border border-cyan-400/35 bg-cyan-950/70 text-[11px] font-bold text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.3)]">
              {i + 1}
            </span>
            <span>{t(k)}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 border-t border-cyan-500/20 bg-slate-950/45 px-3 py-3">
        <h3 className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-cyan-300 uppercase">{t("obStart")}</h3>
        <ul className="flex flex-col gap-0.5">
          {STORIES.map((s, i) => {
            const available = !!DEMOS[s.demo]?.find(list);
            return (
              <li key={s.title}>
                <button
                  className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 text-left transition-all duration-150 hover:border-cyan-400/25 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!available}
                  onClick={() => open(s)}
                >
                  <Glyph i={i} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-white">{t(s.title)}</span>
                    <span className="block text-[12px] text-slate-400">{t(s.sub)}</span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-cyan-400/60 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-cyan-300" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
