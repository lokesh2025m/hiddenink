"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getUser, User } from "@/lib/api";

/** Persistent privacy notice under the nav during a free trial. */
export default function TrialBanner() {
  const path = usePathname();
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => setUser(getUser()), [path]);
  if (!user?.is_demo) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50" role="note" aria-label="Trial privacy notice">
      <p className="mx-auto flex max-w-6xl items-start gap-2 px-4 py-2 text-xs text-amber-800">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-px shrink-0"><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" /><path d="M12 8v4M12 15h.01" /></svg>
        <span><span className="font-semibold">Trial mode:</span> everything you upload is deleted when you sign out or after 24 hours. Files are never added to the shared attack library.</span>
      </p>
    </div>
  );
}
