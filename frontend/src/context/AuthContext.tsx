"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useRouter } from "next/navigation";

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
  logout: () => void;
  getAuthHeaders: () => { Authorization: string } | {};
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

import { API_URL } from "@/lib/api";

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
  const router = useRouter();

  useEffect(() => {
    const storedToken = localStorage.getItem("token");
    if (storedToken) {
      setToken(storedToken);
      fetchUser(storedToken);
    } else {
      setLoading(false);
    }
  }, []);

  const fetchUser = async (authToken: string) => {
    try {
      const res = await fetch(`${API_URL}/api/auth/me/`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
      } else {
        // Token might be expired
        logout();
      }
    } catch (err) {
      console.error("Failed to fetch user:", err);
      logout();
    } finally {
      setLoading(false);
    }
  };

  const login = async (username: string, password: string): Promise<AuthResult> => {
    try {
      const res = await fetch(`${API_URL}/api/auth/token/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem("token", data.access);
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
        error: `Impossible de joindre le backend Django sur ${API_URL}. Vérifiez que le serveur est lancé sur le port 8000.`,
      };
    }
  };

  const register = async (username: string, email: string, password: string, firstName = "", lastName = ""): Promise<AuthResult> => {
    try {
      const res = await fetch(`${API_URL}/api/auth/register/`, {
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
        error: `Impossible de joindre le backend Django sur ${API_URL}. Vérifiez que le serveur est lancé sur le port 8000.`,
      };
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
    router.push("/login");
  };

  const getAuthHeaders = () => {
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, getAuthHeaders }}>
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
