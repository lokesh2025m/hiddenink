"use client";
import { useState } from "react";
import { api } from "@/lib/api";

const OPTIONS = [
  { v: "reject", label: "Reject", hint: "Confirmed manipulation. The attack text (never the resume) joins the shared payload library." },
  { v: "clear", label: "Clear (false positive)", hint: "The hidden content is harmless. Recorded to measure false positives." },
  { v: "needs_review", label: "Needs review", hint: "Escalate to a colleague before deciding." },
] as const;

export default function Review({ scanId, demo = false, onSaved }: { scanId: string; demo?: boolean; onSaved?: (message: string) => void }) {
  const [decision, setDecision] = useState<string>("needs_review");
  const [reason, setReason] = useState("");
  const [ref, setRef] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string>("");
  const [error, setError] = useState("");

  async function submit() {
    if (saving) return;
    setSaving(true); setError(""); setDone("");
    try {
      const r = await api(`/api/scans/${scanId}/review`, { method: "POST", body: JSON.stringify({ decision, reason, candidate_ref: ref || null }) });
      const message = demo && decision === "reject" ? "Saved (demo decisions don't add to the shared attack library)."
        : decision === "reject" && r.payloads_added ? `Saved. ${r.payloads_added} new attack pattern(s) added to the library.`
        : "Saved to your organization's review log.";
      setDone(message);
      onSaved?.(message);
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="card">
      <h2 className="font-semibold">Human review</h2>
      <p className="mb-3 text-xs text-gray-500">Choose a decision and give a reason.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <label key={o.v} className={`cursor-pointer rounded-xl border p-3 text-sm ${decision === o.v ? "border-ink-500 bg-ink-50" : "border-gray-200"}`}>
            <input type="radio" name="decision" className="mr-2 accent-indigo-600" checked={decision === o.v} onChange={() => setDecision(o.v)} />
            <span className="font-medium">{o.label}</span>
            <p className="mt-1 text-xs text-gray-500">{o.hint}</p>
          </label>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2"><label className="label">Reason (required)</label><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. White text instructs the AI to shortlist" /></div>
        <div><label className="label">Application ref (optional)</label><input className="input" value={ref} maxLength={60} onChange={(e) => setRef(e.target.value)} placeholder="e.g. APP-1042" /></div>
      </div>
      <p className="mt-3 text-xs text-gray-500">You make the final decision. HiddenInk only flags hidden content; it never rejects a candidate on its own.</p>
      <div className="mt-2 flex items-center gap-3">
        <button className="btn-primary" onClick={submit} disabled={saving || reason.trim().length < 3}>{saving ? "Saving…" : "Save decision"}</button>
        {done && <span className="text-sm text-green-700">{done}</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
      <p className="mt-2 text-xs text-gray-500">Only your organization sees this log. Names and resume text are not stored, and entries are deleted automatically after the retention period.</p>
    </div>
  );
}
