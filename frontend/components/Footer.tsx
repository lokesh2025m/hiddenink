"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { onAuthChange, User } from "@/lib/api";

// Shown on signed-out pages only. Signed-in and trial users see the same message next to Save decision instead,
// and the login page shows it inside its own panel.
export default function Footer() {
  const path = usePathname();
  // undefined until read on the client, so signed-in users never see it flash in during hydration.
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthChange(setUser), []);
  if (user !== null || path === "/login") return null;
  return (
    <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-gray-500">
      HiddenInk flags hidden content for a human to review. It never rejects a candidate on its own.
    </footer>
  );
}
