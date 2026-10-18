"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useRequireAuth } from "@/components/useAuth";
import { api, ApiError, saveSession, User } from "@/lib/api";

/** Turns a free trial into a real account, keeping the trial's review log, scans and Lab runs. */
export default function UpgradePage() {
  const user = useRequireAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [org, setOrg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; taken?: boolean } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ token: string; user: User }>("/api/auth/demo/upgrade", {
        method: "POST", body: JSON.stringify({ email, password, org_name: org.trim() || null }),
      });
      saveSession(r.token, r.user);
      router.push("/history");
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : "Couldn't create the account.", taken: err instanceof ApiError && err.status === 409 });
      setBusy(false);
    }
  }

  if (!user) return null;
  if (!user.is_demo) {
    return (
      <div className="card mx-auto max-w-md text-sm">
        <p>You&apos;re already signed in with a full account.</p>
        <Link href="/" className="btn-primary mt-3">Go to Scan</Link>
      </div>
    );
  }
  return (
    <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
      <section className="card">
        <h1 className="text-xl font-bold text-ink-900">Create your free account</h1>
        <p className="mt-1 text-sm text-gray-600">Keep everything from this trial: your review log, scans and Red-Team results move into your new account.</p>
        <form className="mt-4 space-y-3" onSubmit={submit}>
          <div><label className="label" htmlFor="up-email">Work email</label><input id="up-email" className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><label className="label" htmlFor="up-password">Password</label><input id="up-password" className="input" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="mt-1 text-xs text-gray-500">At least 8 characters.</p></div>
          <div><label className="label" htmlFor="up-org">Organization (optional)</label><input id="up-org" className="input" maxLength={100} value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Acme Recruiting" /></div>
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error.text}{error.taken && <> <Link href="/login" className="font-medium underline">Sign in</Link></>}
            </p>
          )}
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Creating your account…" : "Create account and keep my trial data"}</button>
        </form>
      </section>
      <section className="card bg-ink-50/50 text-sm">
        <h2 className="font-semibold text-ink-900">What changes</h2>
        <ul className="mt-2 space-y-2 text-gray-700">
          <li>✓ Your trial&apos;s review log and scans are kept, not deleted at sign-out.</li>
          <li>✓ No trial limits on AI-backed scans or Red-Team attacks.</li>
          <li>✓ Run the held-out benchmark from the Evaluation page.</li>
          <li>✓ Your reject decisions help the shared attack library (attack text only, never resumes or names).</li>
        </ul>
        <p className="mt-3 text-xs text-gray-500">Sign in later with this email and password.</p>
      </section>
    </div>
  );
}
