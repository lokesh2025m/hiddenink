"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, ApiError } from "@/lib/api";
import { BenchResult, EvalOverview, EvalRun, TECHNIQUE_LABELS } from "@/lib/types";
import { axisProps, C, ChartCard, dateTime, Icon, Kpi, MiniBar, NoData, num, pct, relTime, tooltipProps } from "./ui";

type Mode = "quick" | "full";
const MODES: { id: Mode; title: string; body: string }[] = [
  { id: "quick", title: "Quick check (no AI, free, ~1 min)", body: "Rule-based layers only, so results are identical every run." },
  { id: "full", title: "Full check (with AI layers, uses API credits)", body: "Adds the vision check and the classifier. Takes longer." },
];
const POLL_MS = 2000;

export type Toast = { kind: "success" | "error"; text: string };

function runError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return "You've reached the limit of 6 benchmark runs per hour. Try again later.";
    if (e.status === 409) return "A benchmark run is already in progress. It's shown below; wait for it to finish.";
    if (e.status === 403) return "Sign in with a real account to run the benchmark.";
    return e.message;
  }
  return "Couldn't start the benchmark. Please try again.";
}

export default function BenchmarkTab({ data, now, isDemo, onRefresh, onToast }: {
  data: EvalOverview; now: number; isDemo: boolean; onRefresh: () => void; onToast: (t: Toast) => void;
}) {
  const [mode, setMode] = useState<Mode>("quick");
  const [openai, setOpenai] = useState<boolean | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [run, setRun] = useState<EvalRun | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const callbacks = useRef({ onRefresh, onToast });
  callbacks.current = { onRefresh, onToast };

  useEffect(() => { api("/api/health").then((h) => setOpenai(!!h.openai)).catch(() => setOpenai(false)); }, []);

  // Pick up a run someone (maybe in another tab) already started.
  useEffect(() => {
    if (data.running && data.running.run_id !== runId) { setRunId(data.running.run_id); setRun(data.running); }
  }, [data.running, runId]);

  // Poll the run every 2 s until it finishes.
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await api<EvalRun>(`/api/eval/run/${runId}`);
        if (!alive) return;
        setRun(r);
        if (r.status !== "running") {
          setRunId(null);
          callbacks.current.onRefresh();
          callbacks.current.onToast(r.status === "done"
            ? { kind: "success", text: `Benchmark finished: ${pct(r.result?.detection_rate)} detected, ${pct(r.result?.false_positive_rate)} false positives.` }
            : { kind: "error", text: r.error || "The benchmark run failed." });
          return;
        }
      } catch { /* keep polling through brief network errors */ }
      if (alive) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [runId]);

  async function start() {
    if (mode === "full" && !window.confirm(
      "A full check runs the AI layers on every file in the benchmark, which uses API credit. Run it?")) return;
    setStarting(true); setError("");
    try {
      const { run_id } = await api<{ run_id: string }>("/api/eval/run", { method: "POST", body: JSON.stringify({ mode }) });
      setRun({ run_id, status: "running", mode, started_by: null, created_at: new Date().toISOString(), finished_at: null,
               progress: { done: 0, total: 0, label: "Building the held-out set" }, result: null, error: null });
      setRunId(run_id);
    } catch (e) {
      setError(runError(e));
      if (e instanceof ApiError && e.status === 409) onRefresh();
    } finally { setStarting(false); }
  }

  const running = run && run.status === "running" ? run : null;
  const latest = data.latest;

  return (
    <div className="space-y-5">
      <section className={`card ${isDemo ? "bg-gray-50" : ""}`} aria-label="Run the benchmark" aria-disabled={isDemo || undefined}>
        <h2 className="font-semibold">Run the held-out benchmark</h2>
        <p className="mb-3 text-xs text-gray-500">Scans every file in the frozen held-out set and 15 clean resumes, then scores the detector.</p>
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Benchmark mode">
          {MODES.map((m) => {
            const disabled = isDemo || (m.id === "full" && openai === false);
            return (
              <label key={m.id} className={`rounded-xl border p-3 text-sm transition ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${mode === m.id ? "border-ink-500 bg-ink-50" : "border-gray-200 hover:border-gray-300"}`}>
                <input type="radio" name="bench-mode" className="mr-2 accent-indigo-600" checked={mode === m.id} disabled={disabled || !!running}
                  onChange={() => setMode(m.id)} />
                <span className="font-medium">{m.title}</span>
                <p className="mt-1 text-xs text-gray-500">{!isDemo && disabled ? "Needs an OpenAI API key on the server." : m.body}</p>
              </label>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {isDemo ? (
            <>
              <button className="btn-primary" disabled aria-describedby="bench-locked">
                <span aria-hidden>{Icon.lock}</span> Run benchmark
              </button>
              <p id="bench-locked" className="text-sm text-gray-600">
                <Link href="/upgrade" className="font-medium text-ink-600 hover:underline">Create a free account to run this</Link>
              </p>
            </>
          ) : (
            <button className="btn-primary" onClick={start} disabled={starting || !!running}>
              {starting ? "Starting…" : running ? "Benchmark running…" : "Run benchmark"}
            </button>
          )}
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        </div>
      </section>

      {running && <RunProgress run={running} />}

      {latest ? <Results latest={latest} history={data.history} now={now} /> : (
        <NoData>No benchmark results yet.{isDemo ? "" : " Run a quick check above to get the first numbers."}</NoData>
      )}

      <div className="card border-ink-100 bg-ink-50/60 text-sm text-ink-900">
        <p className="font-medium">About the held-out set</p>
        <p className="mt-1 text-ink-700">The held-out set is never used for tuning. Every attack in it is verified invisible to a human before it counts.</p>
      </div>
    </div>
  );
}

function RunProgress({ run }: { run: EvalRun }) {
  const { done, total, label } = run.progress;
  const share = total ? done / total : 0;
  return (
    <section className="card" aria-label="Benchmark progress">
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <p className="font-medium">{run.mode === "full" ? "Full" : "Quick"} benchmark running</p>
        <p className="tabular-nums text-gray-600">{total ? `${done} / ${total}` : "Preparing…"}</p>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={done} aria-label="Files scanned">
        <div className={`h-full rounded-full bg-ink-500 transition-all duration-500 ${total ? "" : "w-1/3 motion-safe:animate-pulse"}`}
          style={total ? { width: `${Math.max(3, share * 100)}%` } : undefined} />
      </div>
      <p className="mt-2 truncate text-xs text-gray-500" title={label}>{label}</p>
    </section>
  );
}

function runMeta(r: BenchResult, now: number) {
  if (r.source === "run") {
    return `Last run: ${relTime(r.created_at, now)} · ${r.mode === "full" ? "Full" : "Quick"}${r.started_by ? ` · by ${r.started_by}` : ""}`;
  }
  return `Last run: ${r.date ? relTime(r.date, now) : "–"} · command line ${r.version ?? ""} (AI layers ${r.ai_layers ? "on" : "off"})`;
}

function Results({ latest, history, now }: { latest: BenchResult; history: EvalOverview["history"]; now: number }) {
  const trend = history.map((h, i) => {
    const when = h.created_at ?? h.date;
    return { key: h.run_id ?? h.version ?? String(i), label: when ? dateTime(when) : h.version ?? `#${i + 1}`,
             mode: h.mode ? (h.mode === "full" ? "Full" : "Quick") : h.version ? `CLI ${h.version}` : "",
             detection_rate: h.detection_rate, false_positive_rate: h.false_positive_rate, technique_accuracy: h.technique_accuracy ?? null };
  });
  const techniques = Object.entries(latest.per_technique)
    .map(([t, v]) => ({ technique: t, name: TECHNIQUE_LABELS[t] || t, ...v, rate: v.n ? v.detected / v.n : 0 }))
    .sort((a, b) => a.rate - b.rate || a.name.localeCompare(b.name));
  const fps = latest.false_positives ?? [];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Icon.target} label="Detection rate" value={pct(latest.detection_rate)} sub={`${num(latest.attacks)} invisible attacks`} />
        <Kpi icon={Icon.alert} label="False-positive rate" value={pct(latest.false_positive_rate)} tone={latest.false_positive_rate > 0 ? "bad" : "default"}
          sub={`${num(fps.length)} of ${num(latest.clean_files)} clean files flagged`} />
        <Kpi icon={Icon.tag} label="Technique accuracy" value={pct(latest.technique_accuracy)} sub="Hiding technique named correctly" />
        <div className="card flex gap-3 py-4">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-uv-500 to-ink-600 text-white shadow-[0_4px_12px_-4px_rgba(139,92,246,0.7)]" aria-hidden>{Icon.clock}</div>
          <div className="min-w-0 text-sm">
            <p className="text-xs text-gray-500">Latest result</p>
            <p className="mt-1 break-words font-medium text-gray-800">{runMeta(latest, now)}</p>
            {latest.duration_s != null && <p className="text-xs text-gray-500">Took {num(latest.duration_s, 0)} s{latest.tokens_used ? ` · ${num(latest.tokens_used)} tokens` : ""}</p>}
          </div>
        </div>
      </div>

      <ChartCard title="Trend across runs" sub="Each point is one benchmark run, oldest to newest">
        {trend.length ? (
          <>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={C.grid} />
                  <XAxis dataKey="label" {...axisProps} minTickGap={24} />
                  <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={(v) => pct(v)} {...axisProps} axisLine={false} />
                  <Tooltip {...tooltipProps} formatter={(v, n) => [pct(v == null ? null : Number(v), 1), n]}
                    labelFormatter={(l, p) => `${l}${p?.[0]?.payload?.mode ? ` · ${p[0].payload.mode}` : ""}`} />
                  <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                  {([["detection_rate", "Detection rate", C.ink600], ["false_positive_rate", "False-positive rate", C.red500],
                     ["technique_accuracy", "Technique accuracy", C.teal500]] as const).map(([k, n, c]) => (
                    <Line key={k} type="monotone" dataKey={k} name={n} stroke={c} strokeWidth={2} connectNulls
                      dot={{ r: 4, fill: c, stroke: C.surface, strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-xs font-medium text-ink-600">Show as a table</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="py-1.5 font-medium">Run</th><th className="font-medium">Mode</th><th className="font-medium">Detection</th><th className="font-medium">False positives</th><th className="font-medium">Technique accuracy</th></tr></thead>
                  <tbody>{[...trend].reverse().map((r) => (
                    <tr key={r.key} className="border-t border-gray-100"><td className="py-1.5">{r.label}</td><td>{r.mode}</td><td className="tabular-nums">{pct(r.detection_rate, 1)}</td><td className="tabular-nums">{pct(r.false_positive_rate, 1)}</td><td className="tabular-nums">{pct(r.technique_accuracy, 1)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
          </>
        ) : <NoData>Run the benchmark more than once to see a trend.</NoData>}
      </ChartCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Detected, by technique" sub={`Latest run · ${latest.ai_layers ? "AI layers on" : "AI layers off"}`}>
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[360px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-5 py-2 font-medium">Technique</th><th className="font-medium">Detected</th><th className="w-2/5 px-5 font-medium"><span className="sr-only">Share detected</span></th></tr></thead>
              <tbody>
                {techniques.map((t) => (
                  <tr key={t.technique} className="border-t border-gray-100">
                    <td className="px-5 py-2">{t.name}</td>
                    <td className="tabular-nums">{t.detected}/{t.n}</td>
                    <td className="px-5"><MiniBar value={t.rate} color={t.rate < 1 ? C.red500 : C.ink500} label={`${pct(t.rate)} detected`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
        <ChartCard title="Detection rate, by technique" sub="Same data as the table; weakest techniques first">
          <div style={{ height: Math.max(160, techniques.length * 30 + 30) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={techniques} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke={C.grid} />
                <XAxis type="number" domain={[0, 1]} ticks={[0, 0.5, 1]} tickFormatter={(v) => pct(v)} {...axisProps} />
                <YAxis type="category" dataKey="name" {...axisProps} width={140} axisLine={false} interval={0} />
                <Tooltip {...tooltipProps} formatter={(v, _n, item) => {
                  const row = item?.payload as { detected: number; n: number } | undefined;
                  return [`${pct(Number(v))} (${row?.detected}/${row?.n})`, "Detected"];
                }} />
                <Bar dataKey="rate" name="Detected" fill={C.ink500} radius={[0, 4, 4, 0]} barSize={14} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <details className="card group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <span><span className="font-semibold">False positives</span> <span className="text-sm text-gray-500">({num(fps.length)} of {num(latest.clean_files)} clean files)</span></span>
          <span className="text-gray-500 transition group-open:rotate-180" aria-hidden>▾</span>
        </summary>
        {fps.length ? (
          <ul className="mt-3 divide-y divide-gray-100 text-sm">
            {fps.map((f) => (
              <li key={f.file} className="flex items-center justify-between gap-3 py-2"><span className="truncate">{f.file}</span><span className="chip bg-amber-100 text-amber-700">{f.verdict}</span></li>
            ))}
          </ul>
        ) : <p className="mt-3 text-sm text-gray-600">No clean file was flagged in the latest run.</p>}
      </details>
    </>
  );
}
