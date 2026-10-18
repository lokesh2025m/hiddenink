"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRequireAuth } from "@/components/useAuth";
import { CountUpText } from "@/components/ui/motion";
import Notice from "@/components/ui/Notice";
import { api } from "@/lib/api";

const VERDICT = { Clean: "badge-clean", Suspicious: "badge-suspicious", Poisoned: "badge-poisoned" } as Record<string, string>;
const DECISION = { reject: "Rejected", clear: "Cleared (false positive)", needs_review: "Needs review" } as Record<string, string>;

export default function HistoryPage() {
  const user = useRequireAuth();
  const [data, setData] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!user) return;
    api("/api/scans").then(setData).catch((e) => setError(e.message));
    api("/api/stats").then(setStats).catch(() => {});
  }, [user]);
  if (!user) return null;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Review log</h1>
        <p className="text-sm text-gray-600">An audit trail for {user.org_name} only. It stores scan results and reviewer decisions, never resume text, and deletes entries after {data?.retention_days ?? 30} days.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {stats
          ? [["Scans", stats.scans], ["Poisoned", stats.poisoned], ["Suspicious", stats.suspicious], ["Cleared as false positive", stats.false_positives]].map(([k, v]) => (
            <div key={k as string} className="card py-4"><p className="text-xs text-gray-500">{k}</p><p className="font-display text-2xl font-bold tabular-nums text-ink-900"><CountUpText text={String(v)} /></p></div>
          ))
          : [0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[84px]" aria-hidden />)}
      </div>
      {error && <Notice kind="error">{error}</Notice>}

      {!data && !error ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading the review log">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-16" />)}
        </div>
      ) : data?.scans?.length === 0 ? (
        <EmptyLog />
      ) : data && (
        <div className="card overflow-x-auto p-0 hover:![transform:none]">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-ink-500/10 text-xs uppercase tracking-wide text-gray-500">
              <tr><th className="p-3 font-medium">When</th><th className="p-3 font-medium">File</th><th className="p-3 font-medium">Verdict</th><th className="p-3 font-medium">Hidden content</th><th className="p-3 font-medium">Decision</th></tr>
            </thead>
            <tbody>
              {data.scans.map((s: any) => (
                <tr key={s.id} className="border-b border-gray-100 align-top transition-colors last:border-0 hover:bg-uv-500/[0.04]">
                  <td className="whitespace-nowrap p-3 text-xs text-gray-500">{new Date(s.created_at).toLocaleString()}</td>
                  <td className="max-w-[180px] truncate p-3 font-medium text-gray-900" title={s.file_name}>{s.file_name}<p className="font-mono text-[10px] font-normal text-gray-500">{s.file_hash.slice(0, 12)}…</p></td>
                  <td className="p-3"><span className={VERDICT[s.verdict] ?? "chip bg-gray-100 text-gray-700"}>{s.verdict} · {s.risk_score}</span>
                    {s.screening && <p className="mt-1 text-[11px] text-gray-500">naive {s.screening.naive_score ?? "–"} / protected {s.screening.protected_score ?? "–"}</p>}</td>
                  <td className="max-w-[300px] p-3 text-xs text-gray-600">{s.findings.slice(0, 2).map((f: any) => <p key={f.id} className="truncate font-mono text-uv-700" title={f.text}>“{f.text}”</p>)}{s.findings.length > 2 && <p className="text-gray-500">+{s.findings.length - 2} more</p>}</td>
                  <td className="p-3 text-xs">{s.reviews.length ? s.reviews.map((r: any, i: number) => (
                    <div key={i} className="mb-1"><span className="font-medium">{DECISION[r.decision]}</span>{r.candidate_ref ? ` · ${r.candidate_ref}` : ""}<p className="text-gray-500">{r.reason}</p><p className="text-gray-500">{r.reviewer_email}</p></div>
                  )) : <span className="text-gray-500">Not reviewed</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {stats?.library && (
        <div className="card">
          <h2 className="font-semibold">Confirmed attack library</h2>
          <p className="mb-3 text-xs text-gray-500">Attack text from rejected documents, shared across organizations so everyone benefits. It holds no names, resumes or contact details. {stats.library.payloads} pattern(s) so far.</p>
          {stats.library.top.length ? (
            <ul className="space-y-1 text-xs">{stats.library.top.map((p: any, i: number) => (
              <li key={i} className="flex gap-2"><span className="chip bg-purple-100 text-purple-700">×{p.confirmed_count}</span><span className="truncate font-mono text-gray-700" title={p.text}>{p.text}</span></li>
            ))}</ul>
          ) : <p className="text-xs text-gray-500">Nothing confirmed yet. Rejecting a flagged file adds its attack text here.</p>}
        </div>
      )}
    </div>
  );
}

function EmptyLog() {
  return (
    <div className="card flex flex-col items-center py-12 text-center hover:![transform:none]">
      {/* A resume page with a hidden line glowing under a UV beam. */}
      <svg viewBox="0 0 160 120" width="160" height="120" aria-hidden className="mb-4">
        <defs>
          <linearGradient id="empty-beam" x1="0" x2="1"><stop offset="0" stopColor="#8b5cf6" /><stop offset="1" stopColor="#22d3ee" /></linearGradient>
        </defs>
        <ellipse cx="80" cy="108" rx="46" ry="6" fill="#8b5cf6" opacity="0.12" />
        <rect x="44" y="10" width="72" height="92" rx="10" fill="#fff" stroke="#e0e7ff" strokeWidth="2" />
        <circle cx="60" cy="28" r="7" fill="#e0e7ff" />
        <rect x="72" y="23" width="32" height="5" rx="2.5" fill="#c7d2fe" />
        <rect x="72" y="31" width="20" height="4" rx="2" fill="#e5e7eb" />
        <rect x="54" y="46" width="52" height="4" rx="2" fill="#e5e7eb" />
        <rect x="54" y="55" width="44" height="4" rx="2" fill="#e5e7eb" />
        <rect x="54" y="64" width="50" height="4" rx="2" fill="#a78bfa" opacity="0.8" />
        <rect x="54" y="73" width="40" height="4" rx="2" fill="#e5e7eb" />
        <rect x="54" y="82" width="46" height="4" rx="2" fill="#e5e7eb" />
        <rect x="36" y="65" width="88" height="2.5" rx="1.25" fill="url(#empty-beam)" />
        <rect x="36" y="60" width="88" height="12" rx="6" fill="url(#empty-beam)" opacity="0.15" />
      </svg>
      <h2 className="text-lg font-semibold">No scans in your log yet</h2>
      <p className="mt-1 max-w-md text-sm text-gray-600">Every resume you scan shows up here with its verdict, the hidden content found and your team&apos;s decisions.</p>
      <Link href="/" className="btn-primary mt-4">Scan your first resume</Link>
    </div>
  );
}
