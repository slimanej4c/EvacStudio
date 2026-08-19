"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/context/AuthContext";
import { buildApiUrl } from "@/lib/api";
import { CalendarDays, Edit2, Eye, FileText, Plus, Search, SearchX, SlidersHorizontal, Trash2, X } from "lucide-react";

type PlanDateFilter = "all" | "today" | "7days" | "30days" | "custom";
type PlanSort = "updated_desc" | "updated_asc" | "name_asc" | "name_desc";

interface EvacuationPlan {
  id: number;
  title: string;
  building_name: string;
  floor_name: string;
  background_file: string;
  cleaned_background_file?: string;
  use_cleaned_background?: boolean;
  background_type: string;
  watermark_config?: {
    reference?: string;
    client?: string;
  };
  created_at?: string;
  updated_at?: string;
}

const planNameCollator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
const planDateFormatter = new Intl.DateTimeFormat("fr-CA", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const normalizeSearchText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .trim();

const planTimestamp = (plan: EvacuationPlan) => {
  const timestamp = Date.parse(plan.updated_at || plan.created_at || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export default function EvacuationPlansPage() {
  const { loading: authLoading, token } = useAuth();
  const [plans, setPlans] = useState<EvacuationPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<PlanDateFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<PlanSort>("updated_desc");

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

  const filteredPlans = useMemo(() => {
    const normalizedSearch = normalizeSearchText(search);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const quickDateStart = dateFilter === "today"
      ? todayStart
      : dateFilter === "7days"
        ? todayStart - 6 * 24 * 60 * 60 * 1000
        : dateFilter === "30days"
          ? todayStart - 29 * 24 * 60 * 60 * 1000
          : null;
    const customStart = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const customEnd = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

    return plans
      .filter((plan) => {
        if (normalizedSearch) {
          const searchable = normalizeSearchText([
            plan.title,
            plan.building_name,
            plan.floor_name,
            plan.watermark_config?.reference || "",
            plan.watermark_config?.client || "",
          ].join(" "));
          if (!searchable.includes(normalizedSearch)) return false;
        }

        const timestamp = planTimestamp(plan);
        if (quickDateStart !== null && timestamp < quickDateStart) return false;
        if (dateFilter === "custom") {
          if (customStart !== null && timestamp < customStart) return false;
          if (customEnd !== null && timestamp > customEnd) return false;
        }
        return true;
      })
      .sort((left, right) => {
        if (sort === "name_asc") return planNameCollator.compare(left.title, right.title);
        if (sort === "name_desc") return planNameCollator.compare(right.title, left.title);
        return sort === "updated_asc"
          ? planTimestamp(left) - planTimestamp(right)
          : planTimestamp(right) - planTimestamp(left);
      });
  }, [plans, search, dateFilter, dateFrom, dateTo, sort]);

  const filtersAreActive = Boolean(
    search.trim() || dateFilter !== "all" || sort !== "updated_desc"
  );

  const resetFilters = () => {
    setSearch("");
    setDateFilter("all");
    setDateFrom("");
    setDateTo("");
    setSort("updated_desc");
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
          <>
            <div className="mb-6 rounded-2xl border border-brand-orange/15 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-orange/10 text-brand-orange">
                    <SlidersHorizontal className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-sm font-bold text-brand-ink">Rechercher et filtrer</h2>
                    <p className="text-[11px] text-stone-500">Nom, site, étage, client ou référence du plan</p>
                  </div>
                </div>
                <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold tabular-nums text-stone-600">
                  {filteredPlans.length} {filteredPlans.length > 1 ? "plans trouvés" : "plan trouvé"}
                </span>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(260px,1.4fr)_minmax(180px,0.7fr)_minmax(190px,0.7fr)_auto]">
                <label className="relative block">
                  <span className="sr-only">Rechercher dans les plans</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Rechercher un plan…"
                    className="h-10 w-full rounded-xl border border-stone-200 bg-stone-50 pl-9 pr-9 text-sm text-brand-ink outline-none transition focus:border-brand-orange focus:bg-white focus:ring-2 focus:ring-brand-orange/10"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      title="Effacer la recherche"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-stone-400 transition hover:bg-stone-200 hover:text-stone-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </label>

                <label className="relative block">
                  <span className="sr-only">Filtrer par date de modification</span>
                  <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <select
                    value={dateFilter}
                    onChange={(event) => setDateFilter(event.target.value as PlanDateFilter)}
                    className="h-10 w-full cursor-pointer appearance-none rounded-xl border border-stone-200 bg-stone-50 pl-9 pr-8 text-sm font-medium text-stone-700 outline-none transition focus:border-brand-orange focus:bg-white focus:ring-2 focus:ring-brand-orange/10"
                  >
                    <option value="all">Toutes les dates</option>
                    <option value="today">Modifiés aujourd’hui</option>
                    <option value="7days">7 derniers jours</option>
                    <option value="30days">30 derniers jours</option>
                    <option value="custom">Période personnalisée</option>
                  </select>
                </label>

                <label className="block">
                  <span className="sr-only">Trier les plans</span>
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.target.value as PlanSort)}
                    className="h-10 w-full cursor-pointer rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm font-medium text-stone-700 outline-none transition focus:border-brand-orange focus:bg-white focus:ring-2 focus:ring-brand-orange/10"
                  >
                    <option value="updated_desc">Modifiés récemment</option>
                    <option value="updated_asc">Plus anciens</option>
                    <option value="name_asc">Nom A–Z</option>
                    <option value="name_desc">Nom Z–A</option>
                  </select>
                </label>

                <button
                  type="button"
                  onClick={resetFilters}
                  disabled={!filtersAreActive}
                  className="h-10 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-600 transition hover:border-brand-orange/30 hover:bg-brand-orange/5 hover:text-brand-orange disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Réinitialiser
                </button>
              </div>

              {dateFilter === "custom" && (
                <div className="mt-3 grid gap-3 border-t border-stone-100 pt-3 sm:grid-cols-2 lg:max-w-xl">
                  <label className="text-xs font-medium text-stone-600">
                    Modifié à partir du
                    <input
                      type="date"
                      value={dateFrom}
                      max={dateTo || undefined}
                      onChange={(event) => setDateFrom(event.target.value)}
                      className="mt-1 block h-10 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm text-brand-ink outline-none focus:border-brand-orange focus:bg-white focus:ring-2 focus:ring-brand-orange/10"
                    />
                  </label>
                  <label className="text-xs font-medium text-stone-600">
                    Modifié jusqu’au
                    <input
                      type="date"
                      value={dateTo}
                      min={dateFrom || undefined}
                      onChange={(event) => setDateTo(event.target.value)}
                      className="mt-1 block h-10 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm text-brand-ink outline-none focus:border-brand-orange focus:bg-white focus:ring-2 focus:ring-brand-orange/10"
                    />
                  </label>
                </div>
              )}
            </div>

            {filteredPlans.length === 0 ? (
              <div className="rounded-2xl border border-brand-orange/15 bg-white p-10 text-center shadow-sm">
                <SearchX className="mx-auto h-10 w-10 text-brand-orange" />
                <h2 className="mt-4 text-lg font-semibold text-brand-ink">Aucun plan trouvé</h2>
                <p className="mt-2 text-sm text-stone-500">Modifiez votre recherche ou réinitialisez les filtres.</p>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-5 rounded-lg bg-brand-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-red"
                >
                  Réinitialiser les filtres
                </button>
              </div>
            ) : (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {filteredPlans.map((plan) => {
                  const previewUrl = plan.use_cleaned_background && plan.cleaned_background_file
                    ? plan.cleaned_background_file
                    : plan.background_file;
                  const updatedTimestamp = planTimestamp(plan);
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
                          {updatedTimestamp > 0 && (
                            <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-stone-400">
                              <CalendarDays className="h-3.5 w-3.5" />
                              Modifié le {planDateFormatter.format(new Date(updatedTimestamp))}
                            </p>
                          )}
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
          </>
        )}
      </section>
    </AppShell>
  );
}
