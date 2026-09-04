"use client";

import React, { useState } from "react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { buildApiUrl } from "@/lib/api";
import { ArrowLeft, Upload, CheckCircle } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";

export default function NewPlanPage() {
  const { getAuthHeaders } = useAuth();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [buildingName, setBuildingName] = useState("");
  const [floorName, setFloorName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.[0]) {
      setFile(event.target.files[0]);
    }
  };

  const getErrorMessage = async (response: Response) => {
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const errorData = await response.json();
      return errorData.detail || errorData.error || JSON.stringify(errorData);
    }

    const text = await response.text();
    if (text.includes("<!DOCTYPE") || text.includes("<html")) {
      return `Erreur serveur ${response.status}. Vérifiez que le backend Django accepte bien ce fichier PDF.`;
    }

    return text || "Une erreur est survenue lors de la création.";
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError("Veuillez sélectionner un fichier de fond de plan (image ou PDF).");
      return;
    }

    setLoading(true);
    setError("");

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const formData = new FormData();
    formData.append("title", title);
    formData.append("building_name", buildingName);
    formData.append("floor_name", floorName);
    formData.append("background_file", file);
    formData.append("background_type", isPdf ? "pdf" : "image");

    try {
      const response = await fetch(buildApiUrl("/api/plans/"), {
        method: "POST",
        headers: getAuthHeaders() as Record<string, string>,
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        router.push(`/evacuation-plans/${data.id}/editor`);
        return;
      }

      setError(await getErrorMessage(response));
    } catch (requestError) {
      console.error(requestError);
      setError("Impossible de joindre le serveur.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ProtectedRoute>
      <div className="brand-page-bg flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 w-full border-b border-brand-orange/15 bg-white/90 backdrop-blur-md">
          <div className="flex h-20 items-center justify-between px-6">
            <Link href="/dashboard" className="flex items-center space-x-2 text-sm text-stone-600 transition-colors hover:text-brand-red">
              <ArrowLeft className="h-4 w-4" />
              <span>Retour au tableau de bord</span>
            </Link>
            <BrandLogo className="h-14 w-40 rounded-lg bg-white" priority />
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center p-6">
          <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-brand-orange/20 bg-white p-8 shadow-[0_28px_80px_rgba(145,60,15,0.14)]">
            <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-brand-red via-brand-orange to-brand-gold" />
            <h1 className="mb-2 text-2xl font-bold text-brand-ink">Nouveau plan de sécurité</h1>
            <p className="mb-6 text-sm text-stone-500">
              Importez le dessin de base. Le template et les informations réglementaires se règlent ensuite dans le studio.
            </p>

            {error && (
              <div className="mb-6 rounded-lg border border-safety-red/20 bg-safety-red/10 p-4 text-sm text-safety-red">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <label className="sm:col-span-2">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600">Nom du plan</span>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="block w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-brand-ink placeholder-stone-400 focus:border-brand-orange focus:outline-none focus:ring-2 focus:ring-brand-orange/20 sm:text-sm"
                    placeholder="Ex. Plan d’évacuation principal — RDC"
                  />
                </label>

                <label>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600">Bâtiment / Site</span>
                  <input
                    type="text"
                    required
                    value={buildingName}
                    onChange={(event) => setBuildingName(event.target.value)}
                    className="block w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-brand-ink placeholder-stone-400 focus:border-brand-orange focus:outline-none focus:ring-2 focus:ring-brand-orange/20 sm:text-sm"
                    placeholder="Ex. Bâtiment A"
                  />
                </label>

                <label>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600">Étage / Zone</span>
                  <input
                    type="text"
                    required
                    value={floorName}
                    onChange={(event) => setFloorName(event.target.value)}
                    className="block w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-brand-ink placeholder-stone-400 focus:border-brand-orange focus:outline-none focus:ring-2 focus:ring-brand-orange/20 sm:text-sm"
                    placeholder="Ex. Rez-de-chaussée"
                  />
                </label>
              </div>

              <div>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Fichier de fond du plan (image ou PDF)
                </span>
                <label className="group relative mt-1 flex cursor-pointer justify-center rounded-xl border-2 border-dashed border-brand-orange/30 bg-brand-cream/70 px-6 pb-6 pt-5 transition-colors hover:border-brand-orange">
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    required
                    onChange={handleFileChange}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                  <span className="space-y-1 text-center">
                    {file ? (
                      <span className="flex flex-col items-center">
                        <CheckCircle className="mx-auto mb-2 h-12 w-12 text-brand-orange" />
                        <span className="max-w-xs truncate text-sm font-semibold text-slate-950">{file.name}</span>
                        <span className="mt-1 text-xs text-slate-500">{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                      </span>
                    ) : (
                      <>
                        <Upload className="mx-auto h-12 w-12 text-brand-orange transition-colors" />
                        <span className="flex justify-center text-sm text-slate-500">
                          <span className="relative rounded-md font-semibold text-brand-red transition-colors group-hover:text-brand-orange">
                            Sélectionner un fichier
                          </span>
                        </span>
                        <span className="block text-xs text-slate-500">PNG, JPG, SVG ou PDF jusqu&apos;à 10 MB</span>
                      </>
                    )}
                  </span>
                </label>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="brand-action flex cursor-pointer items-center justify-center space-x-2 rounded-xl px-6 py-3 font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                >
                  {loading ? "Création en cours..." : "Créer le plan et ouvrir le studio"}
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
