"use client";

import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import Link from "next/link";
import { AlertTriangle, Lock, User as UserIcon } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";

const SHOW_REGISTER_ENTRY_POINTS = true;

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = await login(username, password);
    if (!result.ok) {
      setError(result.error || "Identifiants incorrects. Veuillez réessayer.");
      setLoading(false);
    }
  };

  return (
    <div className="brand-page-bg flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-brand-orange/20 bg-white p-8 shadow-[0_28px_80px_rgba(145,60,15,0.16)]">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-brand-red via-brand-orange to-brand-gold" />

        <div className="flex flex-col items-center">
          <div className="mb-5 flex h-24 w-64 items-center justify-center overflow-hidden rounded-xl bg-white">
            <BrandLogo className="h-full w-full" priority />
          </div>
          <h2 className="text-center text-3xl font-extrabold tracking-tight text-brand-ink">
            Plan intervention et évacuation
          </h2>
          <p className="mt-2 text-center text-sm text-stone-500">
            Connectez-vous pour gérer vos plans d&apos;intervention et d&apos;évacuation.
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="flex items-center space-x-2 rounded-lg bg-safety-red/10 border border-safety-red/20 p-3 text-sm text-safety-red">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-4 rounded-md shadow-sm">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                Nom d&apos;utilisateur
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                  <UserIcon className="h-5 w-5" />
                </div>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="block w-full rounded-xl border border-stone-300 bg-white py-3 pl-10 pr-3 text-brand-ink placeholder-stone-400 focus:border-brand-orange focus:outline-none focus:ring-2 focus:ring-brand-orange/20 sm:text-sm"
                  placeholder="admin, inspecteur..."
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                Mot de passe
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                  <Lock className="h-5 w-5" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full rounded-xl border border-stone-300 bg-white py-3 pl-10 pr-3 text-brand-ink placeholder-stone-400 focus:border-brand-orange focus:outline-none focus:ring-2 focus:ring-brand-orange/20 sm:text-sm"
                  placeholder="••••••••"
                />
              </div>
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="brand-action group relative flex w-full cursor-pointer justify-center rounded-xl px-4 py-3 text-sm font-semibold text-white transition-transform duration-200 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-brand-orange focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Connexion en cours..." : "Se connecter"}
            </button>
          </div>
        </form>

        {SHOW_REGISTER_ENTRY_POINTS && (
          <div className="mt-4 text-center text-sm text-stone-500">
            Nouveau sur Plan intervention et évacuation ?{" "}
            <Link href="/register" className="font-semibold text-brand-red transition-colors hover:text-brand-orange">
              Créer un compte
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
