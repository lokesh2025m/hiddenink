"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import BenchmarkTab, { Toast } from "@/components/eval/BenchmarkTab";
import LiveTab from "@/components/eval/LiveTab";
import RedteamTab from "@/components/eval/RedteamTab";
import { Icon, SkeletonDashboard } from "@/components/eval/ui";
import Notice from "@/components/ui/Notice";
import { useRequireAuth } from "@/components/useAuth";
import { api } from "@/lib/api";
import { EvalOverview, LiveStats, RedteamStats } from "@/lib/types";

const TABS = [
  { id: "live", label: "Live detection", path: "/api/eval/live" },
  { id: "redteam", label: "Red-Team scoreboard", path: "/api/eval/redteam" },
  { id: "benchmark", label: "Benchmark", path: "/api/eval" },
] as const;
type TabId = (typeof TABS)[number]["id"];
const REFRESH_MS = 30_000;

export default function EvalPage() {
  // useSearchParams needs a Suspense boundary for the static build.
  return <Suspense fallback={null}><Dashboard /></Suspense>;
}

/** Fetches `path`, refetching every 30 s while the page is visible and whenever the window regains focus. */
function usePolled(path: string, enabled: boolean) {
  const [store, setStore] = useState<Record<string, { data: unknown; at: number }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const inflight = useRef(new Set<string>());

  const load = useCallback(async () => {
    if (!enabled || inflight.current.has(path)) return;
    inflight.current.add(path);
    setRefreshing(true);
    try {
      const data = await api(path);
      setStore((s) => ({ ...s, [path]: { data, at: Date.now() } }));
      setErrors((e) => ({ ...e, [path]: "" }));
    } catch (e: unknown) {
      setErrors((x) => ({ ...x, [path]: e instanceof Error ? e.message : "Couldn't load the data." }));
    } finally {
      inflight.current.delete(path);
      setRefreshing(false);
    }
  }, [path, enabled]);

  useEffect(() => {
    if (!enabled) return;
    load();
    const visible = () => document.visibilityState === "visible";
    const timer = setInterval(() => { if (visible()) load(); }, REFRESH_MS);
    const onVisibility = () => { if (visible()) load(); };
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, enabled]);

  return { entry: store[path], error: errors[path] || "", refreshing, refresh: load };
}

function Dashboard() {
  const user = useRequireAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: TabId = TABS.some((t) => t.id === params.get("tab")) ? (params.get("tab") as TabId) : "live";
  const active = TABS.find((t) => t.id === tab)!;
  const { entry, error, refreshing, refresh } = usePolled(active.path, !!user);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);

  function selectTab(id: TabId) {
    router.replace(`${pathname}?tab=${id}`, { scroll: false });
  }
  function onTabKey(e: React.KeyboardEvent, i: number) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = TABS[(i + step + TABS.length) % TABS.length];
    selectTab(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  if (!user) return null;
  const ago = entry ? Math.max(0, Math.round((now - entry.at) / 1000)) : null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold text-ink-900">Evaluation</h1>
          <p className="text-sm text-gray-600">How well HiddenInk catches hidden instructions, measured live from your scans, the Red-Team Lab, and a frozen benchmark.</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 font-medium text-green-700">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            Live
          </span>
          <span aria-live="polite" className="tabular-nums">{ago === null ? "Loading…" : ago < 2 ? "Updated just now" : `Updated ${ago < 60 ? `${ago}s` : `${Math.floor(ago / 60)} min`} ago`}</span>
          <button className="btn-ghost px-3 py-1.5" onClick={refresh} disabled={refreshing} aria-label="Refresh now">
            <span className={refreshing ? "motion-safe:animate-spin" : ""}>{Icon.refresh}</span>
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </header>

      <div role="tablist" aria-label="Evaluation views" className="flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1 sm:inline-flex">
        {TABS.map((t, i) => (
          <button key={t.id} id={`tab-${t.id}`} role="tab" aria-selected={tab === t.id} aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1} onClick={() => selectTab(t.id)} onKeyDown={(e) => onTabKey(e, i)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === t.id ? "bg-white text-ink-700 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <Notice kind="error">{entry ? `Couldn't refresh (${error}). Showing the last data loaded.` : error}</Notice>
      )}

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {!entry ? (error ? null : <SkeletonDashboard />)
          : tab === "live" ? <LiveTab data={entry.data as LiveStats} now={now} />
          : tab === "redteam" ? <RedteamTab data={entry.data as RedteamStats} now={now} />
          : <BenchmarkTab data={entry.data as EvalOverview} now={now} isDemo={user.is_demo} onRefresh={refresh} onToast={setToast} />}
      </div>

      {toast && (
        <Notice kind={toast.kind} floating onDismiss={() => setToast(null)}>{toast.text}</Notice>
      )}
    </div>
  );
}
