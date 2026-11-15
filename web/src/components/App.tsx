"use client";

import dynamic from "next/dynamic";
import { useState, type CSSProperties } from "react";
import { ChevronDown, MessageSquareText, Search, X } from "lucide-react";
import { AssistantBar } from "./assistant/AssistantBar";
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
      className="pointer-events-none absolute right-3 z-20 flex flex-col items-end gap-2"
      style={{ bottom: "calc(var(--map-bottom, 0px) + 12px)" }}
    >
      {open && (
        <div className="pointer-events-auto w-[min(28rem,calc(100vw-24px))]">
          <AssistantBar />
        </div>
      )}
      <button
        className={`pointer-events-auto btn !h-10 !rounded-full !px-4 shadow-[var(--shadow-float)] ${open ? "" : "btn-primary"}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X className="size-4" aria-hidden /> : <MessageSquareText className="size-4" aria-hidden />}
        {open ? t("close") : t("askShort")}
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
      <div className={`relative z-30 shrink-0 ${USE_FIXTURE ? "mt-7" : ""}`}>
        <Header />
      </div>

      <div className="flex flex-1 flex-col xl:min-h-0 xl:flex-row">
        {/* ---------- Map column: always visible ---------- */}
        <section
          style={vars}
          className="relative h-[55vh] min-h-[20rem] shrink-0 overflow-hidden [--tl-h:0px] md:h-[52vh] md:[--tl-h:72px] xl:h-auto xl:min-h-0 xl:flex-1"
        >
          <GlobeMap />

          {/* Desktop: compact place card over the map. */}
          <div className="absolute top-3 left-3 z-10 hidden max-h-[calc(100%-1.5rem-var(--map-bottom))] w-[264px] overflow-y-auto rounded-[10px] xl:block">
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
            <div className="absolute bottom-2 left-1/2 z-10 hidden -translate-x-1/2 xl:block">
              <Credits />
            </div>
          )}
        </section>

        {/* ---------- Below the map (phones / tablets) ---------- */}
        <div className="flex flex-col gap-3 px-3 pt-3 xl:hidden">
          <button
            className="panel flex h-11 items-center gap-2 px-3.5 text-left text-[13px] font-medium text-[var(--text-1)]"
            aria-expanded={placesOpen}
            onClick={() => setPlacesOpen((v) => !v)}
          >
            <Search className="size-4 text-[var(--text-3)]" aria-hidden />
            <span className="flex-1">{t("findPlace")}</span>
            <ChevronDown className={`size-4 text-[var(--text-3)] transition-transform duration-200 ${placesOpen ? "rotate-180" : ""}`} aria-hidden />
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
            className="flex flex-col gap-3 px-3 pt-3 pb-4 xl:w-[42%] xl:max-w-[860px] xl:min-w-[540px] xl:shrink-0 xl:overflow-y-auto xl:border-l xl:border-[var(--line)] xl:px-4 xl:pt-4"
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
