"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getToken, getUser, User } from "@/lib/api";

export function useRequireAuth(): User | null {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    if (!getToken()) router.replace("/login");
    else setUser(getUser());
  }, [router]);
  return user;
}
