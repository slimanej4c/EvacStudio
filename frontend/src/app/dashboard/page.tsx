"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/context/AuthContext";
import { API_URL } from "@/lib/api";
import { FilePlus2, Files, ShieldCheck } from "lucide-react";

type ApiList<T> = T[] | { results?: T[] };

function normalizeList<T>(value: ApiList<T>): T[] {
  return Array.isArray(value) ? value : value.results || [];
}

export default function DashboardPage() {
  const { token, getAuthHeaders } = useAuth();
  const [planCount, setPlanCount] = useState(0);

  useEffect(() => {
    if (!token) return;

    const loadPlans = async () => {
      try {
        const res = await fetch(`${API_URL}/api/plans/`, { headers: getAuthHeaders(), cache: "no-store" });
        if (!res.ok) return;
        setPlanCount(normalizeList<unknown>(await res.json()).length);
      } catch {
        setPlanCount(0);
      }
    };

    void loadPlans();
  }, [token, getAuthHeaders]);

  return (
    <AppShell>
      <PageHeader
        title="Dashboard"
        description="Gestion des plans d'évacuation et exports de sécurité incendie."
      />

      <section className="min-h-[calc(100vh-97px)] space-y-8 bg-white p-8">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">Plans enregistrés</span>
              <Files className="h-5 w-5 text-safety-green" />
            </div>
            <p className="mt-3 text-2xl font-bold text-slate-950">{planCount}</p>
          </div>
          <Link href="/evacuation-plans/new" className="rounded-xl border border-green-200 bg-green-50 p-5 shadow-sm transition-colors hover:bg-green-100">
            <FilePlus2 className="h-6 w-6 text-safety-green" />
            <h2 className="mt-4 text-lg font-bold text-slate-950">Créer un plan</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">Importer une image ou un PDF et placer les pictogrammes.</p>
          </Link>
          <Link href="/evacuation-plans" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-safety-green/40 hover:bg-green-50/40">
            <ShieldCheck className="h-6 w-6 text-safety-green" />
            <h2 className="mt-4 text-lg font-bold text-slate-950">Gérer les plans</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">Ouvrir, éditer, supprimer ou exporter vos plans existants.</p>
          </Link>
        </div>
      </section>
    </AppShell>
  );
}
