/**
 * AuthContext - React Context for authentication state management
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { authService, AuthUser, getMemoryAccessToken } from "./auth-service";

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullname: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    initAuth();
  }, []);

  const initAuth = async () => {
    setIsLoading(true);
    try {
      // Populate in-memory token cache from SecureStore/localStorage for cross-platform auth header support
      const storedToken = await authService.getAccessToken();
      if (storedToken && !getMemoryAccessToken()) {
        const refreshToken = await authService.getRefreshToken();
        const storedUser = await authService.getStoredUser();
        await authService.storeTokens(
          storedToken,
          refreshToken || "",
          storedUser || { id: "", email: "", fullname: "", role: "user" }
        );
      }

      // First check if we already have a stored user (fast path)
      const storedUser = await authService.getStoredUser();
      if (storedUser) {
        setUser(storedUser);
        setIsLoading(false);
        // Silently refresh in background
        authService.getMe().then(fresh => { if (fresh) setUser(fresh); }).catch(() => {});
        return;
      }

      const mode = await authService.getAuthMode();
      if (mode === "none") {
        // Auto-login for no-auth mode
        const result = await authService.login("", "");
        setUser(result.user);
      }
      // For "local" and "password" modes with no stored user, user needs to login
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const login = useCallback(async (email: string, password: string) => {
    const result = await authService.login(email, password);
    setUser(result.user);
  }, []);

  const register = useCallback(async (email: string, password: string, fullname: string) => {
    const result = await authService.register(email, password, fullname);
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const fresh = await authService.getMe();
    if (fresh) setUser(fresh);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
