"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";
import { useI18n, type DictKey } from "@/lib/i18n";

/**
 * Small ⓘ button with a plain-language definition. Click / tap / Enter toggles it (never
 * hover-only); Escape, outside click or scroll closes it. The popover is position: fixed so it
 * escapes scrolling panels.
 */
export function InfoTip({ k, label }: { k: DictKey; label?: string }) {
  const { t } = useI18n();
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "pointerdown" && (pop.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return;
      setPos(null);
      if (e.type === "keydown") btn.current?.focus();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos]);

  const toggle = () => {
    if (pos) return setPos(null);
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const W = 264;
    const left = Math.max(8, Math.min(window.innerWidth - W - 8, r.left + r.width / 2 - W / 2));
    const up = r.bottom + 160 > window.innerHeight;
    setPos({ left, top: up ? r.top - 6 : r.bottom + 6, up });
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[var(--text-3)] align-middle transition-colors duration-150 hover:bg-[var(--sci-soft)] hover:text-[var(--sci)] aria-expanded:bg-[var(--sci-soft)] aria-expanded:text-[var(--sci)]"
        aria-label={label ? `${t("info")} ${label}` : t("info")}
        aria-expanded={!!pos}
        aria-controls={pos ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      {pos && (
        <div
          ref={pop}
          id={id}
          role="note"
          className="panel fixed z-[80] w-[264px] p-3 text-left text-[12.5px] leading-snug font-normal tracking-normal text-[var(--text-2)] normal-case"
          style={{ left: pos.left, top: pos.top, transform: pos.up ? "translateY(-100%)" : undefined }}
        >
          {t(k)}
        </div>
      )}
    </>
  );
}
