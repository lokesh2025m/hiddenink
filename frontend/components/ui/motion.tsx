"use client";
import { ReactNode, useEffect, useState } from "react";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Animates a number from 0 to `to` once, easing out. Jumps straight to the value with reduced motion. */
export function useCountUp(to: number, ms = 900): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion() || !Number.isFinite(to)) { setValue(to); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setValue(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return value;
}

/**
 * Counts up a formatted number such as "1,234", "87%", "4.5" or "–". Text that isn't a plain number
 * is shown as is. Screen readers get the final value straight away.
 */
export function CountUpText({ text }: { text: ReactNode }) {
  const m = typeof text === "string" ? /^(-?[\d,]*\.?\d+)(%?)$/.exec(text) : null;
  const target = m ? Number(m[1].replace(/,/g, "")) : NaN;
  const value = useCountUp(m ? target : 0);
  if (!m) return <>{text}</>;
  const decimals = (m[1].split(".")[1] || "").length;
  const shown = value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + m[2];
  return <><span aria-hidden>{shown}</span><span className="sr-only">{text}</span></>;
}
