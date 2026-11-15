"use client";

import Image from "next/image";
import { CircleHelp, Database } from "lucide-react";
import logoImg from "@/app/logok-fire.png";
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

function Mark() {
  return (
    <Image
      src={logoImg}
      alt="K-Fire"
      width={48}
      height={48}
      className="size-11 sm:size-12 shrink-0 object-contain drop-shadow-[0_4px_14px_rgba(249,115,22,0.35)] transition-transform duration-300 group-hover:scale-105"
      priority
    />
  );
}

export function Header() {
  const { t, lang, setLang } = useI18n();
  const { state, dispatch } = useStore();

  return (
    <header className="pointer-events-none sticky top-0 z-50 flex min-h-16 w-full items-center justify-between gap-3 bg-transparent px-3 py-3 sm:px-6 lg:px-8">
      {/* 1. Brand Section: Logo + Título + Lema */}
      <div className="pointer-events-auto flex min-w-0 items-center space-x-3 sm:space-x-4">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            dispatch({ type: "setTab", tab: "explore" });
          }}
          className="group flex items-center space-x-3 bg-transparent transition-transform duration-300 hover:scale-[1.02]"
        >
          <Mark />
          <span
            aria-label={t("projectName")}
            className="text-base sm:text-lg lg:text-xl font-extrabold tracking-tight text-white drop-shadow-md whitespace-nowrap"
          >
            <span className="text-[#00b4ff]">K</span>
            <span className="text-orange-500">-</span>
            <span>Fire</span>
          </span>
        </a>

        {/* Separador vertical + lema (visible en pantallas medianas/grandes) */}
        <div className="hidden items-center border-l border-white/20 py-1 pl-4 lg:flex">
          <span className="text-xs sm:text-[13px] font-normal tracking-wide text-slate-200/90 drop-shadow-sm">
            {t("tagline")}
          </span>
        </div>
      </div>

      {/* 2. HUD Controls (Pestañas, Guía, Idioma) */}
      <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2.5 lg:gap-3 text-xs sm:text-sm font-medium shrink-0">
        {/* Botón Guía */}
        {!state.guide && state.view === "globe" && state.tab === "explore" && (
          <button
            type="button"
            onClick={() => dispatch({ type: "setGuide", open: true })}
            className="flex h-9 sm:h-10 items-center space-x-1.5 sm:space-x-2 rounded-full bg-transparent px-2.5 sm:px-3 text-xs sm:text-sm font-semibold text-white drop-shadow-sm transition-all duration-200 hover:bg-white/10 hover:text-white active:scale-95"
          >
            <CircleHelp className="size-4 sm:size-4.5 text-cyan-400 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline font-semibold">{t("obReopen")}</span>
          </button>
        )}

        {/* Pestañas de Navegación Segmentadas */}
        <div
          role="tablist"
          aria-label="View"
          className="flex items-center rounded-full border border-cyan-400/35 bg-[rgba(6,18,45,0.45)] p-1 sm:p-1.5 shadow-[0_0_20px_rgba(0,180,255,0.22),0_4px_20px_rgba(0,0,0,0.4),inset_0_0_15px_rgba(0,210,255,0.1),inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-xl transition-all duration-300 hover:border-cyan-400/50 hover:shadow-[0_0_25px_rgba(0,180,255,0.35)]"
        >
          {(["explore", "lab", "method"] as const).map((k) => {
            const active = state.tab === k;
            if (active) {
              return (
                <button
                  key={k}
                  role="tab"
                  aria-selected="true"
                  onClick={() => dispatch({ type: "setTab", tab: k })}
                  className="flex h-8 sm:h-9 items-center space-x-1.5 sm:space-x-2 rounded-full bg-gradient-to-r from-blue-600 to-blue-500 px-3.5 sm:px-4.5 text-xs sm:text-sm font-bold text-white shadow-[0_2px_12px_rgba(37,99,235,0.45),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all duration-200 active:scale-95 whitespace-nowrap"
                >
                  <svg className="size-3.5 sm:size-4 shrink-0 text-cyan-200" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" strokeWidth="2"></circle>
                    <polygon fill="currentColor" points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
                  </svg>
                  <span className="hidden sm:inline">{t(k)}</span>
                  <span className="sm:hidden">{k === "lab" ? "Lab" : t(k)}</span>
                </button>
              );
            }
            return (
              <button
                key={k}
                role="tab"
                aria-selected="false"
                onClick={() => dispatch({ type: "setTab", tab: k })}
                className="flex h-8 sm:h-9 items-center rounded-full px-3 sm:px-4 text-xs sm:text-sm font-medium text-slate-300 transition-all duration-200 hover:bg-white/10 hover:text-white active:scale-95 whitespace-nowrap"
              >
                <span className="hidden sm:inline">{t(k)}</span>
                <span className="sm:hidden">{k === "lab" ? "Lab" : t(k)}</span>
              </button>
            );
          })}
        </div>

        {/* Switch Selector de Idioma */}
        <div
          role="group"
          aria-label={t("language")}
          className="flex items-center rounded-full border border-cyan-400/35 bg-[rgba(6,18,45,0.45)] p-1 shadow-[0_0_20px_rgba(0,180,255,0.22),0_4px_20px_rgba(0,0,0,0.4),inset_0_0_15px_rgba(0,210,255,0.1),inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-xl transition-all duration-300 hover:border-cyan-400/50 hover:shadow-[0_0_25px_rgba(0,180,255,0.35)]"
        >
          {(["en", "es"] as const).map((l) => {
            const active = lang === l;
            return (
              <button
                key={l}
                type="button"
                aria-pressed={active}
                onClick={() => setLang(l)}
                className={`flex h-7 sm:h-8 items-center justify-center rounded-full px-2.5 sm:px-3 text-xs sm:text-[13px] transition-all duration-200 active:scale-95 ${active
                    ? "bg-gradient-to-r from-blue-600 to-blue-500 font-bold text-white shadow-[0_2px_8px_rgba(37,99,235,0.4),inset_0_1px_0_rgba(255,255,255,0.25)]"
                    : "font-medium text-slate-300 hover:text-white hover:bg-white/5"
                  }`}
              >
                {l.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}

export function Credits() {
  const { t } = useI18n();
  const [fireLabel, fireSource] = t("creditsFire").split(": ");
  return (
    <div className="glass-pill pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-full border border-cyan-400/25 px-3.5 py-1.5 text-center text-[10.5px] leading-snug text-slate-300/90 shadow-[0_4px_20px_rgba(0,0,0,0.45),0_0_12px_rgba(6,182,212,0.12)] backdrop-blur-md">
      <Database className="size-3.5 shrink-0 text-cyan-400 drop-shadow-[0_0_4px_rgba(34,211,238,0.5)]" aria-hidden="true" />
      <p className="truncate sm:whitespace-normal">
        {fireSource ? (
          <>
            <strong className="font-semibold text-white">{fireLabel}:</strong>{" "}
            <span className="text-cyan-200/95 font-medium">{fireSource}</span>
          </>
        ) : (
          <strong className="font-semibold text-white">{t("creditsFire")}</strong>
        )}
        <span className="mx-1.5 text-cyan-400/50">·</span>
        <span>{t("creditsS2")} (contains modified Copernicus Sentinel data 2020)</span>
        <span className="mx-1.5 text-cyan-400/50">·</span>
        <span className="text-slate-400">{t("creditsOfm")}</span>
      </p>
    </div>
  );
}
