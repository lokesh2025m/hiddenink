"use client";
import { useEffect, useState } from "react";
import { getTrialProgress, TRIAL_EVENT, TrialProgress } from "@/lib/trial";

export function useTrialProgress(): TrialProgress {
  const [progress, setProgress] = useState<TrialProgress>({});
  useEffect(() => {
    const update = () => setProgress(getTrialProgress());
    update();
    window.addEventListener(TRIAL_EVENT, update);
    return () => window.removeEventListener(TRIAL_EVENT, update);
  }, []);
  return progress;
}
