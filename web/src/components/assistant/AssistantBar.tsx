"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useStore, type ViewPatch } from "@/lib/store";

interface Turn {
  role: "user" | "assistant";
  content: string;
  tools?: { name: string; input: unknown }[];
  patch?: ViewPatch;
  error?: boolean;
}

export function AssistantBar() {
  const { t } = useI18n();
  const { dispatch } = useStore();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/assistant")
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((j: { available?: boolean }) => setAvailable(Boolean(j.available)))
      .catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (!text || busy || !available) return;
    const next: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(next);
    setQ("");
    setOpen(true);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.filter((x) => !x.error && x.content).map(({ role, content }) => ({ role, content })),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        if (j.error === "unavailable") setAvailable(false);
        setTurns((ts) => [...ts, { role: "assistant", content: t("assistantError"), error: true }]);
      } else {
        if (j.patch) dispatch({ type: "applyPatch", patch: j.patch as ViewPatch });
        setTurns((ts) => [
          ...ts,
          { role: "assistant", content: j.reply || t("assistantError"), tools: j.tools, patch: j.patch, error: !j.reply },
        ]);
      }
    } catch {
      setTurns((ts) => [...ts, { role: "assistant", content: t("assistantError"), error: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pointer-events-auto mx-auto flex w-full max-w-2xl flex-col gap-2">
      {open && turns.length > 0 && (
        <div className="panel panel-solid max-h-[40vh] overflow-y-auto p-4 text-[13px]" aria-live="polite">
          <div className="mb-2 flex items-center justify-between">
            <span className="t-label">{t("aiGenerated")}</span>
            <button className="btn btn-quiet btn-icon !size-7" aria-label={t("close")} onClick={() => setOpen(false)}>
              <ChevronDown className="size-4" />
            </button>
          </div>
          <ul className="flex flex-col gap-3">
            {turns.map((turn, i) => (
              <li key={i} className={turn.role === "user" ? "self-end text-right" : ""}>
                {turn.role === "user" ? (
                  <span className="inline-block rounded-lg bg-[var(--ink-3)] px-3 py-1.5 text-left text-[var(--text-1)]">{turn.content}</span>
                ) : (
                  <div className={`border-l border-[var(--line-strong)] pl-3 ${turn.error ? "text-[var(--alert)]" : "text-[var(--text-1)]"}`}>
                    <p className="t-caption mb-1">{t("aiGenerated")}</p>
                    <p className="leading-relaxed whitespace-pre-wrap">{turn.content}</p>
                    {turn.tools && turn.tools.length > 0 && (
                      <details className="mt-2 text-xs text-[var(--text-3)]">
                        <summary className="cursor-pointer hover:text-[var(--text-2)]">
                          {t("toolsUsed")} ({turn.tools.length}){turn.patch ? ` · ${t("viewApplied")}` : ""}
                        </summary>
                        <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                          {turn.tools.map((tool, k) => (
                            <li key={k} className="break-all">
                              {tool.name}({JSON.stringify(tool.input)})
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
              </li>
            ))}
            {busy && (
              <li className="flex items-center gap-2 text-[var(--text-3)]">
                <Loader2 className="size-4 animate-spin" aria-hidden /> {t("thinking")}
              </li>
            )}
          </ul>
          <div ref={endRef} />
        </div>
      )}
      <form
        onSubmit={ask}
        className="panel flex h-11 items-center gap-2 !rounded-full pr-1.5 pl-4 transition-colors duration-150 focus-within:border-[var(--sci)]"
      >
        <input
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-1)] placeholder:text-[var(--text-3)] focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed"
          placeholder={available === false ? t("assistantUnavailable") : t("askPlaceholder")}
          aria-label={t("askPlaceholder")}
          value={q}
          disabled={available === false}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => turns.length && setOpen(true)}
        />
        <button
          type="submit"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--sci)] text-white transition-opacity duration-150 hover:opacity-90 disabled:bg-[var(--ink-3)] disabled:text-[var(--text-3)]"
          disabled={!available || busy || !q.trim()}
          aria-label={t("ask")}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
        </button>
      </form>
    </div>
  );
}
