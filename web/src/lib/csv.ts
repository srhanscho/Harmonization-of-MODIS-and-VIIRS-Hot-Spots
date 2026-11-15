import type { MonthlyRow } from "./types";

const COLUMNS = [
  "year",
  "month",
  "raw_modis",
  "raw_viirs",
  "harmonized",
  "harmonized_p5",
  "harmonized_p95",
  "source",
  "factor",
  "regime",
] as const;

function cell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** CSV of the monthly table exactly as published (nulls are left empty, never 0). */
export function monthlyToCsv(regionId: string, rows: MonthlyRow[]): string {
  const sorted = [...rows].sort((a, b) => a.year - b.year || a.month - b.month);
  const lines = [["region_id", ...COLUMNS].join(",")];
  for (const r of sorted) lines.push([cell(regionId), ...COLUMNS.map((c) => cell(r[c]))].join(","));
  return lines.join("\n") + "\n";
}

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
