const TOKEN_KEY = "dzeck_access_token";
const REFRESH_KEY = "dzeck_refresh_token";

export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

export function getRefreshToken(): string {
  try { return localStorage.getItem(REFRESH_KEY) || ""; } catch { return ""; }
}

export function setTokens(access: string, refresh: string) {
  try {
    localStorage.setItem(TOKEN_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  } catch {}
}

export function clearTokens() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  } catch {}
}

export function isTokenValid(token: string): boolean {
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export async function getAuthMode(): Promise<"none" | "local" | "password"> {
  try {
    const res = await fetch("/api/auth/status");
    const data = await res.json();
    return data.auth_provider ?? "none";
  } catch {
    return "none";
  }
}

export async function loginApi(email: string, password: string) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Login failed");
  return data as { access_token: string; refresh_token: string; user: { email: string; fullname: string; role: string } };
}

export async function registerApi(email: string, password: string, fullname: string) {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, fullname }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Registration failed");
  return data as { access_token: string; refresh_token: string; user: { email: string; fullname: string; role: string } };
}

export async function logoutApi(token: string) {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {}
}
