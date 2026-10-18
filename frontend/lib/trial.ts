// Free-trial guide progress, kept in sessionStorage per trial session (a new trial starts fresh).
import { getUser } from "@/lib/api";

export type TrialStep = "scan" | "screen" | "decision";
export type TrialProgress = Partial<Record<TrialStep, boolean>> & { dismissed?: boolean };
export const TRIAL_EVENT = "hiddenink:trial-progress";

function key(): string | null {
  const u = getUser();
  return u?.is_demo ? `hiddenink_trial_${u.id}` : null;
}

export function getTrialProgress(): TrialProgress {
  const k = key();
  if (!k) return {};
  try { return JSON.parse(sessionStorage.getItem(k) || "{}"); } catch { return {}; }
}

function save(p: TrialProgress) {
  const k = key();
  if (!k) return;
  try { sessionStorage.setItem(k, JSON.stringify(p)); } catch {}
  window.dispatchEvent(new Event(TRIAL_EVENT));
}

/** Ticks a step of the guided first run. Does nothing for real accounts. */
export function markTrialStep(step: TrialStep) {
  const p = getTrialProgress();
  if (!p[step] && key()) save({ ...p, [step]: true });
}

export function dismissTrialGuide() {
  save({ ...getTrialProgress(), dismissed: true });
}
