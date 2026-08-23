"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL, buildApiUrl } from "@/lib/api";

interface User {
  id: number;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<AuthResult>;
  register: (username: string, email: string, password: string, firstName?: string, lastName?: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  getAuthHeaders: () => { Authorization: string } | {};
  authenticatedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type AuthResult = {
  ok: boolean;
  error?: string;
};

async function getApiError(res: Response) {
  const data = await res.json().catch(() => null);
  if (!data) return `Erreur serveur (${res.status}).`;
  if (typeof data.detail === "string") return data.detail;
  if (typeof data.error === "string") return data.error;
  const messages = Object.entries(data)
    .flatMap(([field, value]) => {
      if (Array.isArray(value)) return value.map((message) => `${field}: ${message}`);
      if (typeof value === "string") return [`${field}: ${value}`];
      return [];
    })
    .filter(Boolean);
  return messages.join(" ") || `Erreur serveur (${res.status}).`;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const refreshRequestRef = useRef<Promise<string | null> | null>(null);
  const router = useRouter();

  const clearSession = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("refresh_token");
    setToken(null);
    setUser(null);
  };

  const refreshAccessToken = async (): Promise<string | null> => {
    if (refreshRequestRef.current) return refreshRequestRef.current;

    const storedRefreshToken = localStorage.getItem("refresh_token");
    if (!storedRefreshToken) return null;

    const request = (async () => {
      try {
        const response = await fetch(buildApiUrl(`/api/auth/token/refresh/`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh: storedRefreshToken }),
        });
        if (!response.ok) return null;

        const data = await response.json() as { access?: string; refresh?: string };
        if (!data.access) return null;
        localStorage.setItem("token", data.access);
        if (data.refresh) localStorage.setItem("refresh_token", data.refresh);
        setToken(data.access);
        return data.access;
      } catch {
        return null;
      } finally {
        refreshRequestRef.current = null;
      }
    })();

    refreshRequestRef.current = request;
    return request;
  };

  const authenticatedFetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {}
  ): Promise<Response> => {
    const currentToken = localStorage.getItem("token") || token;
    const headers = new Headers(init.headers);
    if (currentToken) headers.set("Authorization", `Bearer ${currentToken}`);

    const response = await fetch(input, { ...init, headers });
    if (response.status !== 401) return response;

    const renewedToken = await refreshAccessToken();
    if (!renewedToken) {
      clearSession();
      router.push("/login");
      return response;
    }

    const retryHeaders = new Headers(init.headers);
    retryHeaders.set("Authorization", `Bearer ${renewedToken}`);
    return fetch(input, { ...init, headers: retryHeaders });
  };

  useEffect(() => {
    const storedToken = localStorage.getItem("token");
    if (storedToken) {
      setToken(storedToken);
      fetchUser(storedToken);
    } else {
      setLoading(false);
    }
  }, []);

  // Le jeton d'accès dure 30 minutes. `authenticatedFetch` sait rejouer un 401,
  // mais l'éditeur émet la plupart de ses requêtes avec `fetch` brut : sans
  // renouvellement en arrière-plan, une session d'édition d'une demi-heure
  // commencerait à échouer. Renouveler ici couvre tous les appelants d'un coup,
  // plutôt que de réécrire chaque appel.
  useEffect(() => {
    if (!token) return;
    const REFRESH_INTERVAL_MS = 20 * 60 * 1000;
    const timer = window.setInterval(() => {
      void refreshAccessToken();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [token]);

  const fetchUser = async (authToken: string) => {
    try {
      let res = await fetch(buildApiUrl(`/api/auth/me/`), {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      if (res.status === 401) {
        const renewedToken = await refreshAccessToken();
        if (renewedToken) {
          res = await fetch(buildApiUrl(`/api/auth/me/`), {
            headers: { Authorization: `Bearer ${renewedToken}` },
          });
        }
      }
      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
      } else {
        clearSession();
        router.push("/login");
      }
    } catch (err) {
      console.error("Failed to fetch user:", err);
      clearSession();
      router.push("/login");
    } finally {
      setLoading(false);
    }
  };

  const login = async (username: string, password: string): Promise<AuthResult> => {
    try {
      const res = await fetch(buildApiUrl(`/api/auth/token/`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem("token", data.access);
        if (data.refresh) localStorage.setItem("refresh_token", data.refresh);
        setToken(data.access);
        await fetchUser(data.access);
        router.push("/dashboard");
        return { ok: true };
      }
      return { ok: false, error: await getApiError(res) };
    } catch (err) {
      console.error("Login request failed:", err);
      return {
        ok: false,
        error: `Impossible de joindre le backend Django sur ${API_BASE_URL || "l'URL relative /api"}. Vérifiez que le serveur est accessible.`,
      };
    }
  };

  const register = async (username: string, email: string, password: string, firstName = "", lastName = ""): Promise<AuthResult> => {
    try {
      const res = await fetch(buildApiUrl(`/api/auth/register/`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          email,
          password,
          first_name: firstName,
          last_name: lastName,
        }),
      });
      if (res.ok) {
        // Auto login on successful registration
        return await login(username, password);
      }
      return { ok: false, error: await getApiError(res) };
    } catch (err) {
      console.error("Registration request failed:", err);
      return {
        ok: false,
        error: `Impossible de joindre le backend Django sur ${API_BASE_URL || "l'URL relative /api"}. Vérifiez que le serveur est accessible.`,
      };
    }
  };

  const logout = async () => {
    // Le serveur met le jeton de rafraîchissement sur liste noire : sans cet
    // appel, une copie prise avant la déconnexion resterait échangeable
    // pendant sept jours. L'effacement local seul ne prouve rien.
    const refreshToken = localStorage.getItem("refresh_token");
    const accessToken = localStorage.getItem("token") || token;
    if (refreshToken && accessToken) {
      try {
        await fetch(`${API_BASE_URL}/api/auth/logout/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ refresh: refreshToken }),
        });
      } catch (err) {
        // Serveur injoignable : la session locale est fermée quand même,
        // sinon l'utilisateur resterait connecté dans son navigateur.
        console.error("Logout request failed:", err);
      }
    }
    clearSession();
    router.push("/login");
  };

  const getAuthHeaders = () => {
    const currentToken = localStorage.getItem("token") || token;
    return currentToken ? { Authorization: `Bearer ${currentToken}` } : {};
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, getAuthHeaders, authenticatedFetch }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
