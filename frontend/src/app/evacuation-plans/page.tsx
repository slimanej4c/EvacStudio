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
          className="inline-flex items-center gap-2 rounded-lg bg-safety-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-600"
        >
          <Plus className="h-4 w-4" />
          Nouveau plan
        </Link>
      </PageHeader>

      <section className="min-h-[calc(100vh-97px)] bg-white p-8 text-slate-950">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <div className="h-9 w-9 animate-spin rounded-full border-4 border-safety-green border-t-transparent" />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-700">
            {error}
          </div>
        ) : plans.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <FileText className="mx-auto h-10 w-10 text-safety-green" />
            <h2 className="mt-4 text-lg font-semibold text-slate-950">Aucun plan</h2>
            <p className="mt-2 text-sm text-slate-500">Créez votre premier plan d'évacuation.</p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {plans.map((plan) => (
              <article key={plan.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="truncate text-lg font-semibold text-slate-950">{plan.title}</h2>
                    <p className="text-sm text-slate-500">{plan.building_name} - {plan.floor_name}</p>
                  </div>
                  <span className="rounded-full bg-green-50 px-2 py-1 text-xs font-semibold text-safety-green">
                    {plan.background_type.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-4">
                  <Link
                    href={`/evacuation-plans/${plan.id}/editor`}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-safety-green hover:text-green-700"
                  >
                    <Edit2 className="h-4 w-4" />
                    Éditer
                  </Link>
                  <div className="flex items-center gap-3">
                    <a href={plan.background_file} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-safety-green">
                      <Eye className="h-4 w-4" />
                    </a>
                    <button onClick={() => handleDelete(plan.id)} className="text-slate-500 hover:text-safety-red">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
