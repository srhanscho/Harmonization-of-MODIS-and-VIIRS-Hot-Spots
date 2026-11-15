"use client";

import { CircleHelp } from "lucide-react";
import { USE_FIXTURE } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/lib/store";

export function FixtureBanner() {
  const { t } = useI18n();
  if (!USE_FIXTURE) return null;
  return (
    <div
      role="alert"
      className="pointer-events-auto fixed inset-x-0 top-0 z-[60] flex h-7 items-center justify-center gap-2 bg-[#a3271a] px-3 text-center text-xs text-white"
    >
      <span className="font-semibold tracking-wide">{t("simulated")}</span>
      <span className="hidden opacity-80 sm:inline">{t("simulatedHint")}</span>
    </div>
  );
}

/** Product mark: a coarse pixel and the finer pixels inside it (the whole idea, at 20 px). */
function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden className="shrink-0">
      <rect x="1" y="1" width="20" height="20" rx="2" fill="none" stroke="var(--sci)" strokeWidth="2" />
      <rect x="5" y="5" width="5.5" height="5.5" fill="#fc8d3c" />
      <rect x="11.5" y="5" width="5.5" height="5.5" fill="#d3301f" />
      <rect x="5" y="11.5" width="5.5" height="5.5" fill="#fdb85a" />
      <rect x="11.5" y="11.5" width="5.5" height="5.5" fill="#f05a28" opacity="0.35" />
    </svg>
  );
}

export function Header() {
  const { t, lang, setLang } = useI18n();
  const { state, dispatch } = useStore();
  return (
    <header className="flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-[var(--line)] bg-white/95 px-4 py-2 shadow-[0_1px_2px_rgba(11,31,58,0.05)] lg:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <Mark />
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0">
          <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--text-1)]">{t("projectName")}</h1>
          <p className="text-[13px] text-[var(--text-2)]">{t("tagline")}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {!state.guide && state.view === "globe" && state.tab === "explore" && (
          <button className="btn btn-quiet !h-8 !px-2.5" onClick={() => dispatch({ type: "setGuide", open: true })}>
            <CircleHelp className="size-4" aria-hidden /> {t("obReopen")}
          </button>
        )}
        <div role="tablist" aria-label="View" className="seg">
          {(["explore", "lab", "method"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={state.tab === k} onClick={() => dispatch({ type: "setTab", tab: k })}>
              {t(k)}
            </button>
          ))}
        </div>
        <div role="group" aria-label={t("language")} className="seg">
          {(["en", "es"] as const).map((l) => (
            <button key={l} aria-pressed={lang === l} className="!px-2.5" onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

export function Credits() {
  const { t } = useI18n();
  return (
    <p className="chip pointer-events-auto px-2 py-0.5 text-center text-[10.5px] text-[var(--text-3)]">
      {t("creditsFire")} · {t("creditsS2")} (contains modified Copernicus Sentinel data 2020) · {t("creditsOfm")}
    </p>
  );
}
