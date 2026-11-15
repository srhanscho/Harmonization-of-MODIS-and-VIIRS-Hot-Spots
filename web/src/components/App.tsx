"use client";

import dynamic from "next/dynamic";
import { useState, type CSSProperties } from "react";
import { ChevronDown, ChevronRight, MessageSquareText, Search, X } from "lucide-react";
import { AssistantBar, AstroBotIcon } from "./assistant/AssistantBar";
import { CalendarPanel } from "./calendar/CalendarPanel";
import { Counters } from "./hud/Counters";
import { Credits, FixtureBanner, Header } from "./hud/Chrome";
import { LabView } from "./hud/LabView";
import { MethodView } from "./hud/MethodView";
import { Onboarding } from "./hud/Onboarding";
import { RegionPicker } from "./hud/RegionPicker";
import { Timeline } from "./hud/Timeline";
import { USE_FIXTURE } from "@/lib/data";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { StoreProvider, useStore } from "@/lib/store";

const GlobeMap = dynamic(() => import("./map/GlobeMap"), { ssr: false });

/** Floating assistant: a button on the map that expands into the ask panel. */
function AssistantDock() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div
      className="pointer-events-none absolute right-4 z-20 flex flex-col items-end gap-2.5 sm:right-6"
      style={{ bottom: "calc(var(--map-bottom, 0px) + 18px)" }}
    >
      {open && (
        <div className="pointer-events-auto w-[min(28rem,calc(100vw-24px))]">
          <AssistantBar />
        </div>
      )}
      <button
        type="button"
        className={`group pointer-events-auto relative flex h-10 items-center gap-2 rounded-full border px-4.5 text-xs sm:text-[13px] font-semibold tracking-wide text-white transition-colors duration-200 ${
          open
            ? "border-cyan-400/50 bg-[rgba(8,20,45,0.92)] shadow-[0_8px_24px_rgba(0,0,0,0.55),0_0_18px_rgba(6,182,212,0.3)] backdrop-blur-xl hover:border-cyan-300/80"
            : "border-cyan-300/50 bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 shadow-[0_0_25px_rgba(37,99,235,0.7),0_0_12px_rgba(6,182,212,0.35),inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-xl hover:border-cyan-200/85 hover:shadow-[0_0_32px_rgba(56,189,248,0.95)]"
        }`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {!open && (
          <span className="absolute -top-[4.15rem] right-1 flex cursor-pointer items-center justify-center sm:-top-[5.15rem] sm:right-1.5 lg:-top-[5.65rem] lg:right-2">
            <AstroBotIcon className="size-16 drop-shadow-[0_6px_16px_rgba(0,210,255,0.6)] transition-transform duration-300 group-hover:-translate-y-1 sm:size-20 lg:size-22" />
            <span className="absolute right-1.5 bottom-1.5 size-2.5 rounded-full border border-slate-950 bg-emerald-400 shadow-[0_0_6px_#34d399] sm:right-2 sm:bottom-2 sm:size-3" />
          </span>
        )}
        {open ? (
          <>
            <X className="size-4 text-cyan-300 transition-transform duration-200 group-hover:rotate-90" aria-hidden />
            <span>{t("close")}</span>
          </>
        ) : (
          <>
            <MessageSquareText className="size-4 text-cyan-200 drop-shadow-[0_0_6px_rgba(165,243,252,0.6)]" aria-hidden />
            <span className="drop-shadow-sm">{t("askShort")}</span>
            <ChevronRight className="size-3.5 text-cyan-200/90 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
          </>
        )}
      </button>
    </div>
  );
}

