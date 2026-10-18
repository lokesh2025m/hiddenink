"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, clearSession, getUser, User } from "@/lib/api";

const LINKS = [
  { href: "/", label: "Scan" },
  { href: "/history", label: "Review log" },
  { href: "/lab", label: "Red-Team Lab" },
  { href: "/eval", label: "Evaluation" },
];

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-display text-[1.05rem] font-bold tracking-tight text-ink-900">
      <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-uv-500 to-glow-400 text-sm font-bold text-white shadow-[0_2px_10px_-2px_rgba(139,92,246,0.6)]">
        H
      </span>
      HiddenInk
    </Link>
  );
}

export default function Nav() {
  const path = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { setUser(getUser()); setOpen(false); }, [path]);

  async function signOut() {
    // A demo's org and log are deleted on sign-out; failures are ignored (stale demos are purged after 24 hours).
    if (user?.is_demo) await api("/api/auth/demo/end", { method: "POST" }).catch(() => {});
    clearSession();
    router.push("/login");
  }

  // The login page is a full-screen landing with its own logo.
  if (path === "/login") return null;

  const linkClass = (href: string) =>
    `rounded-full px-3 py-1.5 transition-colors ${path === href ? "bg-uv-500/10 font-medium text-uv-700" : "text-gray-600 hover:bg-ink-50 hover:text-ink-900"}`;
  const upgrade = user?.is_demo && path !== "/upgrade";

  return (
    <header className="sticky top-0 z-20 border-b border-ink-500/10 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Logo />
        {user && (
          <nav className="hidden gap-1 text-sm sm:flex" aria-label="Main">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className={linkClass(l.href)} aria-current={path === l.href ? "page" : undefined}>{l.label}</Link>
            ))}
          </nav>
        )}
        <div className="ml-auto hidden items-center gap-3 text-sm sm:flex">
          {user ? (
            <>
              <span className="hidden text-gray-500 md:inline">{user.is_demo ? "Free trial" : user.org_name}</span>
              {upgrade && <Link className="btn-primary py-1" href="/upgrade">Create free account</Link>}
              <button className="btn-secondary py-1" onClick={signOut}>Sign out</button>
            </>
          ) : path !== "/login" ? <Link className="btn-primary py-1" href="/login">Sign in</Link> : null}
        </div>

        {/* Under 640px: a hamburger menu with the same links and actions. */}
        {(user || path !== "/login") && (
          <button type="button" className="ml-auto grid h-9 w-9 place-items-center rounded-lg text-ink-900 hover:bg-ink-50 sm:hidden"
            aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((o) => !o)}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        )}
      </div>
      {open && (
        <div id="mobile-menu" className="animate-fade-up border-t border-ink-500/10 bg-white/95 px-4 pb-4 pt-2 sm:hidden">
          {user ? (
            <>
              <nav className="flex flex-col gap-1 text-sm" aria-label="Main">
                {LINKS.map((l) => (
                  <Link key={l.href} href={l.href} className={linkClass(l.href)} aria-current={path === l.href ? "page" : undefined}>{l.label}</Link>
                ))}
              </nav>
              <div className="mt-3 flex flex-col gap-2 border-t border-gray-100 pt-3 text-sm">
                <span className="text-xs text-gray-500">{user.is_demo ? "Free trial" : user.org_name}</span>
                {upgrade && <Link className="btn-primary" href="/upgrade">Create free account</Link>}
                <button className="btn-secondary" onClick={signOut}>Sign out</button>
              </div>
            </>
          ) : <Link className="btn-primary w-full" href="/login">Sign in</Link>}
        </div>
      )}
    </header>
  );
}
