"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Notice from "@/components/ui/Notice";
import { api, saveSession } from "@/lib/api";
import ScanDemoCard from "./ScanDemoCard";

const svg = (d: React.ReactNode, size = 16) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);
const FEATURES = [
  { label: "Finds invisible text", icon: svg(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>) },
  { label: "AI vision cross-check", icon: svg(<><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" /><path d="M8 12h8" /></>) },
  { label: "Human makes the final call", icon: svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>) },
];
const COPY = {
  login: { title: "Welcome back", sub: "Scan resumes for hidden AI instructions." },
  register: { title: "Create your account", sub: "Free to start. No credit card." },
};

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [org, setOrg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [health, setHealth] = useState<any>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState<"form" | "trial" | null>(null);

  useEffect(() => { api("/api/health").then(setHealth).catch(() => setHealth({ status: "down" })); }, []);

  async function go(path: string, body?: object) {
    setBusy(true); setError("");
    setSubmitting(path === "/api/auth/demo" ? "trial" : "form");
    try {
      const r = await api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      saveSession(r.token, r.user);
      router.push("/");
    } catch (e: any) { setError(e.message); } finally { setBusy(false); setSubmitting(null); }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[55fr_45fr]">
      {/* ---------- hero: dark, edge to edge ---------- */}
      <section className="relative isolate flex flex-col overflow-hidden bg-ink-950 px-6 py-6 text-white sm:px-10 lg:min-h-screen lg:px-14 lg:py-8 xl:px-16">
        <div aria-hidden className="absolute inset-0 -z-10">
          <div className="animate-drift-1 absolute -left-24 -top-24 h-80 w-80 rounded-full bg-uv-500/40 blur-3xl" />
          <div className="animate-drift-2 absolute -bottom-28 right-[-4rem] h-96 w-96 rounded-full bg-ink-600/40 blur-3xl" />
          <div className="animate-drift-3 absolute left-1/3 top-1/2 h-64 w-64 rounded-full bg-glow-400/20 blur-3xl" />
          <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(rgba(255,255,255,0.09)_1px,transparent_1px)] [background-size:18px_18px]" />
        </div>

        <div className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
          <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-uv-500 to-glow-400 text-sm font-bold text-white shadow-[0_2px_12px_-2px_rgba(139,92,246,0.7)]">H</span>
          HiddenInk
        </div>

        {/* Content block, vertically centred, with a 32px rhythm between blocks. */}
        <div className="mx-auto my-auto flex w-full max-w-[560px] flex-col gap-8 py-8 lg:py-6">
          <div>
            <h1 className="font-display font-bold leading-[1.08] tracking-tight [text-wrap:balance]" style={{ fontSize: "clamp(2rem, 3.2vw, 3rem)" }}>
              Some resumes are talking to your AI.
              <span className="gradient-text mt-2 block [text-wrap:balance]">HiddenInk shows you what they&apos;re saying.</span>
            </h1>
            <p className="mt-4 max-w-md text-base text-white/70">Detect hidden instructions in resumes before your AI screener reads them.</p>
          </div>
          <ScanDemoCard />
          <ul className="flex flex-wrap gap-2" aria-label="What HiddenInk does">
            {FEATURES.map((f) => (
              <li key={f.label} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs text-white/90 backdrop-blur">
                <span className="text-glow-400">{f.icon}</span>{f.label}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------- form: the white panel is the surface ---------- */}
      <section className="flex flex-col bg-white lg:min-h-screen">
        <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
          <div className="w-full max-w-[400px]">
            {health?.status === "down" && (
              <div className="mb-6"><Notice kind="error">Can&apos;t reach the server right now. Try again in a moment.</Notice></div>
            )}
            <h2 className="font-display text-2xl font-bold tracking-tight text-ink-900">{COPY[mode].title}</h2>
            <p className="mt-1 text-sm text-gray-500">{COPY[mode].sub}</p>

            {/* Segmented control: a sliding white pill on a grey track. */}
            <div className="relative mt-6 grid grid-cols-2 rounded-xl bg-gray-100 p-1" role="tablist" aria-label="Account">
              <span aria-hidden className="absolute bottom-1 left-1 top-1 w-[calc(50%-4px)] rounded-lg bg-white shadow-[0_1px_3px_rgba(20,20,58,0.12)] transition-transform duration-300 ease-out"
                style={{ transform: `translateX(${mode === "login" ? "0%" : "100%"})` }} />
              {(["login", "register"] as const).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                  className={`relative z-10 rounded-lg py-2 text-sm font-medium transition-colors ${mode === m ? "text-ink-900" : "text-gray-500 hover:text-gray-800"}`}>
                  {m === "login" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>

            <form className="mt-6 space-y-3" onSubmit={(e) => {
              e.preventDefault();
              go(mode === "login" ? "/api/auth/login" : "/api/auth/register",
                 mode === "login" ? { email, password } : { email, password, org_name: org });
            }}>
              <div>
                <label className="label" htmlFor="login-email">Work email</label>
                <input id="login-email" className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="login-password">Password</label>
                <div className="relative">
                  <input id="login-password" className="input pr-10" type={showPassword ? "text" : "password"} required minLength={mode === "register" ? 8 : 1}
                    autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-xl text-gray-500 hover:text-uv-600 focus-visible:text-uv-600 focus-visible:outline-none">
                    {showPassword
                      ? svg(<><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>, 18)
                      : svg(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>, 18)}
                  </button>
                </div>
              </div>
              {mode === "register" && (
                <div className="animate-fade-up">
                  <label className="label" htmlFor="login-org">Organization</label>
                  <input id="login-org" className="input" required minLength={2} value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Acme Recruiting" />
                </div>
              )}
              {error && <p role="alert" className="animate-fade-up rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
              <button className="btn-primary w-full py-2.5" disabled={busy}>
                {submitting === "form" && <Spinner />}
                {mode === "login" ? "Sign in" : "Create account"}
              </button>
            </form>

            {health?.demo_enabled !== false && (
              <>
                <div className="my-5 flex items-center gap-3 text-xs text-gray-500"><div className="h-px flex-1 bg-gray-200" />or<div className="h-px flex-1 bg-gray-200" /></div>
                <button type="button" className="btn-secondary w-full py-3 text-base" disabled={busy} onClick={() => go("/api/auth/demo")}>
                  {submitting === "trial" ? <Spinner /> : svg(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />, 18)}
                  Try it free, no sign-up
                </button>
                <p className="mt-2 text-center text-xs text-gray-500">Trial data is deleted when you sign out.</p>
              </>
            )}
          </div>
        </div>
        <p className="mt-auto px-6 pb-6 text-center text-xs text-gray-500">
          HiddenInk flags hidden content for a human to review. It never rejects a candidate on its own.
        </p>
      </section>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="motion-safe:animate-spin" viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