function Shell() {
  const { state } = useStore();
  const { lang, t } = useI18n();
  const [placesOpen, setPlacesOpen] = useState(false);
  const region = state.view === "region" && state.tab === "explore";
  const analysis = state.tab !== "explore" || state.view === "region";
  // Space reserved at the bottom of the map for the timeline strip (md and up, region view).
  const vars = { "--map-bottom": region ? "var(--tl-h)" : "0px" } as CSSProperties;

  return (
    <div lang={lang} className="flex min-h-dvh w-full flex-col bg-[var(--ink-0)] text-[var(--text-1)] xl:h-dvh xl:overflow-hidden">
      <FixtureBanner />
      <div className={`pointer-events-none absolute inset-x-0 z-30 ${USE_FIXTURE ? "top-7" : "top-0"}`}>
        <Header />
      </div>

      <div className="flex flex-1 flex-col xl:min-h-0 xl:flex-row">
        {/* ---------- Map column: always visible ---------- */}
        <section
          style={vars}
          className="relative h-[80vh] min-h-[32rem] shrink-0 overflow-hidden [--tl-h:0px] md:h-[85vh] md:[--tl-h:72px] lg:h-[90vh] xl:h-auto xl:min-h-0 xl:flex-1"
        >
          <GlobeMap />

          {/* Desktop: compact place card over the map. */}
          <div className="absolute top-16 left-6 z-10 hidden max-h-[calc(100%-4.5rem-var(--map-bottom))] w-72 overflow-y-auto rounded-2xl xl:block">
            <RegionPicker collapsible />
          </div>

          {/* Home: the welcome card sits on the map (desktop). */}
          {state.view === "globe" && state.tab === "explore" && (
            <div className="pointer-events-none absolute inset-x-0 bottom-14 z-10 hidden justify-center px-4 xl:flex">
              <Onboarding />
            </div>
          )}

          {region && (
            <div className="absolute inset-x-2 bottom-2 z-10 hidden md:block">
              <Timeline />
            </div>
          )}

          <AssistantDock />

          {!analysis && (
            <div className="pointer-events-none absolute inset-x-4 bottom-3.5 z-10 hidden justify-center xl:flex">
              <Credits />
            </div>
          )}
        </section>

        {/* ---------- Below the map (phones / tablets) ---------- */}
        <div className="flex flex-col gap-3 px-3 pt-3 xl:hidden">
          <button
            className="glass-panel flex h-11 items-center gap-2.5 rounded-2xl px-4 text-left text-xs font-medium text-white shadow-lg transition hover:border-cyan-400/50"
            aria-expanded={placesOpen}
            onClick={() => setPlacesOpen((v) => !v)}
          >
            <Search className="size-3.5 text-cyan-400" aria-hidden />
            <span className="flex-1 font-semibold text-white">{t("findPlace")}</span>
            <ChevronDown className={`size-4 text-slate-400 transition-transform duration-200 ${placesOpen ? "rotate-180 text-cyan-400" : ""}`} aria-hidden />
          </button>
          {placesOpen && <RegionPicker />}
          {region && (
            <div className="md:hidden">
              <Timeline />
            </div>
          )}
          {state.view === "globe" && state.tab === "explore" && (
            <div className="flex justify-center">
              <Onboarding />
            </div>
          )}
        </div>

        {/* ---------- Analysis column ---------- */}
        {analysis && (
          <aside
            aria-label={t("analysis")}
            className="flex flex-col gap-3 px-3 pt-3 pb-4 xl:w-[42%] xl:max-w-[860px] xl:min-w-[540px] xl:shrink-0 xl:overflow-y-auto xl:border-l xl:border-cyan-500/20 xl:bg-[rgba(3,8,22,0.92)] xl:backdrop-blur-xl xl:px-4 xl:pt-16 shadow-[-10px_0_30px_rgba(0,0,0,0.5)]"
          >
            {state.tab === "method" ? (
              <MethodView />
            ) : state.tab === "lab" ? (
              <LabView />
            ) : (
              <>
                <CalendarPanel key={state.regionId} />
                <Counters />
              </>
            )}
            <div className="hidden pt-1 xl:block">
              <Credits />
            </div>
          </aside>
        )}

        <div className="flex justify-center px-3 pt-1 pb-4 xl:hidden">
          <Credits />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </I18nProvider>
  );
}
