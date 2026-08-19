"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/context/AuthContext";
import { buildApiUrl } from "@/lib/api";
import { Edit2, Eye, FileText, Plus, Trash2 } from "lucide-react";

interface EvacuationPlan {
  id: number;
  title: string;
  building_name: string;
  floor_name: string;
  background_file: string;
  cleaned_background_file?: string;
  use_cleaned_background?: boolean;
  background_type: string;
}

export default function EvacuationPlansPage() {
  const { loading: authLoading, token } = useAuth();
  const [plans, setPlans] = useState<EvacuationPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const getPlanAuthHeaders = (): Record<string, string> => {
    const authToken = token || (typeof window !== "undefined" ? localStorage.getItem("token") : null);
    return authToken ? { Authorization: `Bearer ${authToken}` } : {};
  };

  const fetchPlans = async () => {
    const headers = getPlanAuthHeaders();
    if (!("Authorization" in headers)) {
      if (!authLoading) {
        setLoading(false);
        setPlans([]);
      }
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch(buildApiUrl(`/api/plans/`), {
        headers,
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setPlans(Array.isArray(data) ? data : data.results || []);
      } else {
        setError("Impossible de charger la liste des plans.");
      }
    } catch {
      setError("Erreur de communication avec le serveur.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const storedToken = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!authLoading && (token || storedToken)) {
      void fetchPlans();
    }
  }, [authLoading, token]);

  useEffect(() => {
    const handleRefreshPlans = () => {
      const storedToken = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      if (!authLoading && (token || storedToken)) {
        void fetchPlans();
      }
    };

    window.addEventListener("evacuation-plans:refresh", handleRefreshPlans);
    window.addEventListener("focus", handleRefreshPlans);
    return () => {
      window.removeEventListener("evacuation-plans:refresh", handleRefreshPlans);
      window.removeEventListener("focus", handleRefreshPlans);
    };
  }, [authLoading, token]);

  const handleDelete = async (id: number) => {
    if (!confirm("Voulez-vous vraiment supprimer ce plan d'évacuation ?")) return;
    const res = await fetch(buildApiUrl(`/api/plans/${id}/`), {
      method: "DELETE",
      headers: getPlanAuthHeaders(),
    });
    if (res.ok) {
      setPlans((current) => current.filter((plan) => plan.id !== id));
    }
  };

  return (
    <AppShell>
      <PageHeader title="Plans d'évacuation" description="Créez, modifiez et exportez vos plans de sécurité.">
        <Link
          href="/evacuation-plans/new"
          className="brand-action inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" />
          Nouveau plan
        </Link>
      </PageHeader>

      <section className="brand-page-bg min-h-[calc(100vh-97px)] p-8 text-brand-ink">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <div className="h-9 w-9 animate-spin rounded-full border-4 border-brand-orange border-t-transparent" />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-700">
            {error}
          </div>
        ) : plans.length === 0 ? (
          <div className="rounded-2xl border border-brand-orange/15 bg-white p-10 text-center shadow-sm">
            <FileText className="mx-auto h-10 w-10 text-brand-orange" />
            <h2 className="mt-4 text-lg font-semibold text-brand-ink">Aucun plan</h2>
            <p className="mt-2 text-sm text-stone-500">Créez votre premier plan d&apos;évacuation.</p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {plans.map((plan) => {
              const previewUrl = plan.use_cleaned_background && plan.cleaned_background_file
                ? plan.cleaned_background_file
                : plan.background_file;
              return (
              <article key={plan.id} className="group overflow-hidden rounded-2xl border border-brand-orange/15 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-orange/35 hover:shadow-md">
                <Link href={`/evacuation-plans/${plan.id}/editor`} className="block">
                  <div className="relative flex h-44 items-center justify-center overflow-hidden border-b border-slate-100 bg-slate-50">
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt={plan.title}
                        className="h-full w-full object-contain p-2 transition-transform duration-300 group-hover:scale-[1.03]"
                        loading="lazy"
                      />
                    ) : (
                      <FileText className="h-12 w-12 text-slate-300" />
                    )}
                    <span className="absolute right-2 top-2 rounded-full bg-brand-orange/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
                      {plan.background_type.toUpperCase()}
                    </span>
                  </div>
                  <div className="p-4">
                    <h2 className="truncate text-base font-semibold text-brand-ink">{plan.title}</h2>
                    <p className="mt-0.5 truncate text-sm text-stone-500">
                      {plan.building_name}{plan.floor_name ? ` · ${plan.floor_name}` : ""}
                    </p>
                  </div>
                </Link>
                <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5">
                  <Link
                    href={`/evacuation-plans/${plan.id}/editor`}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-brand-red hover:text-brand-orange"
                  >
                    <Edit2 className="h-4 w-4" />
                    Éditer
                  </Link>
                  <div className="flex items-center gap-3">
                    <a href={plan.background_file} target="_blank" rel="noreferrer" title="Voir le fond de plan" className="text-slate-400 hover:text-brand-orange">
                      <Eye className="h-4 w-4" />
                    </a>
                    <button onClick={() => handleDelete(plan.id)} title="Supprimer" className="text-slate-400 hover:text-safety-red">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </article>
              );
            })}
          </div>
        )}
      </section>
    </AppShell>
  );
}
