"use client";
import { useState } from "react";
import { useScan } from "@/components/ScanContext";
import { api, getUser } from "@/lib/api";
import { JOB_TEMPLATES } from "@/lib/jobTemplates";
import { markTrialStep } from "@/lib/trial";
import { Protected } from "@/lib/types";

export default function Screening({ scanId, enabled }: { scanId: string; enabled: boolean }) {
  const { jobDescription: jd, setJobDescription: setJd, screening: res, setScreening, beginRequest } = useScan();
  // Only rendered once the Scan page has a signed-in user on the client, so reading localStorage here is safe.
  const [demo] = useState(() => !!getUser()?.is_demo);
  const template = JOB_TEMPLATES.find((t) => t.text === jd)?.id ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    const current = beginRequest();
    setBusy(true); setError(""); setScreening(scanId, null);
    try {
      // A 410 means the backend's 15-minute copy of the document has expired; its message asks to scan again.
      const r = await api("/api/screen", { method: "POST", body: JSON.stringify({ scan_id: scanId, job_description: jd }) });
      if (current()) { setScreening(scanId, r); markTrialStep("screen"); }
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      {demo ? (
        <>
          <h2 className="font-semibold">Naive vs protected AI screener</h2>
          <p className="mb-3 text-xs text-gray-500">The same resume and job, scored twice. The naive screener reads the raw file. The protected one only sees visible, de-identified text and must quote evidence for every score.</p>
        </>
      ) : (
        <>
          <h2 className="font-semibold">AI screener (HiddenInk-protected)</h2>
          <p className="mb-3 text-xs text-gray-500">Scores the resume against the job using only the visible, de-identified text, so hidden instructions can&apos;t influence it. Every score must be backed by a quote from the resume.</p>
        </>
      )}
      {demo && (
        <div className="mb-3">
          <label className="label" htmlFor="job-template">Job template</label>
          <select id="job-template" className="input" value={template}
            onChange={(e) => { const t = JOB_TEMPLATES.find((t) => t.id === e.target.value); if (t) setJd(t.text); }}>
            <option value="" disabled>Custom (edited)</option>
            {JOB_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
      )}
      <label className="label">Job description</label>
      <textarea className="input h-24" value={jd} onChange={(e) => setJd(e.target.value)} />
      <div className="mt-3 flex items-center gap-3">
        <button className="btn-primary" onClick={run} disabled={busy || !enabled || jd.length < 20}>{busy ? "Screening…" : demo ? "Run both screeners" : "Run screener"}</button>
        {!enabled && <span className="text-xs text-gray-500">Needs an OpenAI key on the server.</span>}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {busy && (
        <div className={`mt-4 grid gap-4 ${demo ? "md:grid-cols-2" : ""}`} aria-busy="true" aria-label="Screening">
          {(demo ? [0, 1] : [0]).map((i) => <div key={i} className="skeleton h-44" />)}
        </div>
      )}
      {res && (
        <div className={`mt-4 grid gap-4 ${demo ? "md:grid-cols-2" : ""}`}>
          {demo && (
            <div className="rounded-xl border border-red-200 bg-red-50/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Naive screener</p>
              {res.naive ? (
                <>
                  <p className="mt-1 text-4xl font-bold">{res.naive.score.toFixed(1)}<span className="text-base text-gray-500">/10</span></p>
                  <p className="text-sm font-medium capitalize">{res.naive.recommendation}</p>
                  <p className="mt-2 text-sm text-gray-700">{res.naive.summary}</p>
                  <p className="mt-2 text-xs text-gray-500">Reads raw text, including hidden content. No defences.</p>
                </>
              ) : <p className="text-sm text-red-600">{res.naive_error ?? "The naive screener returned no result."}</p>}
            </div>
          )}
          <div className="rounded-xl border border-green-200 bg-green-50/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-green-700">HiddenInk-protected screener</p>
            {res.protected ? <ProtectedView p={res.protected} /> : <p className="text-sm text-red-600">{res.protected_error ?? "The screener returned no result."}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function ProtectedView({ p }: { p: Protected }) {
  return (
    <>
      <p className="mt-1 text-4xl font-bold">{p.overall_score.toFixed(1)}<span className="text-base text-gray-500">/10</span></p>
      <p className="text-sm font-medium capitalize">{p.recommendation}</p>
      <p className="mt-2 text-sm text-gray-700">{p.summary}</p>
      <ul className="mt-3 space-y-2">
        {p.criteria.map((c) => (
          <li key={c.name} className="rounded-lg bg-white p-2 text-sm">
            <div className="flex justify-between"><span className="font-medium">{c.name}</span><span>{c.grounded ? c.score : 0}/10</span></div>
            {c.verified_evidence.map((q) => <p key={q} className="mt-1 text-xs text-gray-600">✓ &ldquo;{q}&rdquo;</p>)}
            {!c.grounded && <p className="mt-1 text-xs text-red-600">No verified quote, so this criterion scores 0.</p>}
          </li>
        ))}
      </ul>
      <div className="mt-3 space-y-1 text-xs text-gray-600">
        <p>Overall is the average of evidence-backed criteria (the model said {p.model_overall.toFixed(1)}).</p>
        {p.dropped_claims > 0 && <p>{p.dropped_claims} quote{p.dropped_claims > 1 ? "s" : ""} dropped because they don&apos;t appear in the resume.</p>}
        {Object.keys(p.masked).length > 0 && <p>Masked before scoring: {Object.entries(p.masked).map(([k, v]) => `${k.replace("_", " ")} (${v})`).join(", ")}.</p>}
        {p.injection_attempt_noticed && <p className="text-amber-700">The model also noticed an injection attempt in the visible text.</p>}
        {p.tripwire.length > 0
          ? <p className="font-medium text-red-700">Tripwire: the output repeats hidden text (&ldquo;{p.tripwire[0]}&rdquo;). Treat this result with caution.</p>
          : <p>Tripwire: output does not repeat any hidden text.</p>}
      </div>
    </>
  );
}
