"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, Crosshair, MapPin, Search, X } from "lucide-react";
import { DataState } from "./DataState";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import type { Region } from "@/lib/types";

const COUNTRY_NAMES: Record<string, string> = { CO: "Colombia", AR: "Argentina" };
const COUNTRY_FLAGS: Record<string, string> = { CO: "🇨🇴", AR: "🇦🇷" };

interface Demo {
  label: string;
  find: (regions: Region[]) => Region | undefined;
  year?: number;
  month?: number;
}

const byIdOrName = (id: RegExp, name: RegExp) => (rs: Region[]) =>
  rs.find((r) => id.test(r.id)) ?? rs.find((r) => name.test(r.name));

export const DEMOS: Demo[] = [
  {
    label: "Chilecito - Jul 2026",
    find: (rs) => byIdOrName(/CHILECITO/i, /chilecito/i)(rs) ?? rs.find((r) => /la rioja/i.test(r.name)),
    year: 2026,
    month: 7,
  },
  { label: "Vichada (CO-VID)", find: byIdOrName(/^CO-VID$/, /^vichada$/i) },
  { label: "Sierra Nevada de Santa Marta", find: byIdOrName(/^DEMO-SNSM$/, /sierra nevada/i) },
];

const isNational = (r: Region) => r.id === r.country;

/** Case- and accent-insensitive key for the place search. */
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Most specific (smallest bbox) region containing the point. */
export function regionAt(regions: Region[], lat: number, lon: number): Region | undefined {
  return regions
    .filter((r) => lon >= r.bbox[0] && lon <= r.bbox[2] && lat >= r.bbox[1] && lat <= r.bbox[3])
    .sort((a, b) => (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]) - (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]))[0];
}

/**
 * Place search card + (optional) `between` slot + the demo/region/coordinates options card.
 * `between` renders as its own card directly under the search field (used for the date picker).
 */
