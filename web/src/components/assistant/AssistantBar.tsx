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

export function AstroBotIcon({ className = "size-11" }: { className?: string }) {
  return (
    <svg
      viewBox="4 2 56 58"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        {/* 3D Composite Titanium-White EVA Helmet Shell */}
        <radialGradient id="eva-shell" cx="36%" cy="24%" r="72%" fx="32%" fy="20%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="38%" stopColor="#f1f5f9" />
          <stop offset="72%" stopColor="#cbd5e1" />
          <stop offset="92%" stopColor="#64748b" />
          <stop offset="100%" stopColor="#334155" />
        </radialGradient>

        {/* Upper Sunshield Shroud Bezel */}
        <linearGradient id="eva-shroud" x1="14" y1="6" x2="50" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#e2e8f0" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>

        {/* Anodized Gunmetal / Titanium Hardware & Neck Ring */}
        <linearGradient id="eva-metal" x1="14" y1="42" x2="50" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#475569" />
          <stop offset="28%" stopColor="#94a3b8" />
          <stop offset="55%" stopColor="#1e293b" />
          <stop offset="85%" stopColor="#334155" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>

        {/* Hard Upper Torso (HUT) Suit Armor */}
        <linearGradient id="eva-suit" x1="12" y1="46" x2="52" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="50%" stopColor="#cbd5e1" />
          <stop offset="100%" stopColor="#475569" />
        </linearGradient>

        {/* Dichroic Space Visor Base (Deep Obsidian -> Sapphire -> Orbital Cyan Limb) */}
        <linearGradient id="eva-visor" x1="22" y1="15" x2="40" y2="43" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#020617" />
          <stop offset="42%" stopColor="#06152d" />
          <stop offset="76%" stopColor="#0c3666" />
          <stop offset="93%" stopColor="#0284c7" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>

        {/* Gold/Amber Solar Dichroic Coating Glint (Upper-Left Visor) */}
        <radialGradient id="eva-gold-glint" cx="28%" cy="26%" r="52%">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.55" />
          <stop offset="45%" stopColor="#f97316" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </radialGradient>

        {/* Earth Atmosphere Horizon Reflection on Visor */}
        <linearGradient id="eva-horizon" x1="16" y1="36" x2="48" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0" />
          <stop offset="25%" stopColor="#38bdf8" stopOpacity="0.65" />
          <stop offset="50%" stopColor="#e0f2fe" stopOpacity="0.95" />
          <stop offset="75%" stopColor="#38bdf8" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Subtle Orbital Backlight */}
      <circle cx="32" cy="30" r="24" fill="#0ea5e9" fillOpacity="0.14" />

      {/* Hard Upper Torso (Shoulders & Suit Yoke) */}
      <path
        d="M10 54C11.2 48.8 18.5 45.5 32 45.5C45.5 45.5 52.8 48.8 54 54L54.8 57.2C55 58.2 54.2 59 53.2 59H10.8C9.8 59 9 58.2 9.2 57.2L10 54Z"
        fill="url(#eva-suit)"
        stroke="#475569"
        strokeWidth="1"
      />
      {/* Shoulder Seam Lines */}
      <path d="M15 48.5L13 58.5M49 48.5L51 58.5" stroke="#64748b" strokeWidth="1" strokeLinecap="round" />

      {/* Chest Display & Control Module (DCM) */}
      <rect x="23.5" y="50.5" width="17" height="6.5" rx="1.8" fill="#0f172a" stroke="#475569" strokeWidth="1" />
      <rect x="25.5" y="52.2" width="6" height="3" rx="0.8" fill="#0284c7" fillOpacity="0.35" stroke="#38bdf8" strokeWidth="0.7" />
      <circle cx="34.5" cy="53.7" r="1.1" fill="#38bdf8" />
      <circle cx="37.8" cy="53.7" r="1.1" fill="#f97316" />

      {/* Anodized Titanium Neck Disconnect Ring */}
      <path
        d="M17.5 43.5C17.5 41.8 24 40.5 32 40.5C40 40.5 46.5 41.8 46.5 43.5L47.8 46.8C47.8 48.6 40.8 49.8 32 49.8C23.2 49.8 16.2 48.6 16.2 46.8L17.5 43.5Z"
        fill="url(#eva-metal)"
        stroke="#1e293b"
        strokeWidth="1"
      />
      {/* Neck Ring Locking Latches */}
      <rect x="20" y="45" width="3.5" height="2" rx="0.6" fill="#cbd5e1" />
      <rect x="40.5" y="45" width="3.5" height="2" rx="0.6" fill="#cbd5e1" />
      <rect x="29.5" y="45.3" width="5" height="1.6" rx="0.5" fill="#64748b" />

      {/* Lateral EVA Comm & Headlamp Pods */}
      <path
        d="M9.5 23.5C9.5 22.1 10.6 21 12 21H13.5V34.5H12C10.6 34.5 9.5 33.4 9.5 32V23.5Z"
        fill="url(#eva-metal)"
        stroke="#475569"
        strokeWidth="0.9"
      />
      <circle cx="11.2" cy="24.8" r="1.2" fill="#e0f2fe" />
      <rect x="10.6" y="28" width="1.4" height="4" rx="0.7" fill="#38bdf8" />

      <path
        d="M54.5 23.5C54.5 22.1 53.4 21 52 21H50.5V34.5H52C53.4 34.5 54.5 33.4 54.5 32V23.5Z"
        fill="url(#eva-metal)"
        stroke="#475569"
        strokeWidth="0.9"
      />
      <circle cx="52.8" cy="24.8" r="1.2" fill="#e0f2fe" />
      <rect x="52" y="28" width="1.4" height="4" rx="0.7" fill="#38bdf8" />

      {/* Main 3D EVA Helmet Pressure Shell */}
      <path
        d="M12 26.5C12 14.2 20.5 6 32 6C43.5 6 52 14.2 52 26.5C52 36.2 46.2 44.5 32 44.5C17.8 44.5 12 36.2 12 26.5Z"
        fill="url(#eva-shell)"
        stroke="#64748b"
        strokeWidth="1.1"
      />

      {/* Upper Protective Sunshield Shroud (LEVA) */}
      <path
        d="M14.2 20.5C15.8 11.8 22.8 6.8 32 6.8C41.2 6.8 48.2 11.8 49.8 20.5C45.2 17.4 39 16 32 16C25 16 18.8 17.4 14.2 20.5Z"
        fill="url(#eva-shroud)"
        stroke="#94a3b8"
        strokeWidth="0.9"
      />
      {/* Recessed Forehead Telemetry Slot */}
      <rect x="27" y="10.2" width="10" height="2.2" rx="1.1" fill="#1e293b" stroke="#94a3b8" strokeWidth="0.6" />
      <rect x="28.5" y="10.8" width="7" height="1" rx="0.5" fill="#38bdf8" />

      {/* Visor Recessed Frame Bezel */}
      <path
        d="M14.5 24.5C14.5 18.2 21.8 15.2 32 15.2C42.2 15.2 49.5 18.2 49.5 24.5C49.5 34.2 43.8 41.2 32 41.2C20.2 41.2 14.5 34.2 14.5 24.5Z"
        fill="#0f172a"
        stroke="#475569"
        strokeWidth="1.2"
      />

      {/* Panoramic Curved Space Visor Glass */}
      <path
        d="M15.6 24.8C15.6 19.1 22.4 16.3 32 16.3C41.6 16.3 48.4 19.1 48.4 24.8C48.4 33.6 43.1 40 32 40C20.9 40 15.6 33.6 15.6 24.8Z"
        fill="url(#eva-visor)"
      />
      {/* Dichroic Solar Gold Coating Overlay */}
      <path
        d="M15.6 24.8C15.6 19.1 22.4 16.3 32 16.3C41.6 16.3 48.4 19.1 48.4 24.8C48.4 33.6 43.1 40 32 40C20.9 40 15.6 33.6 15.6 24.8Z"
        fill="url(#eva-gold-glint)"
      />

      {/* Reflected Earth Curvature Horizon Line on Visor */}
      <path
        d="M17.2 33.5C21.5 36.8 26.5 38.3 32 38.3C37.5 38.3 42.5 36.8 46.8 33.5"
        stroke="url(#eva-horizon)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />

      {/* Internal AI Optical HUD Projection (Sleek Aerospace Telemetry Reticle) */}
      <g opacity="0.92">
        {/* Left & Right Optical HUD Brackets */}
        <path
          d="M22.5 24.5C21.2 25.8 21.2 28.2 22.5 29.5M41.5 24.5C42.8 25.8 42.8 28.2 41.5 29.5"
          stroke="#38bdf8"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        {/* Dual Precision AI Core Optics */}
        <ellipse cx="26.2" cy="27" rx="2.8" ry="1.8" fill="#38bdf8" fillOpacity="0.25" stroke="#7dd3fc" strokeWidth="1.2" />
        <circle cx="26.2" cy="27" r="0.9" fill="#e0f2fe" />
        <ellipse cx="37.8" cy="27" rx="2.8" ry="1.8" fill="#38bdf8" fillOpacity="0.25" stroke="#7dd3fc" strokeWidth="1.2" />
        <circle cx="37.8" cy="27" r="0.9" fill="#e0f2fe" />
        {/* Center Telemetry Bridge */}
        <line x1="30.5" y1="27" x2="33.5" y2="27" stroke="#38bdf8" strokeOpacity="0.6" strokeWidth="0.9" strokeLinecap="round" />
      </g>

      {/* Realistic Curved Glass Specular Highlights */}
      <path
        d="M18.8 22.5C20.8 19.3 25.4 17.8 31 17.8"
        stroke="#ffffff"
        strokeOpacity="0.7"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M17.8 25.8C18.1 24.8 18.6 23.9 19.3 23.2"
        stroke="#ffffff"
        strokeOpacity="0.45"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <ellipse cx="42.5" cy="21.5" rx="2.2" ry="0.9" transform="rotate(-18 42.5 21.5)" fill="#ffffff" fillOpacity="0.35" />

      {/* Visor Rim Cyan Edge Highlight */}
      <path
        d="M15.6 24.8C15.6 19.1 22.4 16.3 32 16.3C41.6 16.3 48.4 19.1 48.4 24.8C48.4 33.6 43.1 40 32 40C20.9 40 15.6 33.6 15.6 24.8Z"
        stroke="#38bdf8"
        strokeOpacity="0.45"
        strokeWidth="0.8"
      />
    </svg>
  );
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
    <div className="pointer-events-auto mx-auto flex w-full max-w-2xl flex-col gap-2.5">
      {open && turns.length > 0 && (
        <div
          className="glass-panel max-h-[42vh] overflow-y-auto rounded-2xl p-4 text-[13px] text-slate-100"
          aria-live="polite"
        >
          <div className="mb-2.5 flex items-center justify-between border-b border-cyan-500/20 pb-2">
            <span className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-cyan-300 uppercase">
              <AstroBotIcon className="size-5" />
              <span>K-Fire AstroBot · {t("aiGenerated")}</span>
            </span>
            <button
              type="button"
              className="flex size-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
              aria-label={t("close")}
              onClick={() => setOpen(false)}
            >
              <ChevronDown className="size-4" />
            </button>
          </div>
          <ul className="flex flex-col gap-3">
            {turns.map((turn, i) => (
              <li key={i} className={turn.role === "user" ? "self-end text-right" : ""}>
                {turn.role === "user" ? (
                  <span className="inline-block rounded-2xl rounded-br-sm border border-blue-400/30 bg-blue-600/35 px-3.5 py-2 text-left text-xs text-white shadow-sm">
                    {turn.content}
                  </span>
                ) : (
                  <div
                    className={`border-l-2 pl-3 ${
                      turn.error ? "border-red-400/70 text-red-300" : "border-cyan-400/60 text-slate-100"
                    }`}
                  >
                    <p className="mb-1 text-[10px] font-medium tracking-wide text-cyan-300/80 uppercase">
                      {t("aiGenerated")}
                    </p>
                    <p className="text-xs leading-relaxed whitespace-pre-wrap">{turn.content}</p>
                    {turn.tools && turn.tools.length > 0 && (
                      <details className="mt-2 text-[11px] text-slate-400">
                        <summary className="cursor-pointer transition hover:text-cyan-300">
                          {t("toolsUsed")} ({turn.tools.length}){turn.patch ? ` · ${t("viewApplied")}` : ""}
                        </summary>
                        <ul className="mt-1 space-y-0.5 font-mono text-[10.5px] text-slate-300">
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
              <li className="flex items-center gap-2 text-xs text-cyan-300">
                <Loader2 className="size-4 animate-spin" aria-hidden /> {t("thinking")}
              </li>
            )}
          </ul>
          <div ref={endRef} />
        </div>
      )}
      <form
        onSubmit={ask}
        className="glass-panel flex h-12 items-center gap-2 rounded-full border border-cyan-400/40 pr-1.5 pl-4 transition-all duration-200 focus-within:border-cyan-300 focus-within:shadow-[0_0_20px_rgba(6,182,212,0.35)]"
      >
        <input
          className="min-w-0 flex-1 bg-transparent text-xs sm:text-[13px] text-white placeholder:text-slate-400 focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed"
          placeholder={available === false ? t("assistantUnavailable") : t("askPlaceholder")}
          aria-label={t("askPlaceholder")}
          value={q}
          disabled={available === false}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => turns.length && setOpen(true)}
        />
        <button
          type="submit"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-[0_0_12px_rgba(37,99,235,0.6)] transition-all duration-150 hover:from-blue-500 hover:to-indigo-500 hover:shadow-[0_0_16px_rgba(56,189,248,0.8)] active:scale-95 disabled:bg-slate-800/80 disabled:from-transparent disabled:to-transparent disabled:text-slate-500 disabled:shadow-none"
          disabled={!available || busy || !q.trim()}
          aria-label={t("ask")}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
        </button>
      </form>
    </div>
  );
}
