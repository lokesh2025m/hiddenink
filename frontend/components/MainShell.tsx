"use client";
import { usePathname } from "next/navigation";
import PageFade from "@/components/PageFade";

/** The page container. The login page is full-bleed, so it gets no width limit or padding. */
export default function MainShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const fullBleed = path === "/login";
  return (
    <main className={fullBleed ? "" : "mx-auto max-w-6xl px-4 pb-16 pt-6"}>
      <PageFade>{children}</PageFade>
    </main>
  );
}
