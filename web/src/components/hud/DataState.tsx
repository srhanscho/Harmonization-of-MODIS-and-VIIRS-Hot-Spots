"use client";

import { DatabaseZap, Loader2, TriangleAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { LoadResult } from "@/lib/types";

/** Explicit loading / missing / error states. Never renders placeholder numbers. */
export function DataState({ result, file }: { result: LoadResult<unknown> | null; file: string }) {
  const { t } = useI18n();
  if (result == null)
    return (
      <div className="flex items-center gap-2 p-4 text-[13px] text-[var(--text-2)]" role="status">
        <Loader2 className="size-4 animate-spin text-[var(--text-3)]" aria-hidden /> {t("loading")}
      </div>
    );
  if (result.status === "missing")
    return (
      <div className="flex items-start gap-3 p-4 text-[13px] text-[var(--text-1)]" role="status">
        <DatabaseZap className="mt-0.5 size-4 shrink-0 text-[var(--text-3)]" aria-hidden />
        <div>
          <p className="font-medium">{t("notGenerated")}</p>
          <p className="mt-1 text-xs break-all text-[var(--text-3)]">
            {t("notGeneratedHint")} <code className="font-mono text-[11px] text-[var(--text-2)]">public{file}</code>
          </p>
        </div>
      </div>
    );
  if (result.status === "error")
    return (
      <div className="flex items-start gap-3 p-4 text-[13px] text-[var(--alert)]" role="alert">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">{t("loadError")}</p>
          <p className="mt-1 font-mono text-[11px] opacity-80">{result.message}</p>
        </div>
      </div>
    );
  return null;
}
