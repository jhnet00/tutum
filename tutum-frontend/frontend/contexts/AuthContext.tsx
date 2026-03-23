"use client";

import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from "react";
import { getAuthApiBase } from "@/lib/auth-endpoint";

interface User {
  id: string;
  email: string;
  nickname: string;
  profile_image?: string;
  created_at?: string;
  updated_at?: string;
  marketing_opt_in?: boolean;
  login_type?: string;
}

interface LoginResult {
  success: boolean;
  error?: string;
  isUnverified?: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  updateUser: (data: Partial<User>) => void;
  refreshUser: () => Promise<void>;
  sessionExpiry: number | null;
  extendSession: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function parseErrorMessage(raw: unknown, fallback: string): string {
  if (typeof raw === "string" && raw.trim()) return raw;
  if (raw && typeof raw === "object" && "detail" in raw) {
    const detail = (raw as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return fallback;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionExpiry, setSessionExpiry] = useState<number | null>(null);

  const API_URL = getAuthApiBase();
  const ACCESS_TOKEN_TTL_MS = 120 * 60 * 1000;
  const pendingControllersRef = useRef<Set<AbortController>>(new Set());

  const apiFetch = useCallback(
    async (path: string, init: RequestInit = {}, timeoutMs = 10000) => {
      const controller = new AbortController();
      pendingControllersRef.current.add(controller);
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${API_URL}${path}`, {
          ...init,
          signal: controller.signal,
        });
        return response;
      } finally {
        clearTimeout(timeoutId);
        pendingControllersRef.current.delete(controller);
      }
    },
    [API_URL]
  );

  useEffect(() => {
    return () => {
      pendingControllersRef.current.forEach((controller) => controller.abort());
      pendingControllersRef.current.clear();
    };
  }, []);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    try {
      const response = await apiFetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "include",
        headers: {
          "X-CSRF-Token":
            typeof document !== "undefined"
              ? document.cookie
                  .split("; ")
                  .find((row) => row.startsWith("csrf_token="))
                  ?.split("=")[1] || ""
              : "",
        },
      });

      if (!response.ok) return null;

      const data = await response.json();
      const newAccessToken = typeof data?.access_token === "string" ? data.access_token : null;
      if (newAccessToken) setToken(newAccessToken);
      return newAccessToken;
    } catch {
      return null;
    }
  }, [apiFetch]);

  const fetchMe = useCallback(
    async (authToken?: string, clearOnFail = true) => {
      try {
        const headers: Record<string, string> = {};
        if (authToken) headers.Authorization = `Bearer ${authToken}`;

        const response = await apiFetch("/api/v1/auth/me", {
          headers,
          credentials: "include",
        });

        if (!response.ok) {
          if (!clearOnFail) return false;
          setUser(null);
          setToken(null);
          sessionStorage.removeItem("user");
          return false;
        }

        const userData = await response.json();
        setUser(userData);
        if (authToken) setToken(authToken);
        sessionStorage.setItem("user", JSON.stringify(userData));

        const savedExpiry = localStorage.getItem("session_expiry");
        if (savedExpiry && Number(savedExpiry) > Date.now()) {
          setSessionExpiry(Number(savedExpiry));
        } else {
          const newExpiry = Date.now() + ACCESS_TOKEN_TTL_MS;
          setSessionExpiry(newExpiry);
          localStorage.setItem("session_expiry", String(newExpiry));
        }

        return true;
      } catch {
        return false;
      }
    },
    [apiFetch, ACCESS_TOKEN_TTL_MS]
  );

  const logout = useCallback(async () => {
    try {
      pendingControllersRef.current.forEach((controller) => controller.abort());
      pendingControllersRef.current.clear();

      await apiFetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore logout network errors.
    }

    // 클라이언트 접근 가능 쿠키 직접 정리 (httpOnly 쿠키는 서버 응답으로 삭제)
    if (typeof document !== "undefined") {
      document.cookie = "csrf_token=; path=/; max-age=0";
    }

    setUser(null);
    setToken(null);
    setSessionExpiry(null);
    sessionStorage.clear();
    localStorage.removeItem("session_expiry");

    window.location.replace("/");
  }, [apiFetch]);

  const extendSession = useCallback(() => {
    if (!sessionExpiry) return;
    const newExpiry = Math.max(sessionExpiry, Date.now()) + 30 * 60 * 1000;
    setSessionExpiry(newExpiry);
    localStorage.setItem("session_expiry", String(newExpiry));
  }, [sessionExpiry]);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const savedUser = sessionStorage.getItem("user");
        if (savedUser && savedUser !== "undefined") {
          try {
            setUser(JSON.parse(savedUser));
          } catch {
            sessionStorage.removeItem("user");
          }
        }

        const savedExpiry = localStorage.getItem("session_expiry");
        if (savedExpiry) setSessionExpiry(Number(savedExpiry));

        let ok = await fetchMe(undefined, false);
        
        // 쿠키로 인증되었더라도, 상태(token)를 채우기 위해 리프레시 시도
        if (ok && !token) {
          await refreshAccessToken();
        } else if (!ok) {
          const refreshed = await refreshAccessToken();
          ok = await fetchMe(refreshed || undefined, false);
        }

        if (!ok) {
          setUser(null);
          setToken(null);
          sessionStorage.removeItem("user");
        }
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, [fetchMe, refreshAccessToken]);

  // Keep session warm while user is active to reduce forced re-login.
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(async () => {
      const refreshed = await refreshAccessToken();
      const ok = await fetchMe(refreshed || undefined, false);
      if (ok) {
        const newExpiry = Date.now() + ACCESS_TOKEN_TTL_MS;
        setSessionExpiry(newExpiry);
        localStorage.setItem("session_expiry", String(newExpiry));
      } else {
        await logout();
      }
    }, 15 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user, fetchMe, refreshAccessToken, logout, ACCESS_TOKEN_TTL_MS]);

  useEffect(() => {
    if (!user || !sessionExpiry) return;

    const interval = setInterval(() => {
      if (Date.now() > sessionExpiry) {
        logout();
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [user, sessionExpiry, logout]);



  const login = async (email: string, password: string): Promise<LoginResult> => {
    try {
      const response = await apiFetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        let payload: unknown = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }

        if (response.status === 429) {
          return { success: false, error: "Too many attempts. Please wait and try again." };
        }

        return {
          success: false,
          error: parseErrorMessage(payload, "Login failed."),
          isUnverified: response.status === 403
        };
      }

      const data = await response.json();
      const accessToken = typeof data?.access_token === "string" ? data.access_token : undefined;
      const ok = await fetchMe(accessToken, false);
      if (!ok) return { success: false, error: "Unable to load profile after login." };

      return { success: true };
    } catch {
      return { success: false, error: "Network error while logging in." };
    }
  };

  const updateUser = (data: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return null;
      const updated = { ...prev, ...data };
      sessionStorage.setItem("user", JSON.stringify(updated));
      return updated;
    });
  };

  const refreshUser = async () => {
    const refreshed = await refreshAccessToken();
    await fetchMe(refreshed || undefined, false);
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, sessionExpiry, login, logout, updateUser, refreshUser, extendSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
