"use client";
import Link from "next/link";
import { ReactNode } from "react";
import { CountUpText } from "@/components/ui/motion";
import { Verdict } from "@/lib/types";

// ---------- colours (Tailwind palette values, so charts match the classes used elsewhere) ----------
export const C = {
  ink500: "#6366f1", ink600: "#4f46e5", ink100: "#e0e7ff", uv500: "#8b5cf6",
  emerald500: "#10b981", amber500: "#f59e0b", red500: "#ef4444", rose600: "#e11d48", teal500: "#14b8a6",
  grid: "#e5e7eb", axis: "#6b7280", surface: "#ffffff",
};
export const VERDICT_COLOR: Record<Verdict, string> = { Clean: C.emerald500, Suspicious: C.amber500, Poisoned: C.rose600 };
export const VERDICT_BADGE: Record<Verdict, string> = { Clean: "badge-clean", Suspicious: "badge-suspicious", Poisoned: "badge-poisoned" };
export const DECISION_LABEL: Record<string, string> = { reject: "Rejected", clear: "Cleared", needs_review: "Needs review" };

// ---------- formatting ----------
export const pct = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || Number.isNaN(v) ? "–" : `${(v * 100).toFixed(digits)}%`;
export const num = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined ? "–" : v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const pretty = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "–";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
export const shortDate = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: iso.length === 10 ? "UTC" : undefined });
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

// ---------- shared chart props ----------
export const axisProps = { stroke: C.grid, tick: { fill: C.axis, fontSize: 11 }, tickLine: false } as const;
export const tooltipProps = {
  contentStyle: { borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12, boxShadow: "0 1px 3px rgba(0,0,0,.08)" },
  labelStyle: { color: "#111827", fontWeight: 600 },
  itemStyle: { color: "#374151" },
  cursor: { fill: "rgba(79,70,229,0.06)" },
} as const;

// ---------- building blocks ----------
export function Kpi({ icon, label, value, sub, info, tone = "default" }: {
  icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; info?: string; tone?: "default" | "bad" | "good";
}) {
  const color = tone === "bad" ? "text-rose-600" : tone === "good" ? "text-emerald-700" : "text-ink-900";
  return (
    <div className="card flex gap-3 py-4">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-uv-500 to-ink-600 text-white shadow-[0_4px_12px_-4px_rgba(139,92,246,0.7)]" aria-hidden>{icon}</div>
      <div className="min-w-0">
        <p className="flex items-center gap-1 text-xs text-gray-500">{label}{info && <InfoTip text={info} />}</p>
        <p className={`font-display text-2xl font-bold tabular-nums ${color}`}><CountUpText text={value} /></p>
        {sub && <p className="text-xs text-gray-500">{sub}</p>}
      </div>
    </div>
  );
}

export function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button type="button" aria-label={text} className="grid h-4 w-4 place-items-center rounded-full border border-gray-300 text-[10px] font-semibold text-gray-500 hover:border-ink-500 hover:text-ink-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-100">i</button>
      <span role="tooltip" className="pointer-events-none absolute left-1/2 top-6 z-30 hidden w-60 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-normal leading-snug text-white shadow-lg group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  );
}

export function ChartCard({ title, sub, children, className = "", action }: {
  title: string; sub?: ReactNode; children: ReactNode; className?: string; action?: ReactNode;
}) {
  return (
    <section className={`card min-w-0 ${className}`} aria-label={title}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {sub && <p className="text-xs text-gray-500">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function NoData({ children = "Nothing to show yet." }: { children?: ReactNode }) {
  return <p className="grid h-40 place-items-center rounded-xl bg-gray-50 px-4 text-center text-sm text-gray-500">{children}</p>;
}

export function EmptyState({ icon, title, body, href, cta }: { icon: ReactNode; title: string; body: string; href: string; cta: string }) {
  return (
    <div className="card flex flex-col items-center py-12 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-ink-50 text-ink-600" aria-hidden>{icon}</div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-gray-600">{body}</p>
      <Link href={href} className="btn-primary mt-4">{cta}</Link>
    </div>
  );
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <span className={VERDICT_BADGE[verdict] ?? "chip bg-gray-100 text-gray-700"}>{verdict}</span>;
}

export function MiniBar({ value, color = C.ink500, label }: { value: number; color?: string; label?: string }) {
  const w = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100" role="img" aria-label={label ?? `${Math.round(w)}%`}>
      <div className="h-2 rounded-full" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

export function SkeletonDashboard() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[88px]" />)}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {[0, 1].map((i) => <div key={i} className="skeleton h-72" />)}
      </div>
    </div>
  );
}

// ---------- icons (24px stroke icons, inherit currentColor) ----------
const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
export const Icon = {
  file: svg(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>),
  flag: svg(<><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>),
  check: svg(<><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" /><path d="m9 12 2 2 4-4" /></>),
  gauge: svg(<><path d="M4 18a8 8 0 1 1 16 0" /><path d="m12 18 4-6" /></>),
  target: svg(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.5" /></>),
  bolt: svg(<path d="M13 3 5 14h6l-1 7 8-11h-6z" />),
  tag: svg(<><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1" /></>),
  shield: svg(<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" />),
  alert: svg(<><path d="M12 4 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>),
  clock: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  lab: svg(<><path d="M9 3h6M10 3v6L4 19a1.5 1.5 0 0 0 1.3 2h13.4A1.5 1.5 0 0 0 20 19l-6-10V3" /></>),
  lock: svg(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>),
  refresh: svg(<><path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4" /></>),
};