export function RegionPicker({ collapsible = false, between }: { collapsible?: boolean; between?: ReactNode }) {
  const { state, dispatch, regions } = useStore();
  const { t } = useI18n();
  const list = useMemo(() => (regions?.status === "ok" ? regions.data : []), [regions]);
  const countries = useMemo(() => [...new Set(list.map((r) => r.country))].sort(), [list]);
  // `lastRegion` is the one last opened (kept after leaving, so the country dropdown doesn't jump);
  // `current` is only set while a region is actually open, so demos / dropdown reflect "no region".
  const lastRegion = list.find((r) => r.id === state.regionId);
  const current = state.view === "region" ? lastRegion : undefined;
  const [country, setCountry] = useState<string>("");
  const activeCountry = country || lastRegion?.country || countries[0] || "";
  const admins = list.filter((r) => r.country === activeCountry && !isNational(r)).sort((a, b) => a.name.localeCompare(b.name));
  const national = list.find((r) => r.country === activeCountry && isNational(r));
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Starts expanded and only folds when the user collapses it: opening a region must not hide
  // the demo / country / province selectors, or there would be no visible way out of it.
  const [collapsed, setCollapsed] = useState(false);
  const expanded = !collapsible || !collapsed;
  const q = fold(query.trim());
  const matches = q
    ? list
        .filter((r) => fold(r.name).includes(q) || fold(r.id).includes(q) || fold(COUNTRY_NAMES[r.country] ?? "").includes(q))
        .sort((a, b) => Number(isNational(b)) - Number(isNational(a)) || a.name.localeCompare(b.name))
        .slice(0, 7)
    : [];

  const select = (id: string, year?: number, month?: number) => dispatch({ type: "selectRegion", regionId: id, year, month });
  const exit = () => dispatch({ type: "backToGlobe" });

  const findByCoords = (e: React.FormEvent) => {
    e.preventDefault();
    const la = Number(lat);
    const lo = Number(lon);
    if (lat.trim() === "" || lon.trim() === "" || !Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      setMsg(t("invalidCoords"));
      return;
    }
    const r = regionAt(list, la, lo);
    if (!r) setMsg(t("noRegionAtPoint"));
    else {
      setMsg(null);
      select(r.id);
    }
  };

  return (
    <div className="pointer-events-auto flex flex-col gap-3 text-xs text-white">
    <nav
      aria-label={t("region")}
      className="glass-panel flex shrink-0 flex-col space-y-3.5 rounded-2xl p-3.5"
    >
      {/* Search Bar with Collapse Icon */}
      <div className="relative flex items-center rounded-xl border border-cyan-500/40 bg-[#071329]/80 px-3 py-2 text-slate-300 shadow-inner focus-within:border-cyan-400 focus-within:shadow-[0_0_12px_rgba(6,182,212,0.3)] transition">
        <Search className="mr-2 size-3.5 shrink-0 text-slate-400" aria-hidden />
        <input
          type="search"
          className="w-full border-none bg-transparent p-0 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-0 [&::-webkit-search-cancel-button]:hidden"
          placeholder={t("searchPlace")}
          aria-label={t("searchPlace")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches[0]) {
              e.preventDefault();
              select(matches[0].id);
              setQuery("");
            }
          }}
        />
        {query && (
          <button
            className="mr-1 shrink-0 text-slate-400 transition hover:text-white"
            aria-label={t("clear")}
            onClick={() => setQuery("")}
          >
            <X className="size-3.5" />
          </button>
        )}
        {collapsible && (
          <button
            className="ml-1 shrink-0 text-slate-400 transition hover:text-white"
            aria-expanded={expanded}
            aria-label={t("region")}
            onClick={() => setCollapsed((v) => !v)}
          >
            <ChevronDown className={`size-4 transition-transform duration-200 ${expanded ? "rotate-180 text-cyan-400" : ""}`} aria-hidden />
          </button>
        )}
      </div>

      {current && !q && (
        <div className="-mt-0.5 flex items-center justify-between gap-2 px-0.5">
          <span className="min-w-0 truncate text-[11px] text-slate-400">
            <span className="font-semibold text-white">{current.name}</span>
          </span>
          <button type="button" className="btn btn-quiet !h-7 shrink-0 !px-2 !text-[11.5px]" onClick={exit}>
            <ArrowLeft className="size-3.5" aria-hidden /> {t("backToGlobe")}
          </button>
        </div>
      )}

      {q && (
        <ul className="-mt-1.5 flex flex-col gap-1 rounded-xl border border-cyan-500/30 bg-[#071329]/95 p-1.5 shadow-xl backdrop-blur-xl" aria-label={t("searchResults")}>
          {matches.length === 0 ? (
            <li className="px-2 py-1.5 text-center text-xs text-slate-400 italic">{t("noMatches")}</li>
          ) : (
            matches.map((r) => (
              <li key={r.id}>
                <button
                  className="flex h-8 w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-xs text-slate-200 transition hover:bg-blue-900/40 hover:text-white"
                  onClick={() => {
                    select(r.id);
                    setQuery("");
                  }}
                >
                  <span className="truncate">{r.name}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">
                    {COUNTRY_FLAGS[r.country] ? `${COUNTRY_FLAGS[r.country]} ` : ""}{isNational(r) ? t("country") : COUNTRY_NAMES[r.country] ?? r.country}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </nav>

    {between}

    {expanded && (
      <div className="glass-panel shrink-0 space-y-3.5 rounded-2xl p-3.5">
        <>
          {/* Casos Demo Section */}
          <div className="space-y-2">
            <h3 className="px-1 text-[11px] font-medium text-slate-400">{t("demoCases")}</h3>
            <div className="space-y-1">
              {DEMOS.map((d) => {
                const r = d.find(list);
                const active = !!r && current?.id === r.id;
                return (
                  <button
                    key={d.label}
                    className={`group flex w-full items-center space-x-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      active
                        ? "border border-blue-500/40 bg-blue-900/40 font-medium text-white shadow-[0_0_10px_rgba(59,130,246,0.25)]"
                        : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                    }`}
                    disabled={!r}
                    title={r ? r.id : t("notGenerated")}
                    aria-pressed={active}
                    onClick={() => r && (active ? exit() : select(r.id, d.year, d.month))}
                  >
                    <span className={`h-3.5 w-1 shrink-0 rounded-full ${active ? "bg-blue-500" : "bg-transparent"}`} />
                    <span
                      className={`size-2 shrink-0 rounded-full ${
                        active ? "bg-blue-400 shadow-[0_0_6px_#60a5fa]" : "border border-slate-500"
                      }`}
                      aria-hidden
                    />
                    <span className="truncate">{d.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Region Filters Section */}
          <div className="space-y-3 border-t border-slate-700/60 pt-2.5">
            <div className="flex items-center space-x-1.5 font-medium text-cyan-400">
              <MapPin className="size-3.5" aria-hidden />
              <span className="font-semibold text-white">{t("region")}</span>
            </div>

            {regions?.status !== "ok" ? (
              <DataState result={regions} file="/data/regions.json" />
            ) : (
              <>
                <div className="space-y-1">
                  <label className="block px-0.5 text-[11px] text-slate-400">{t("country")}</label>
                  <div className="relative flex items-center rounded-xl border border-slate-600/70 bg-[#081730]/90 px-3 py-1.5 text-white shadow-inner transition focus-within:border-cyan-400/70">
                    <select
                      className="w-full cursor-pointer appearance-none bg-transparent pr-6 text-xs font-medium text-white outline-none"
                      value={activeCountry}
                      onChange={(e) => setCountry(e.target.value)}
                    >
                      {countries.map((c) => (
                        <option key={c} value={c} className="bg-slate-900 text-white">
                          {COUNTRY_FLAGS[c] ? `${COUNTRY_FLAGS[c]} ` : ""}{COUNTRY_NAMES[c] ?? c}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 size-3.5 text-slate-400" aria-hidden />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block px-0.5 text-[11px] text-slate-400">{t("adminRegion")}</label>
                  <div className="relative flex items-center rounded-xl border border-slate-600/70 bg-[#081730]/90 px-3 py-1.5 text-slate-300 shadow-inner transition focus-within:border-cyan-400/70">
                    <select
                      className="w-full cursor-pointer appearance-none bg-transparent pr-6 text-xs text-white outline-none"
                      value={current && current.country === activeCountry ? current.id : ""}
                      onChange={(e) => (e.target.value ? select(e.target.value) : exit())}
                    >
                      <option value="" className="bg-slate-900 text-slate-400">—</option>
                      {national && (
                        <option value={national.id} className="bg-slate-900 text-white">
                          {t("wholeCountry")} ({national.name})
                        </option>
                      )}
                      {admins.map((r) => (
                        <option key={r.id} value={r.id} className="bg-slate-900 text-white">
                          {r.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 size-3.5 text-slate-400" aria-hidden />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Coordinates Search Section */}
          <div className="space-y-2 border-t border-slate-700/60 pt-2.5">
            <div className="flex items-center space-x-1.5 text-slate-300">
              <Crosshair className="size-3.5 text-cyan-400" aria-hidden />
              <span className="text-[11px] font-medium text-slate-200">{t("latLon")}</span>
            </div>
            <form onSubmit={findByCoords} className="flex flex-col gap-1.5">
              <div className="flex items-center space-x-2">
                <div className="flex-1 rounded-xl border border-slate-600/70 bg-[#081730]/90 px-3 py-1.5 shadow-inner transition focus-within:border-cyan-400/70">
                  <input
                    className="w-full border-none bg-transparent p-0 font-mono text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-0"
                    inputMode="decimal"
                    placeholder={t("lat")}
                    aria-label={t("lat")}
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                  />
                </div>
                <div className="flex-1 rounded-xl border border-slate-600/70 bg-[#081730]/90 px-3 py-1.5 shadow-inner transition focus-within:border-cyan-400/70">
                  <input
                    className="w-full border-none bg-transparent p-0 font-mono text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-0"
                    inputMode="decimal"
                    placeholder={t("lon")}
                    aria-label={t("lon")}
                    value={lon}
                    onChange={(e) => setLon(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-[0_0_10px_rgba(37,99,235,0.6)] transition hover:bg-blue-500 hover:shadow-[0_0_14px_rgba(56,189,248,0.8)] active:scale-95"
                  title={t("go")}
                  aria-label={t("go")}
                >
                  <ArrowRight className="size-4" aria-hidden />
                </button>
              </div>
              {msg && (
                <p className="rounded-lg border border-red-500/30 bg-red-950/60 px-2.5 py-1 text-xs text-red-300" role="status">
                  {msg}
                </p>
              )}
            </form>
          </div>
        </>
      </div>
    )}
    </div>
  );
}
