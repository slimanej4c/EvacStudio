"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/context/AuthContext";
import { buildApiUrl } from "@/lib/api";
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
        const res = await fetch(buildApiUrl(`/api/plans/`), { headers: getAuthHeaders(), cache: "no-store" });
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

      <section className="brand-page-bg min-h-[calc(100vh-97px)] space-y-8 p-8">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-brand-orange/15 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-500">Plans enregistrés</span>
              <span className="rounded-lg bg-brand-cream p-2 text-brand-orange"><Files className="h-5 w-5" /></span>
            </div>
            <p className="mt-3 text-3xl font-bold text-brand-ink">{planCount}</p>
          </div>
          <Link href="/evacuation-plans/new" className="group rounded-2xl border border-brand-orange/20 bg-brand-cream p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-orange/40 hover:shadow-md">
            <span className="inline-flex rounded-xl bg-white p-3 text-brand-orange shadow-sm"><FilePlus2 className="h-6 w-6" /></span>
            <h2 className="mt-4 text-lg font-bold text-brand-ink">Créer un plan</h2>
            <p className="mt-2 text-sm leading-6 text-stone-500">Importer une image ou un PDF et placer les pictogrammes.</p>
          </Link>
          <Link href="/evacuation-plans" className="group rounded-2xl border border-brand-red/15 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-red/35 hover:shadow-md">
            <span className="inline-flex rounded-xl bg-red-50 p-3 text-brand-red"><ShieldCheck className="h-6 w-6" /></span>
            <h2 className="mt-4 text-lg font-bold text-brand-ink">Gérer les plans</h2>
            <p className="mt-2 text-sm leading-6 text-stone-500">Ouvrir, éditer, supprimer ou exporter vos plans existants.</p>
          </Link>
        </div>
      </section>
    </AppShell>
  );
}
