"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, Search, X } from "lucide-react";
import { DataState } from "./DataState";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import type { Region } from "@/lib/types";

const COUNTRY_NAMES: Record<string, string> = { CO: "Colombia", AR: "Argentina" };

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
    label: "Chilecito · Jul 2026",
    find: (rs) => byIdOrName(/CHILECITO/i, /chilecito/i)(rs) ?? rs.find((r) => /la rioja/i.test(r.name)),
    year: 2026,
    month: 7,
  },
  { label: "Vichada (CO-VID)", find: byIdOrName(/^CO-VID$/, /^vichada$/i) },
  { label: "Sierra Nevada de Santa Marta", find: byIdOrName(/^DEMO-SNSM$/, /sierra nevada/i) },
];

const isNational = (r: Region) => r.id === r.country;

/** Case- and accent-insensitive key for the place search. */
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Most specific (smallest bbox) region containing the point. */
export function regionAt(regions: Region[], lat: number, lon: number): Region | undefined {
  return regions
    .filter((r) => lon >= r.bbox[0] && lon <= r.bbox[2] && lat >= r.bbox[1] && lat <= r.bbox[3])
    .sort((a, b) => (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]) - (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]))[0];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-[var(--line)] px-4 py-3.5 first:border-t-0">
      <h2 className="t-label">{title}</h2>
      {children}
    </section>
  );
}

export function RegionPicker({ collapsible = false }: { collapsible?: boolean }) {
  const { state, dispatch, regions } = useStore();
  const { t } = useI18n();
  const list = useMemo(() => (regions?.status === "ok" ? regions.data : []), [regions]);
  const countries = useMemo(() => [...new Set(list.map((r) => r.country))].sort(), [list]);
  const current = list.find((r) => r.id === state.regionId);
  const [country, setCountry] = useState<string>("");
  const activeCountry = country || current?.country || countries[0] || "";
  const admins = list.filter((r) => r.country === activeCountry && !isNational(r)).sort((a, b) => a.name.localeCompare(b.name));
  const national = list.find((r) => r.country === activeCountry && isNational(r));
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState<{ view: string; open: boolean } | null>(null);
  // Expanded at home, folded to the search field once a region is open (unless the user chose).
  const expanded = !collapsible || (manual && manual.view === state.view ? manual.open : state.view === "globe");
  const q = fold(query.trim());
  const matches = q
    ? list
        .filter((r) => fold(r.name).includes(q) || fold(r.id).includes(q) || fold(COUNTRY_NAMES[r.country] ?? "").includes(q))
        .sort((a, b) => Number(isNational(b)) - Number(isNational(a)) || a.name.localeCompare(b.name))
        .slice(0, 7)
    : [];

  const select = (id: string, year?: number, month?: number) => dispatch({ type: "selectRegion", regionId: id, year, month });

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
    <nav aria-label={t("region")} className="panel pointer-events-auto flex flex-col">
      <div className="relative flex items-center gap-1.5 px-3 pt-3 pb-2.5">
        <Search className="pointer-events-none absolute top-1/2 left-5.5 size-4 -translate-y-[calc(50%-1px)] text-[var(--text-3)]" aria-hidden />
        <input
          type="search"
          className="field !h-9 min-w-0 flex-1 !pl-8 [&::-webkit-search-cancel-button]:hidden"
          placeholder={t("searchPlace")}
          aria-label={t("searchPlace")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches[0]) {
              select(matches[0].id);
              setQuery("");
            }
            if (e.key === "Escape") setQuery("");
          }}
        />
        {query && (
          <button
            className={`btn btn-quiet btn-icon absolute top-1/2 !size-7 -translate-y-[calc(50%-1px)] ${collapsible ? "right-[3.25rem]" : "right-4"}`}
            aria-label={t("clear")}
            onClick={() => setQuery("")}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
        {collapsible && (
          <button
            className="btn btn-quiet btn-icon !size-9 shrink-0"
            aria-expanded={expanded}
            aria-label={t("region")}
            onClick={() => setManual({ view: state.view, open: !expanded })}
          >
            <ChevronDown className={`size-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} aria-hidden />
          </button>
        )}
      </div>
      {q && (
        <ul className="-mt-1 flex flex-col border-b border-[var(--line)] px-2 pb-2" aria-label={t("searchResults")}>
          {matches.length === 0 ? (
            <li className="px-2 py-1.5 text-[13px] text-[var(--text-3)]">{t("noMatches")}</li>
          ) : (
            matches.map((r) => (
              <li key={r.id}>
                <button
                  className="flex h-8 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-[13px] text-[var(--text-1)] hover:bg-[var(--sci-soft)]"
                  onClick={() => {
                    select(r.id);
                    setQuery("");
                  }}
                >
                  <span className="truncate">{r.name}</span>
                  <span className="t-caption shrink-0">{isNational(r) ? t("country") : COUNTRY_NAMES[r.country] ?? r.country}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      {expanded && (
      <>
      <Section title={t("demoCases")}>
        <ul className="-mx-2 flex flex-col">
          {DEMOS.map((d) => {
            const r = d.find(list);
            const active = !!r && state.regionId === r.id;
            return (
              <li key={d.label}>
                <button
                  className={`group flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
                    active ? "bg-[var(--ink-3)] text-[var(--text-1)]" : "text-[var(--text-2)] hover:bg-[var(--ink-2)] hover:text-[var(--text-1)]"
                  }`}
                  disabled={!r}
                  title={r ? r.id : t("notGenerated")}
                  aria-pressed={active}
                  onClick={() => r && select(r.id, d.year, d.month)}
                >
                  <span
                    className={`size-1.5 shrink-0 rounded-full transition-colors ${active ? "bg-[var(--sci)]" : "bg-[var(--line-strong)] group-hover:bg-[var(--text-3)]"}`}
                    aria-hidden
                  />
                  <span className="truncate">{d.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={t("region")}>
        {regions?.status !== "ok" ? (
          <DataState result={regions} file="/data/regions.json" />
        ) : (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className="t-caption">{t("country")}</span>
              <select className="field" value={activeCountry} onChange={(e) => setCountry(e.target.value)}>
                {countries.map((c) => (
                  <option key={c} value={c}>
                    {COUNTRY_NAMES[c] ?? c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-caption">{t("adminRegion")}</span>
              <select
                className="field"
                value={current && current.country === activeCountry ? current.id : ""}
                onChange={(e) => e.target.value && select(e.target.value)}
              >
                <option value="">—</option>
                {national && <option value={national.id}>{t("wholeCountry")} ({national.name})</option>}
                {admins.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </Section>

      <Section title={t("latLon")}>
        <form onSubmit={findByCoords} className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <input
              className="field num min-w-0"
              inputMode="decimal"
              placeholder={t("lat")}
              aria-label={t("lat")}
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
            <input
              className="field num min-w-0"
              inputMode="decimal"
              placeholder={t("lon")}
              aria-label={t("lon")}
              value={lon}
              onChange={(e) => setLon(e.target.value)}
            />
            <button type="submit" className="btn btn-icon shrink-0" aria-label={t("go")}>
              <ArrowRight className="size-4" aria-hidden />
            </button>
          </div>
          {msg && (
            <p className="text-xs text-[var(--alert)]" role="status">
              {msg}
            </p>
          )}
        </form>
      </Section>
      </>
      )}
    </nav>
  );
}
