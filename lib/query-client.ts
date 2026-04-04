import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getMemoryToken } from "./token-store";

/**
 * Gets the base URL for the Express API server (e.g., "https://my-app.replit.dev")
 *
 * Resolution order:
 *   1. EXPO_PUBLIC_DOMAIN env var (explicit domain — set this in .env for Expo Go on
 *      a physical device, e.g., your-project.username.repl.co or a Replit dev domain)
 *   2. Browser's window.location.origin — used in web/preview mode when running
 *      inside the Replit web preview iframe (relative URL makes sense)
 *   3. EXPO_PUBLIC_REPLIT_DEV_DOMAIN — Replit dev domain exposed via public env var
 *      (useful as fallback when EXPO_PUBLIC_DOMAIN is not explicitly set)
 *   4. localhost:{EXPO_PUBLIC_API_PORT|5000} — last-resort fallback for local dev
 *      NOTE: This does NOT work for Expo Go on a physical device — set EXPO_PUBLIC_DOMAIN
 *
 * @returns {string} The API base URL with trailing slash
 */
export function getApiUrl(): string {
  const host = process.env.EXPO_PUBLIC_DOMAIN;

  if (host) {
    const url = new URL(`https://${host}`);
    return url.href;
  }

  // In web/browser environments (Replit preview, web app), use the same origin
  // so relative API calls work without needing EXPO_PUBLIC_DOMAIN to be set.
  if (typeof window !== "undefined" && window.location?.origin) {
    const origin = window.location.origin;
    // Only use window.location if it looks like a real HTTP(S) origin (not file://)
    if (origin.startsWith("http://") || origin.startsWith("https://")) {
      return origin + "/";
    }
  }

  // Fallback to Replit dev domain (available as a public env var if set)
  const replitDevDomain = process.env.EXPO_PUBLIC_REPLIT_DEV_DOMAIN;
  if (replitDevDomain) {
    const url = new URL(`https://${replitDevDomain}`);
    return url.href;
  }

  // Last-resort localhost fallback — does NOT work for physical-device Expo Go.
  // Set EXPO_PUBLIC_DOMAIN in .env to enable physical-device connectivity.
  const port = process.env.EXPO_PUBLIC_API_PORT || "5000";
  if (__DEV__) {
    console.warn(
      "[getApiUrl] EXPO_PUBLIC_DOMAIN is not set. " +
      "Falling back to localhost — Expo Go on a physical device will NOT be able to connect. " +
      "Set EXPO_PUBLIC_DOMAIN in .env to your Replit dev domain."
    );
  }
  return `http://localhost:${port}/`;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

function _getStoredTokenForQueryClient(): string {
  const memToken = getMemoryToken();
  if (memToken) return memToken;
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem("dzeck_access_token") || "";
    }
  } catch {}
  return "";
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const token = _getStoredTokenForQueryClient();
  const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);

    const token = _getStoredTokenForQueryClient();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(url.toString(), {
      headers,
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
