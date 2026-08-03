"use client";

import React, { useState } from "react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { buildApiUrl } from "@/lib/api";
import { ArrowLeft, Upload, FileText, ImageIcon, CheckCircle } from "lucide-react";

export default function NewPlanPage() {
  const { getAuthHeaders } = useAuth();
  const router = useRouter();
  
  const [title, setTitle] = useState("");
  const [buildingName, setBuildingName] = useState("");
  const [floorName, setFloorName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const getErrorMessage = async (res: Response) => {
    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const errorData = await res.json();
      return errorData.detail || errorData.error || JSON.stringify(errorData);
    }

    const text = await res.text();
    if (text.includes("<!DOCTYPE") || text.includes("<html")) {
      return `Erreur serveur ${res.status}. Vérifiez que le backend Django accepte bien ce fichier PDF.`;
    }

    return text || "Une erreur est survenue lors de la création.";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Veuillez sélectionner un fichier de fond de plan (image ou PDF).");
      return;
    }

    setLoading(true);
    setError("");

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const fileType = isPdf ? "pdf" : "image";

    const formData = new FormData();
    formData.append("title", title);
    formData.append("building_name", buildingName);
    formData.append("floor_name", floorName);
    formData.append("background_file", file);
    formData.append("background_type", fileType);

    try {
      const headers = getAuthHeaders() as Record<string, string>;
      const res = await fetch(buildApiUrl(`/api/plans/`), {
        method: "POST",
        headers: {
          ...headers,
          // Do NOT set Content-Type header when uploading files; browser will set it with boundary
        },
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        router.push(`/evacuation-plans/${data.id}/editor`);
      } else {
        setError(await getErrorMessage(res));
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
      setError("Impossible de joindre le serveur.");
      setLoading(false);
    }
  };

  return (
    <ProtectedRoute>
      <div className="flex min-h-screen flex-col bg-white">
        <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/90 backdrop-blur-md">
          <div className="flex h-16 items-center px-6">
            <Link href="/dashboard" className="flex items-center space-x-2 text-sm text-slate-600 transition-colors hover:text-safety-green">
              <ArrowLeft className="h-4 w-4" />
              <span>Retour au tableau de bord</span>
            </Link>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
            <h1 className="text-2xl font-bold text-slate-950 mb-2">Nouveau Plan d'Évacuation</h1>
            <p className="text-slate-500 text-sm mb-6">Définissez les détails et importez le dessin de base de votre bâtiment.</p>

            {error && (
              <div className="mb-6 rounded-lg bg-safety-red/10 border border-safety-red/20 p-4 text-sm text-safety-red">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
                    Nom du plan
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="block w-full rounded-xl border border-slate-300 bg-white py-3 px-4 text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none focus:ring-2 focus:ring-safety-green/20 sm:text-sm"
                    placeholder="Ex: Plan d'Évacuation Principal - RDC"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
                    Bâtiment / Site
                  </label>
                  <input
                    type="text"
                    required
                    value={buildingName}
                    onChange={(e) => setBuildingName(e.target.value)}
                    className="block w-full rounded-xl border border-slate-300 bg-white py-3 px-4 text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none focus:ring-2 focus:ring-safety-green/20 sm:text-sm"
                    placeholder="Ex: Bâtiment A"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
                    Étage / Zone
                  </label>
                  <input
                    type="text"
                    required
                    value={floorName}
                    onChange={(e) => setFloorName(e.target.value)}
                    className="block w-full rounded-xl border border-slate-300 bg-white py-3 px-4 text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none focus:ring-2 focus:ring-safety-green/20 sm:text-sm"
                    placeholder="Ex: Rez-de-chaussée"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
                  Fichier de fond de plan (Image ou PDF)
                </label>
                <div className="group relative mt-1 flex cursor-pointer justify-center rounded-xl border-2 border-dashed border-green-200 bg-green-50/40 px-6 pb-6 pt-5 transition-colors hover:border-safety-green">
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    required
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="space-y-1 text-center">
                    {file ? (
                      <div className="flex flex-col items-center">
                        <CheckCircle className="mx-auto h-12 w-12 text-safety-green mb-2" />
                        <p className="text-sm font-semibold text-slate-950 truncate max-w-xs">{file.name}</p>
                        <p className="text-xs text-slate-500 mt-1">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                      </div>
                    ) : (
                      <>
                        <Upload className="mx-auto h-12 w-12 text-safety-green transition-colors" />
                        <div className="flex text-sm text-slate-500 justify-center">
                          <span className="relative rounded-md font-semibold text-safety-green transition-colors group-hover:text-green-700">
                            Sélectionner un fichier
                          </span>
                        </div>
                        <p className="text-xs text-slate-500">PNG, JPG, SVG ou PDF jusqu'à 10MB</p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex cursor-pointer items-center justify-center space-x-2 rounded-xl bg-safety-green px-6 py-3 font-semibold text-white shadow-lg shadow-safety-green/10 transition-all hover:bg-green-600 disabled:opacity-50"
                >
                  {loading ? "Création en cours..." : "Créer le plan & Ouvrir l'éditeur"}
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
