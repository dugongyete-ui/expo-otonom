/**
 * Authentication Service for Dzeck AI
 * Handles JWT token storage, login/register/logout API calls
 * Uses SecureStore on native, falls back to in-memory for web
 */
import { Platform } from "react-native";
import { getApiBaseUrl } from "./api-service";
import { setMemoryToken } from "./token-store";

let SecureStore: typeof import("expo-secure-store") | null = null;
if (Platform.OS !== "web") {
  try {
    SecureStore = require("expo-secure-store");
  } catch {
    SecureStore = null;
  }
}

export interface AuthUser {
  id: string;
  email: string;
  fullname: string;
  role: "user" | "admin";
}

export interface LoginResult {
  user: AuthUser;
  access_token: string;
  refresh_token: string;
}

const ACCESS_TOKEN_KEY = "dzeck_access_token";
const REFRESH_TOKEN_KEY = "dzeck_refresh_token";
const USER_KEY = "dzeck_user";

const webStore: Record<string, string> = {};

let _memoryAccessToken: string | null = null;

export function getMemoryAccessToken(): string | null {
  return _memoryAccessToken;
}

async function secureGet(key: string): Promise<string | null> {
  try {
    if (SecureStore) return await SecureStore.getItemAsync(key);
    if (typeof localStorage !== "undefined") return localStorage.getItem(key);
    return webStore[key] ?? null;
  } catch {
    return null;
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  try {
    if (SecureStore) { await SecureStore.setItemAsync(key, value); return; }
    if (typeof localStorage !== "undefined") { localStorage.setItem(key, value); return; }
    webStore[key] = value;
  } catch {
    // ignore storage errors
  }
}

async function secureDel(key: string): Promise<void> {
  try {
    if (SecureStore) { await SecureStore.deleteItemAsync(key); return; }
    if (typeof localStorage !== "undefined") { localStorage.removeItem(key); return; }
    delete webStore[key];
  } catch {
    // ignore
  }
}

class AuthService {
  async getAuthMode(): Promise<"password" | "local" | "none"> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/auth/status`);
      if (res.ok) {
        const data = await res.json();
        return data.auth_provider || "none";
      }
    } catch {
      // ignore
    }
    return "none";
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const res = await fetch(`${getApiBaseUrl()}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    await this.storeTokens(data.access_token, data.refresh_token, data.user);
    return data;
  }

  async register(email: string, password: string, fullname: string): Promise<LoginResult> {
    const res = await fetch(`${getApiBaseUrl()}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, fullname }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");
    await this.storeTokens(data.access_token, data.refresh_token, data.user);
    return data;
  }

  async logout(): Promise<void> {
    try {
      const token = await this.getAccessToken();
      if (token) {
        await fetch(`${getApiBaseUrl()}/api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {
      // ignore logout errors
    }
    await this.clearTokens();
  }

  async getMe(): Promise<AuthUser | null> {
    const token = await this.getAccessToken();
    if (!token) return null;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  async refreshToken(): Promise<string | null> {
    const refreshToken = await this.getRefreshToken();
    if (!refreshToken) return null;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.access_token) {
        _memoryAccessToken = data.access_token;
        setMemoryToken(data.access_token);
        await secureSet(ACCESS_TOKEN_KEY, data.access_token);
        return data.access_token;
      }
    } catch {
      // ignore
    }
    return null;
  }

  async resetPassword(email: string): Promise<void> {
    await fetch(`${getApiBaseUrl()}/api/auth/request-password-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  }

  async getAccessToken(): Promise<string | null> {
    return secureGet(ACCESS_TOKEN_KEY);
  }

  async getRefreshToken(): Promise<string | null> {
    return secureGet(REFRESH_TOKEN_KEY);
  }

  async getStoredUser(): Promise<AuthUser | null> {
    try {
      const raw = await secureGet(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async storeTokens(accessToken: string, refreshToken: string, user: AuthUser): Promise<void> {
    _memoryAccessToken = accessToken;
    setMemoryToken(accessToken);
    await secureSet(ACCESS_TOKEN_KEY, accessToken);
    await secureSet(REFRESH_TOKEN_KEY, refreshToken);
    await secureSet(USER_KEY, JSON.stringify(user));
  }

  async clearTokens(): Promise<void> {
    _memoryAccessToken = null;
    setMemoryToken(null);
    await secureDel(ACCESS_TOKEN_KEY);
    await secureDel(REFRESH_TOKEN_KEY);
    await secureDel(USER_KEY);
  }

  async isAuthenticated(): Promise<boolean> {
    const mode = await this.getAuthMode();
    if (mode === "none") return true;
    const token = await this.getAccessToken();
    return !!token;
  }

  getAuthHeader(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }
}

export const authService = new AuthService();
