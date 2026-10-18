"use client";
import { usePathname } from "next/navigation";

/** Fades each page's content up when it loads. Keyed by route, so it replays on navigation (but not on ?tab= changes). */
export default function PageFade({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return <div key={path} className="animate-fade-up">{children}</div>;
}
