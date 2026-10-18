// Small API client. The token lives in localStorage; it is a short-lived JWT, never the OpenAI key.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

const TOKEN_KEY = "hiddenink_token";
const USER_KEY = "hiddenink_user";

export type User = { id: string; email: string; org_id: string; org_name: string; is_demo: boolean };

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function getUser(): User | null {
  try { const u = localStorage.getItem(USER_KEY); return u ? JSON.parse(u) : null; } catch { return null; }
}
// The current scan (see components/ScanContext.tsx) is kept in sessionStorage and removed whenever the session ends.
export const SCAN_STORAGE_KEYS = ["hiddenink_scan", "hiddenink_scan_ui"] as const;
export const SESSION_CLEARED_EVENT = "hiddenink:session-cleared";

function clearScanStorage() {
  try { SCAN_STORAGE_KEYS.forEach((k) => sessionStorage.removeItem(k)); } catch {}
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_CLEARED_EVENT));
}

// Fired whenever this tab signs in or out; other tabs see the localStorage change as a "storage" event.
export const AUTH_CHANGED_EVENT = "hiddenink:auth-changed";

function authChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

/** Calls `cb` with the current user now and after every sign-in or sign-out (in this tab or another). */
export function onAuthChange(cb: (user: User | null) => void): () => void {
  const update = () => cb(getUser());
  const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === USER_KEY || e.key === TOKEN_KEY) update(); };
  update();
  window.addEventListener(AUTH_CHANGED_EVENT, update);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(AUTH_CHANGED_EVENT, update); window.removeEventListener("storage", onStorage); };
}

export function saveSession(token: string, user: User) {
  if (getUser()?.id !== user.id) clearScanStorage();
  try { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch {}
  authChanged();
}
export function clearSession() {
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch {}
  clearScanStorage();
  authChanged();
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Can't reach the HiddenInk server. Is the backend running?");
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") msg = body.detail;
      else if (Array.isArray(body.detail)) msg = body.detail.map((d: any) => d.msg).join("; ");
      else if (body.error) msg = body.error;
    } catch {}
    if (res.status === 401) clearSession();
    throw new ApiError(res.status, msg);
  }
  return res.json();
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function b64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}
