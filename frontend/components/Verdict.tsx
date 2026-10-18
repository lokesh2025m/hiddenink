"use client";
import { useEffect, useState } from "react";
import { prefersReducedMotion } from "@/components/ui/motion";
import { ScanReport } from "@/lib/types";

const STYLES = {
  Clean: { ring: "#10b981", badge: "badge-clean", tint: "from-emerald-50", note: "No hidden content that an AI would read." },
  Suspicious: { ring: "#f59e0b", badge: "badge-suspicious", tint: "from-amber-50", note: "Hidden content found. A person should take a look." },
  Poisoned: { ring: "#e11d48", badge: "badge-poisoned", tint: "from-rose-50", note: "Hidden instructions aimed at an AI screener." },
};

/** Circular risk gauge: an SVG ring that fills from 0 to the score, in the verdict's colour. */
function RiskGauge({ score, color }: { score: number; color: string }) {
  const r = 42, c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) { setShown(score); return; }
    const id = requestAnimationFrame(() => setShown(score));  // next frame, so the ring animates from empty
    return () => cancelAnimationFrame(id);
  }, [score]);
  return (
    <div className="relative h-28 w-28 shrink-0" role="img" aria-label={`Risk score ${score} out of 100`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#ececf4" strokeWidth="9" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - shown / 100)}
          className="transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:transition-none"
          style={{ filter: `drop-shadow(0 0 6px ${color}66)` }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center" aria-hidden>
        <div>
          <p className="font-display text-3xl font-bold leading-none text-ink-900">{score}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-500">risk</p>
        </div>
      </div>
    </div>
  );
}

export default function Verdict({ report }: { report: ScanReport }) {
  const s = STYLES[report.verdict];
  return (
    <div className={`card flex flex-wrap items-center gap-5 bg-gradient-to-br ${s.tint} to-white to-60%`}>
      <RiskGauge score={report.risk_score} color={s.ring} />
      <div className="min-w-0 flex-1">
        <span className={`${s.badge} px-4 py-1.5 text-base`}>{report.verdict}</span>
        <p className="mt-2 text-sm text-gray-700">{s.note}</p>
        <p className="mt-1 truncate font-medium text-gray-900" title={report.file_name}>{report.file_name}</p>
        <p className="text-xs text-gray-500">{report.findings.length} finding{report.findings.length === 1 ? "" : "s"} · risk {report.risk_score}/100</p>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {Object.entries(report.ai_layers).map(([k, v]) => (
          <span key={k} className={`chip ${v === "on" || v === "embeddings" ? "bg-uv-500/10 text-uv-700" : v === "error" ? "bg-rose-100 text-rose-700" : "bg-gray-100 text-gray-600"}`}>
            {k.replace("_", " ")}: {v}
          </span>
        ))}
      </div>
    </div>
  );
}
