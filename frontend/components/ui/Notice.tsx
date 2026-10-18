"use client";
import { ReactNode } from "react";

type Kind = "success" | "error" | "info";
const STYLE: Record<Kind, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-rose-200 bg-rose-50 text-rose-800",
  info: "border-ink-100 bg-ink-50 text-ink-900",
};
const ICON_BG: Record<Kind, string> = { success: "bg-emerald-500", error: "bg-rose-500", info: "bg-uv-500" };
const ICON: Record<Kind, ReactNode> = {
  success: <path d="m5 12 4 4 10-10" />,
  error: <><path d="M12 7v6" /><path d="M12 17h.01" /></>,
  info: <><path d="M12 11v6" /><path d="M12 7h.01" /></>,
};

/**
 * A rounded banner with an icon that slides in from the right. `floating` pins it to the top-right
 * corner as a toast (below the sticky navbar).
 */
export default function Notice({ kind, children, onDismiss, floating = false, role }: {
  kind: Kind; children: ReactNode; onDismiss?: () => void; floating?: boolean; role?: "status" | "alert";
}) {
  return (
    <div role={role ?? (kind === "error" ? "alert" : "status")}
      className={`animate-slide-in flex items-start gap-3 rounded-2xl border p-3.5 text-sm shadow-sm ${STYLE[kind]} ${floating ? "fixed right-4 top-20 z-40 max-w-sm shadow-lg" : ""}`}>
      <span aria-hidden className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-white ${ICON_BG[kind]}`}>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">{ICON[kind]}</svg>
      </span>
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-m-1 rounded-lg p-1 opacity-60 hover:opacity-100">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      )}
    </div>
  );
}
