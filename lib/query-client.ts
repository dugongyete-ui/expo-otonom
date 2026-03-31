import { fetch } from "expo/fetch";
import { QueryClient, QueryFunction } from "@tanstack/react-query";

/**
 * Gets the base URL for the Express API server (e.g., "https://my-app.replit.dev")
 *
 * Resolution order:
 *   1. EXPO_PUBLIC_DOMAIN env var (explicit domain, e.g., your-project.replit.dev)
 *   2. Browser's window.location.origin — used in web/preview mode when running
 *      inside the Replit web preview iframe (relative URL makes sense)
 *   3. localhost:{EXPO_PUBLIC_API_PORT|5000} — local dev / Expo Go fallback
 *
 * @returns {string} The API base URL with trailing slash
 */
export function getApiUrl(): string {
  const host = process.env.EXPO_PUBLIC_DOMAIN;

  if (host) {
    // Use HTTPS for remote/Replit domains
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

  // Fallback to localhost for local development and Expo Go (native)
  const port = process.env.EXPO_PUBLIC_API_PORT || "5000";
  return `http://localhost:${port}/`;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const res = await fetch(url.toString(), {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
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

    const res = await fetch(url.toString(), {
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
