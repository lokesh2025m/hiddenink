"use client";
import { useState } from "react";
import { Finding, ScanReport, TECHNIQUE_LABELS } from "@/lib/types";

export default function RevealView({ report, active, onSelect }: { report: ScanReport; active: string | null; onSelect: (id: string) => void }) {
  const [reveal, setReveal] = useState(false);
  if (!report.pages.length) return null;
  const byPage = (i: number) => report.findings.filter((f) => f.page === i && f.bbox);
  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Reveal view</h2>
          <p className="text-xs text-gray-500">The page as a person sees it. Glowing violet boxes mark text that only a machine can read.</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} className="h-4 w-4 accent-violet-600" />
          Reveal hidden text
        </label>
      </div>
      <div className="space-y-4">
        {report.pages.map((p) => (
          <div key={p.index} className="relative mx-auto w-full max-w-[640px] overflow-hidden rounded-xl border border-ink-500/15 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:image/png;base64,${p.image_b64}`} alt={`Page ${p.index + 1}`} className="block w-full" />
            {byPage(p.index).map((f) => <Box key={f.id} f={f} w={p.width} h={p.height} reveal={reveal} active={active === f.id} onClick={() => onSelect(f.id)} />)}
            {byPage(p.index).some((f) => offPage(f, p.width, p.height)) && (
              <p className="absolute bottom-1 right-2 rounded-md bg-uv-500 px-2 py-0.5 text-[10px] text-white">+ text positioned off the page</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function offPage(f: Finding, w: number, h: number) {
  const [x0, y0, x1, y1] = f.bbox!;
  return x0 >= w || y1 <= 0 || x1 <= 0 || y0 >= h;
}

function Box({ f, w, h, reveal, active, onClick }: { f: Finding; w: number; h: number; reveal: boolean; active: boolean; onClick: () => void }) {
  if (offPage(f, w, h)) return null;
  const [x0, y0, x1, y1] = f.bbox!;
  const pad = 2;
  const style = {
    left: `${Math.max(0, (x0 - pad) / w) * 100}%`, top: `${Math.max(0, (y0 - pad) / h) * 100}%`,
    width: `${Math.min(1, (x1 - x0 + 2 * pad) / w) * 100}%`, height: `${Math.max(1.2, ((y1 - y0 + 2 * pad) / h) * 100)}%`,
  };
  return (
    <button onClick={onClick} title={`${f.techniques.map((t) => TECHNIQUE_LABELS[t] || t).join(", ")}: ${f.text}`} style={style}
      className={`animate-box-pulse absolute rounded-sm border-2 text-left ${active ? "border-uv-500 bg-uv-500/25" : "border-uv-400 bg-uv-500/10"} hover:bg-uv-500/20`}>
      {reveal && (
        <span className={`absolute left-0 z-10 ${y0 / h > 0.75 ? "bottom-full mb-0.5" : "top-full mt-0.5"} max-w-[420px] rounded-md bg-ink-900 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-white shadow`}>
          {f.text.length > 220 ? f.text.slice(0, 220) + "…" : f.text}
        </span>
      )}
    </button>
  );
}
