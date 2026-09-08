"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/context/AuthContext";
import { buildApiUrl, imageCrossOrigin } from "@/lib/api";
import { nextVerificationDateFromDesignDate } from "@/lib/planInformation";
import { Archive, ArchiveRestore, CalendarDays, ChevronDown, ChevronUp, CopyPlus, Download, Edit2, Eye, EyeOff, FileEdit, FileText, Folder, FolderOpen, FolderPlus, History, Info, LayoutGrid, LayoutTemplate, Loader2, Pencil, Plus, Search, SearchX, ShieldCheck, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";

type PlanDateFilter = "all" | "today" | "7days" | "30days" | "custom";
type PlanSort = "updated_desc" | "updated_asc" | "name_asc" | "name_desc";

interface EvacuationPlan {
  id: number;
  user: number;
  folder?: number | null;
  folder_name?: string | null;
  can_edit?: boolean;
  title: string;
  establishment_name?: string;
  building_name: string;
  floor_name: string;
  plan_number?: string;
  revision_index?: string;
  designer?: string;
  design_date?: string | null;
  last_verification_date?: string | null;
  next_verification_date?: string | null;
  plan_information_visibility?: Record<string, boolean>;
  background_file: string;
  cleaned_background_file?: string;
  use_cleaned_background?: boolean;
  background_type: string;
  watermark_config?: {
    reference?: string;
    client?: string;
  };
  active_sheet_template_key?: string;
  active_sheet_template_version_id?: string;
  active_sheet_template_name?: string;
  created_at?: string;
  updated_at?: string;
  archived_at?: string | null;
  is_archived?: boolean;
  revision_count?: number;
  current_revision?: number | null;
}

interface ProjectRevision {
  revision_number: number;
  reason: string;
  manifest_sha256: string;
  created_by_name?: string;
  created_at: string;
  warning_count: number;
}

interface PlanFolder {
  id: number;
  user: number;
  name: string;
  plan_count: number;
  can_edit: boolean;
}

interface PlanInfoFormState {
  title: string;
  folder: number | null;
  establishment_name: string;
  building_name: string;
  floor_name: string;
  revision_index: string;
  designer: string;
  design_date: string;
  last_verification_date: string;
  next_verification_date: string;
  plan_information_visibility: Record<string, boolean>;
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
  const { loading: authLoading, token, authenticatedFetch } = useAuth();
  const [plans, setPlans] = useState<EvacuationPlan[]>([]);
  const [folders, setFolders] = useState<PlanFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<PlanDateFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<PlanSort>("updated_desc");
  const [duplicatingPlanId, setDuplicatingPlanId] = useState<number | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<EvacuationPlan | null>(null);
  const [duplicateTitle, setDuplicateTitle] = useState("");
  const [folderDialog, setFolderDialog] = useState<{ mode: "create" | "rename"; folder?: PlanFolder } | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderBusy, setFolderBusy] = useState(false);
  const [editingPlan, setEditingPlan] = useState<EvacuationPlan | null>(null);
  const [editingForm, setEditingForm] = useState<PlanInfoFormState | null>(null);
  const [editingBusy, setEditingBusy] = useState(false);
  const [editingError, setEditingError] = useState("");
  const [viewMode, setViewMode] = useState<"folders" | "plans">("folders");
  const [activeFolderId, setActiveFolderId] = useState<number | "unfiled" | null>(null);
  const [openFolders, setOpenFolders] = useState<Record<number, boolean>>({});
  const [actionNotice, setActionNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [projectBusyId, setProjectBusyId] = useState<number | null>(null);
  const [revisionPlan, setRevisionPlan] = useState<EvacuationPlan | null>(null);
  const [revisions, setRevisions] = useState<ProjectRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [importingProject, setImportingProject] = useState(false);
  const projectImportRef = useRef<HTMLInputElement>(null);

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
      const [plansResponse, foldersResponse] = await Promise.all([
        fetch(buildApiUrl(`/api/plans/${showArchived ? "?archived=true" : ""}`), { headers, cache: "no-store" }),
        fetch(buildApiUrl(`/api/plan-folders/`), { headers, cache: "no-store" }),
      ]);
      if (plansResponse.ok && foldersResponse.ok) {
        const [plansData, foldersData] = await Promise.all([
          plansResponse.json(),
          foldersResponse.json(),
        ]);
        setPlans(Array.isArray(plansData) ? plansData : plansData.results || []);
        setFolders(Array.isArray(foldersData) ? foldersData : foldersData.results || []);
      } else {
        setError("Impossible de charger la liste des plans.");
      }
    } catch {
      setError("Erreur de communication avec le serveur.");
    } finally {
      setLoading(false);
    }
  };

  // Start a server reload and its loading indicator when the account or archive filter changes.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const storedToken = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!authLoading && (token || storedToken)) {
      void fetchPlans();
    }
  }, [authLoading, token, showArchived]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
  }, [authLoading, token, showArchived]);

  const handleDelete = async (id: number) => {
    if (!confirm("Archiver ce plan ? Il restera récupérable avec toutes ses révisions et ses fichiers.")) return;
    const res = await authenticatedFetch(buildApiUrl(`/api/plans/${id}/`), {
      method: "DELETE",
    });
    if (res.ok) {
      setPlans((current) => current.filter((plan) => plan.id !== id));
      setActionNotice({ type: "success", message: "Plan archivé. Ses données restent conservées." });
    } else {
      setActionNotice({ type: "error", message: "Impossible d’archiver ce plan." });
    }
  };

  const restoreArchivedPlan = async (plan: EvacuationPlan) => {
    setProjectBusyId(plan.id);
    const response = await authenticatedFetch(buildApiUrl(`/api/plans/${plan.id}/restore-archived/`), {
      method: "POST",
    });
    setProjectBusyId(null);
    if (!response.ok) {
      setActionNotice({ type: "error", message: "Impossible de restaurer ce plan." });
      return;
    }
    setPlans((current) => current.filter((item) => item.id !== plan.id));
    setActionNotice({ type: "success", message: `Le plan « ${plan.title} » est de nouveau actif.` });
  };

  const exportProject = async (plan: EvacuationPlan) => {
    setProjectBusyId(plan.id);
    try {
      const response = await authenticatedFetch(buildApiUrl(`/api/plans/${plan.id}/project-export/`));
      if (!response.ok) throw new Error("Impossible d’exporter le projet.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${plan.title.replace(/[^a-z0-9._-]+/gi, "-") || "projet"}.evacstudio.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (exportError) {
      setActionNotice({
        type: "error",
        message: exportError instanceof Error ? exportError.message : "Impossible d’exporter le projet.",
      });
    } finally {
      setProjectBusyId(null);
    }
  };

  const verifyProject = async (plan: EvacuationPlan) => {
    setProjectBusyId(plan.id);
    try {
      const response = await authenticatedFetch(buildApiUrl(`/api/plans/${plan.id}/project-integrity/`));
      const result = await response.json();
      if (!response.ok) throw new Error(result?.detail || "Vérification impossible.");
      setActionNotice(result.ok
        ? { type: "success", message: `Projet intact : ${result.assetsChecked} fichier(s), ${result.revisionsChecked} révision(s) vérifiés.` }
        : { type: "error", message: `Projet à contrôler : ${(result.errors?.length || 0)} erreur(s), ${(result.warnings?.length || 0)} avertissement(s).` });
    } catch (verifyError) {
      setActionNotice({ type: "error", message: verifyError instanceof Error ? verifyError.message : "Vérification impossible." });
    } finally {
      setProjectBusyId(null);
    }
  };

  const openProjectRevisions = async (plan: EvacuationPlan) => {
    setRevisionPlan(plan);
    setRevisions([]);
    setRevisionsLoading(true);
    try {
      const response = await authenticatedFetch(buildApiUrl(`/api/plans/${plan.id}/project-revisions/`));
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.detail || "Impossible de charger les révisions.");
      setRevisions(Array.isArray(payload) ? payload : []);
    } catch (revisionError) {
      setActionNotice({ type: "error", message: revisionError instanceof Error ? revisionError.message : "Impossible de charger les révisions." });
      setRevisionPlan(null);
    } finally {
      setRevisionsLoading(false);
    }
  };

  const restoreRevision = async (revision: ProjectRevision) => {
    if (!revisionPlan || !confirm(`Restaurer la révision ${revision.revision_number} ? Une nouvelle révision de sécurité sera créée.`)) return;
    setProjectBusyId(revisionPlan.id);
    try {
      const response = await authenticatedFetch(buildApiUrl(
        `/api/plans/${revisionPlan.id}/project-revisions/${revision.revision_number}/restore/`,
      ), { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail || "Restauration impossible.");
      setRevisionPlan(null);
      setActionNotice({ type: "success", message: `Révision ${revision.revision_number} restaurée sans effacer l’historique.` });
      await fetchPlans();
    } catch (restoreError) {
      setActionNotice({ type: "error", message: restoreError instanceof Error ? restoreError.message : "Restauration impossible." });
    } finally {
      setProjectBusyId(null);
    }
  };

  const importProject = async (file: File) => {
    const suggested = file.name.replace(/\.evacstudio\.zip$|\.zip$/i, "");
    const title = window.prompt("Nom du projet importé", suggested);
    if (title === null) return;
    setImportingProject(true);
    try {
      const form = new FormData();
      form.append("archive", file);
      if (title.trim()) form.append("title", title.trim());
      const response = await authenticatedFetch(buildApiUrl("/api/plans/project-import/"), {
        method: "POST",
        body: form,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail || "Import du projet impossible.");
      setActionNotice({ type: "success", message: `Le projet « ${payload.title} » a été importé avec ses ressources figées.` });
      if (showArchived) setShowArchived(false);
      else await fetchPlans();
    } catch (importError) {
      setActionNotice({ type: "error", message: importError instanceof Error ? importError.message : "Import du projet impossible." });
    } finally {
      setImportingProject(false);
      if (projectImportRef.current) projectImportRef.current.value = "";
    }
  };

  const openDuplicateDialog = (plan: EvacuationPlan) => {
    setDuplicateSource(plan);
    setDuplicateTitle(`${plan.title} (copie)`);
    setActionNotice(null);
  };

  const handleDuplicate = async () => {
    const plan = duplicateSource;
    if (!plan || !duplicateTitle.trim()) return;
    if (duplicatingPlanId !== null) return;
    setDuplicatingPlanId(plan.id);
    setActionNotice(null);
    try {
      const response = await authenticatedFetch(buildApiUrl(`/api/plans/${plan.id}/duplicate/`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: duplicateTitle.trim() }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail || payload?.error || "Impossible de dupliquer ce plan.");
      }
      const duplicated = payload as EvacuationPlan;
      setPlans((current) => [duplicated, ...current.filter((item) => item.id !== duplicated.id)]);
      setActionNotice({
        type: "success",
        message: `Le plan « ${plan.title} » a été dupliqué sous le nom « ${duplicated.title} ».`,
      });
      setDuplicateSource(null);
    } catch (duplicateError) {
      setActionNotice({
        type: "error",
        message: duplicateError instanceof Error
          ? duplicateError.message
          : "Impossible de dupliquer ce plan.",
      });
    } finally {
      setDuplicatingPlanId(null);
    }
  };

  const openFolderDialog = (folder?: PlanFolder) => {
    setFolderDialog(folder ? { mode: "rename", folder } : { mode: "create" });
    setFolderName(folder?.name || "");
    setActionNotice(null);
  };

  const saveFolder = async () => {
    const name = folderName.trim();
    if (!folderDialog || !name || folderBusy) return;
    setFolderBusy(true);
    try {
      const endpoint = folderDialog.mode === "rename" && folderDialog.folder
        ? `/api/plan-folders/${folderDialog.folder.id}/`
        : "/api/plan-folders/";
      const response = await authenticatedFetch(buildApiUrl(endpoint), {
        method: folderDialog.mode === "rename" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = Array.isArray(payload?.name) ? payload.name[0] : payload?.detail;
        throw new Error(message || "Impossible d’enregistrer ce dossier.");
      }
      const saved = payload as PlanFolder;
      setFolders((current) => folderDialog.mode === "rename"
        ? current.map((folder) => folder.id === saved.id ? saved : folder)
        : [...current, saved].sort((a, b) => planNameCollator.compare(a.name, b.name)));
      setPlans((current) => current.map((plan) => plan.folder === saved.id
        ? { ...plan, folder_name: saved.name }
        : plan));
      setFolderDialog(null);
      setActionNotice({ type: "success", message: `Dossier « ${saved.name} » enregistré.` });
    } catch (folderError) {
      setActionNotice({
        type: "error",
        message: folderError instanceof Error ? folderError.message : "Impossible d’enregistrer ce dossier.",
      });
    } finally {
      setFolderBusy(false);
    }
  };

  const deleteFolder = async (folder: PlanFolder) => {
    if (!confirm(`Supprimer le dossier « ${folder.name} » ? Les plans seront conservés sans dossier.`)) return;
    const response = await authenticatedFetch(buildApiUrl(`/api/plan-folders/${folder.id}/`), {
      method: "DELETE",
    });
    if (!response.ok) {
      setActionNotice({ type: "error", message: "Impossible de supprimer ce dossier." });
      return;
    }
    setFolders((current) => current.filter((item) => item.id !== folder.id));
    setPlans((current) => current.map((plan) => plan.folder === folder.id
      ? { ...plan, folder: null, folder_name: null }
      : plan));
  };

  const movePlanToFolder = async (plan: EvacuationPlan, folderId: number | null) => {
    const response = await authenticatedFetch(buildApiUrl(`/api/plans/${plan.id}/`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: folderId }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setActionNotice({ type: "error", message: payload?.folder?.[0] || "Impossible de déplacer ce plan." });
      return;
    }
    setPlans((current) => current.map((item) => item.id === plan.id ? payload as EvacuationPlan : item));
  };

  const toggleFolder = (folderId: number) => {
    setOpenFolders((current) => ({
      ...current,
      [folderId]: !current[folderId],
    }));
  };

  const openEditPlanInfoDialog = (plan: EvacuationPlan) => {
    setEditingPlan(plan);
    setEditingForm({
      title: plan.title || "",
      folder: plan.folder ?? null,
      establishment_name: plan.establishment_name || "",
      building_name: plan.building_name || "",
      floor_name: plan.floor_name || "",
      revision_index: plan.revision_index || "A",
      designer: plan.designer || "",
      design_date: plan.design_date || "",
      last_verification_date: plan.last_verification_date || "",
      next_verification_date: plan.next_verification_date || "",
      plan_information_visibility: { ...(plan.plan_information_visibility || {}) },
    });
    setEditingError("");
  };

  const handleEditingFormChange = (key: keyof PlanInfoFormState, value: unknown) => {
    setEditingForm((current) => {
      if (!current) return current;
      const updated = { ...current, [key]: value };
      if (key === "design_date" && typeof value === "string" && value) {
        if (!current.next_verification_date || current.next_verification_date === nextVerificationDateFromDesignDate(current.design_date)) {
          updated.next_verification_date = nextVerificationDateFromDesignDate(value);
        }
      }
      return updated;
    });
  };

  const toggleFieldVisibility = (fieldKey: string) => {
    setEditingForm((current) => {
      if (!current) return current;
      const prev = current.plan_information_visibility[fieldKey] !== false;
      return {
        ...current,
        plan_information_visibility: {
          ...current.plan_information_visibility,
          [fieldKey]: !prev,
        },
      };
    });
  };

  const handleSavePlanInfo = async () => {
    if (!editingPlan || !editingForm || editingBusy) return;
    if (!editingForm.title.trim()) {
      setEditingError("Le titre du plan est obligatoire.");
      return;
    }
    if (!editingForm.building_name.trim()) {
      setEditingError("Le nom du bâtiment ou de la zone est obligatoire.");
      return;
    }
    if (!editingForm.floor_name.trim()) {
      setEditingError("L’étage est obligatoire.");
      return;
    }

    setEditingBusy(true);
    setEditingError("");
    try {
      const payload = {
        title: editingForm.title.trim(),
        folder: editingForm.folder,
        establishment_name: editingForm.establishment_name.trim(),
        building_name: editingForm.building_name.trim(),
        floor_name: editingForm.floor_name.trim(),
        revision_index: editingForm.revision_index.trim(),
        designer: editingForm.designer.trim(),
        design_date: editingForm.design_date || null,
        last_verification_date: editingForm.last_verification_date || null,
        next_verification_date: editingForm.next_verification_date || null,
        plan_information_visibility: editingForm.plan_information_visibility,
      };

      const response = await authenticatedFetch(buildApiUrl(`/api/plans/${editingPlan.id}/`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const message = data?.detail
          || (Array.isArray(data?.title) ? data.title[0] : null)
          || (Array.isArray(data?.building_name) ? data.building_name[0] : null)
          || (Array.isArray(data?.floor_name) ? data.floor_name[0] : null)
          || "Impossible d’enregistrer les informations du plan.";
        throw new Error(message);
      }

      const updated = data as EvacuationPlan;
      setPlans((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditingPlan(null);
      setEditingForm(null);
      setActionNotice({
        type: "success",
        message: `Les informations du plan « ${updated.title} » ont été mises à jour.`,
      });
    } catch (err) {
      setEditingError(err instanceof Error ? err.message : "Impossible d’enregistrer les modifications.");
    } finally {
      setEditingBusy(false);
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
            plan.establishment_name || "",
            plan.building_name,
            plan.floor_name,
            plan.plan_number || "",
            plan.revision_index || "",
            plan.designer || "",
            plan.watermark_config?.reference || "",
            plan.watermark_config?.client || "",
            plan.active_sheet_template_name || "Plan seul",
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

  const groupedPlans = useMemo(() => {
    const groups: Array<{ key: string; folder: PlanFolder | null; plans: EvacuationPlan[] }> = folders
      .map((folder) => ({
        key: `folder-${folder.id}`,
        folder,
        plans: filteredPlans.filter((plan) => plan.folder === folder.id),
      }))
      .filter((group) => group.plans.length > 0 || !filtersAreActive);
    const unfiled = filteredPlans.filter((plan) => !plan.folder);
    if (unfiled.length > 0) {
      groups.push({ key: "unfiled", folder: null, plans: unfiled });
    }
    return groups;
  }, [filteredPlans, folders, filtersAreActive]);

  const resetFilters = () => {
    setSearch("");
    setDateFilter("all");
    setDateFrom("");
    setDateTo("");
    setSort("updated_desc");
  };

  const unfiledPlans = useMemo(() => {
    return filteredPlans.filter((plan) => !plan.folder);
  }, [filteredPlans]);

  const activeFolderData = useMemo(() => {
    if (activeFolderId === null) return null;
    if (activeFolderId === "unfiled") {
      return {
        title: "Sans dossier",
        plans: unfiledPlans,
        folder: null,
      };
    }
    const folder = folders.find((f) => f.id === activeFolderId) || null;
    return {
      title: folder?.name || "Dossier",
      plans: filteredPlans.filter((p) => p.folder === activeFolderId),
      folder,
    };
  }, [activeFolderId, filteredPlans, folders, unfiledPlans]);

  const renderPlanCard = (plan: EvacuationPlan) => {
    const previewUrl = plan.use_cleaned_background && plan.cleaned_background_file
      ? plan.cleaned_background_file
      : plan.background_file;
    const updatedTimestamp = planTimestamp(plan);

    return (
      <article key={plan.id} className="group overflow-hidden rounded-2xl border border-brand-orange/15 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-orange/35 hover:shadow-md">
        <Link
          href={plan.is_archived ? "/evacuation-plans" : `/evacuation-plans/${plan.id}/editor`}
          onClick={(event) => { if (plan.is_archived) event.preventDefault(); }}
          className={plan.is_archived ? "block cursor-default opacity-85" : "block"}
        >
          <div className="relative flex h-44 items-center justify-center overflow-hidden border-b border-slate-100 bg-slate-50">
            {previewUrl ? (
              <img
                src={previewUrl}
                crossOrigin={imageCrossOrigin(previewUrl)}
                alt={plan.title}
                className="h-full w-full object-contain p-2 transition-transform duration-300 group-hover:scale-[1.03]"
                loading="lazy"
              />
            ) : (
              <FileText className="h-12 w-12 text-slate-300" />
            )}
            <span className="absolute right-2 top-2 rounded-full bg-brand-orange/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
              {plan.is_archived ? "ARCHIVÉ" : plan.background_type.toUpperCase()}
            </span>
          </div>
          <div className="p-4">
            <h2 className="truncate text-base font-semibold text-brand-ink">{plan.title}</h2>
            {plan.establishment_name && (
              <p className="mt-0.5 truncate text-sm font-medium text-stone-600">
                {plan.establishment_name}
              </p>
            )}
            <p className="truncate text-sm text-stone-500">
              {plan.building_name}{plan.floor_name ? ` · ${plan.floor_name}` : ""}
            </p>
            {plan.plan_number && (
              <p className="mt-1 truncate text-[11px] font-medium text-stone-400">
                Plan n° {plan.plan_number}{plan.revision_index ? ` · Révision ${plan.revision_index}` : ""}
              </p>
            )}
            <p className="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-brand-orange">
              <LayoutTemplate className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                Template : {plan.active_sheet_template_name || "Plan seul"}
              </span>
            </p>
            {updatedTimestamp > 0 && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-stone-400">
                <CalendarDays className="h-3.5 w-3.5" />
                Modifié le {planDateFormatter.format(new Date(updatedTimestamp))}
              </p>
            )}
            <p className="mt-1.5 text-[10px] font-medium text-stone-400">
              Projet autonome · révision {plan.current_revision || 0} · {plan.revision_count || 0} sauvegarde(s)
            </p>
          </div>
        </Link>
        {plan.can_edit !== false && !plan.is_archived && (
          <div className="border-t border-slate-100 px-4 py-2">
            <label className="flex items-center gap-2 text-[11px] font-medium text-stone-500">
              <Folder className="h-3.5 w-3.5 shrink-0" />
              <span className="shrink-0">Dossier</span>
              <select
                value={plan.folder ?? ""}
                onChange={(event) => void movePlanToFolder(
                  plan,
                  event.target.value ? Number(event.target.value) : null,
                )}
                className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1 text-[11px] text-stone-700 outline-none focus:border-brand-orange"
              >
                <option value="">Sans dossier</option>
                {folders.filter((folder) => folder.user === plan.user).map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5">
          {plan.is_archived ? (
            <button
              type="button"
              onClick={() => void restoreArchivedPlan(plan)}
              disabled={projectBusyId === plan.id || plan.can_edit === false}
              className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-600 disabled:opacity-45"
            >
              <ArchiveRestore className="h-4 w-4" />
              Restaurer
            </button>
          ) : (
            <Link
              href={`/evacuation-plans/${plan.id}/editor`}
              className="inline-flex items-center gap-2 text-sm font-semibold text-brand-red hover:text-brand-orange"
            >
              <Edit2 className="h-4 w-4" />
              Éditer
            </Link>
          )}
          <div className="flex items-center gap-2.5">
            {!plan.is_archived && plan.can_edit !== false && (
              <button
                type="button"
                onClick={() => openEditPlanInfoDialog(plan)}
                title={`Modifier les informations de « ${plan.title} »`}
                className="text-slate-400 transition hover:text-brand-orange"
              >
                <FileEdit className="h-4 w-4" />
              </button>
            )}
            {!plan.is_archived && (
              <button
                type="button"
                onClick={() => openDuplicateDialog(plan)}
                disabled={duplicatingPlanId !== null}
                title={`Dupliquer « ${plan.title} » avec tous ses éléments`}
                className="text-slate-400 transition hover:text-brand-orange disabled:cursor-wait disabled:opacity-45"
              >
                {duplicatingPlanId === plan.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CopyPlus className="h-4 w-4" />}
              </button>
            )}
            <button type="button" onClick={() => void exportProject(plan)} disabled={projectBusyId === plan.id} title="Exporter le projet autonome ZIP" className="text-slate-400 hover:text-brand-orange disabled:opacity-45">
              <Download className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => void verifyProject(plan)} disabled={projectBusyId === plan.id} title="Vérifier l’intégrité" className="text-slate-400 hover:text-emerald-600 disabled:opacity-45">
              <ShieldCheck className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => void openProjectRevisions(plan)} title="Historique des révisions" className="text-slate-400 hover:text-brand-orange">
              <History className="h-4 w-4" />
            </button>
            <a href={plan.background_file} target="_blank" rel="noreferrer" title="Voir le fond de plan" className="text-slate-400 hover:text-brand-orange">
              <Eye className="h-4 w-4" />
            </a>
            {!plan.is_archived && plan.can_edit !== false && (
              <button onClick={() => void handleDelete(plan.id)} title="Archiver sans supprimer" className="text-slate-400 hover:text-safety-red">
                <Archive className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </article>
    );
  };

  return (
    <AppShell>
      <PageHeader title="Plans d'évacuation" description="Créez, modifiez et exportez vos plans de sécurité.">
        <input
          ref={projectImportRef}
          type="file"
          accept=".zip,.evacstudio.zip,application/zip"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importProject(file);
          }}
        />
        <button
          type="button"
          onClick={() => projectImportRef.current?.click()}
          disabled={importingProject}
          className="inline-flex items-center gap-2 rounded-lg border border-brand-orange/30 bg-white px-4 py-2 text-sm font-semibold text-brand-orange transition hover:bg-brand-orange/5 disabled:opacity-50"
        >
          {importingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Importer un projet
        </button>
        <button
          type="button"
          onClick={() => setShowArchived((current) => !current)}
          className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition ${
            showArchived
              ? "border-brand-orange bg-brand-orange text-white"
              : "border-stone-200 bg-white text-stone-600 hover:border-brand-orange/30 hover:text-brand-orange"
          }`}
        >
          {showArchived ? <FileText className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          {showArchived ? "Plans actifs" : "Archives"}
        </button>
        <button
          type="button"
          onClick={() => openFolderDialog()}
          className="inline-flex items-center gap-2 rounded-lg border border-brand-orange/30 bg-white px-4 py-2 text-sm font-semibold text-brand-orange transition hover:bg-brand-orange/5"
        >
          <FolderPlus className="h-4 w-4" />
          Nouveau dossier
        </button>
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
            <h2 className="mt-4 text-lg font-semibold text-brand-ink">
              {showArchived ? "Aucun plan archivé" : "Aucun plan"}
            </h2>
            <p className="mt-2 text-sm text-stone-500">
              {showArchived ? "Les plans archivés restent récupérables ici." : "Créez votre premier plan d’évacuation."}
            </p>
            {folders.length > 0 && (
              <div className="mx-auto mt-6 max-w-lg border-t border-stone-100 pt-5 text-left">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-stone-400">Dossiers préparés</p>
                <div className="space-y-2">
                  {folders.map((folder) => (
                    <div key={folder.id} className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
                      <Folder className="h-4 w-4 text-brand-orange" />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-700">{folder.name}</span>
                      {folder.can_edit && (
                        <>
                          <button type="button" onClick={() => openFolderDialog(folder)} title="Renommer" className="rounded p-1 text-stone-400 hover:text-brand-orange"><Pencil className="h-3.5 w-3.5" /></button>
                          <button type="button" onClick={() => void deleteFolder(folder)} title="Supprimer" className="rounded p-1 text-stone-400 hover:text-safety-red"><Trash2 className="h-3.5 w-3.5" /></button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {actionNotice && (
              <div
                role="status"
                className={`mb-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${
                  actionNotice.type === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-red-200 bg-red-50 text-red-700"
                }`}
              >
                <span>{actionNotice.message}</span>
                <button
                  type="button"
                  onClick={() => setActionNotice(null)}
                  title="Fermer"
                  className="shrink-0 rounded p-1 transition hover:bg-black/5"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
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
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center rounded-xl border border-stone-200 bg-stone-100 p-1">
                    <button
                      type="button"
                      onClick={() => setViewMode("folders")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        viewMode === "folders"
                          ? "bg-white text-brand-ink shadow-sm"
                          : "text-stone-500 hover:text-stone-800"
                      }`}
                    >
                      <Folder className="h-3.5 w-3.5 text-brand-orange" />
                      Par dossiers
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("plans")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        viewMode === "plans"
                          ? "bg-white text-brand-ink shadow-sm"
                          : "text-stone-500 hover:text-stone-800"
                      }`}
                    >
                      <LayoutGrid className="h-3.5 w-3.5 text-brand-orange" />
                      Par plans
                    </button>
                  </div>
                  <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold tabular-nums text-stone-600">
                    {filteredPlans.length} {filteredPlans.length > 1 ? "plans trouvés" : "plan trouvé"}
                  </span>
                </div>
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
            ) : viewMode === "plans" ? (
              /* Vue à plat : tous les plans */
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {filteredPlans.map((plan) => renderPlanCard(plan))}
              </div>
            ) : (
              /* Vue par dossiers : dossiers petits & compacts avec aperçu du 1er plan */
              <div className="space-y-6">
                {/* Grille de dossiers compacts */}
                <div className="rounded-2xl border border-brand-orange/15 bg-white/70 p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-orange/10 text-brand-orange">
                        <Folder className="h-4 w-4" />
                      </span>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500">
                        Dossiers ({folders.length})
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => openFolderDialog()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-brand-orange/30 bg-white px-3 py-1.5 text-xs font-semibold text-brand-orange transition hover:bg-brand-orange/5"
                    >
                      <FolderPlus className="h-3.5 w-3.5" />
                      Nouveau dossier
                    </button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {folders.map((folder) => {
                      const folderPlans = filteredPlans.filter((p) => p.folder === folder.id);
                      const firstPlan = folderPlans[0];
                      const previewUrl = firstPlan
                        ? (firstPlan.use_cleaned_background && firstPlan.cleaned_background_file
                            ? firstPlan.cleaned_background_file
                            : firstPlan.background_file)
                        : null;
                      const isOpen = activeFolderId === folder.id;

                      return (
                        <div
                          key={folder.id}
                          onClick={() => setActiveFolderId(isOpen ? null : folder.id)}
                          className={`group relative flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 transition-all ${
                            isOpen
                              ? "border-brand-orange bg-brand-orange/5 ring-2 ring-brand-orange/20 shadow-sm"
                              : "border-stone-200 bg-white hover:border-brand-orange/40 hover:shadow-sm"
                          }`}
                        >
                          {/* Miniature du 1er plan ou icône dossier */}
                          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-slate-50">
                            {previewUrl ? (
                              <img
                                src={previewUrl}
                                crossOrigin={imageCrossOrigin(previewUrl)}
                                alt={folder.name}
                                className="h-full w-full object-contain p-0.5 transition-transform duration-200 group-hover:scale-105"
                                loading="lazy"
                              />
                            ) : (
                              <Folder className="h-6 w-6 text-brand-orange/60" />
                            )}
                            {firstPlan && (
                              <span className="absolute bottom-0.5 right-0.5 rounded bg-black/65 px-1 text-[7px] font-bold uppercase tracking-wider text-white">
                                1er
                              </span>
                            )}
                          </div>

                          {/* Infos dossier */}
                          <div className="min-w-0 flex-1">
                            <h4 className="truncate text-sm font-bold text-brand-ink transition group-hover:text-brand-orange">
                              {folder.name}
                            </h4>
                            <p className="mt-0.5 text-xs font-semibold text-stone-500">
                              {folderPlans.length} {folderPlans.length > 1 ? "plans" : "plan"}
                            </p>
                            {firstPlan && (
                              <p className="truncate text-[10px] text-stone-400">
                                {firstPlan.title}
                              </p>
                            )}
                          </div>

                          {/* Actions et indicateur */}
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            {folder.can_edit && (
                              <div className="flex items-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openFolderDialog(folder);
                                  }}
                                  title="Renommer"
                                  className="rounded p-1 text-stone-400 hover:text-brand-orange"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void deleteFolder(folder);
                                  }}
                                  title="Supprimer"
                                  className="rounded p-1 text-stone-400 hover:text-safety-red"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                            <span
                              className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                                isOpen
                                  ? "bg-brand-orange text-white"
                                  : "bg-stone-100 text-stone-600 group-hover:bg-brand-orange/10 group-hover:text-brand-orange"
                              }`}
                            >
                              {isOpen ? "Ouvert" : "Ouvrir"}
                              {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {/* Tuile Sans dossier */}
                    {unfiledPlans.length > 0 && (
                      <div
                        onClick={() => setActiveFolderId(activeFolderId === "unfiled" ? null : "unfiled")}
                        className={`group relative flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 transition-all ${
                          activeFolderId === "unfiled"
                            ? "border-brand-orange bg-brand-orange/5 ring-2 ring-brand-orange/20 shadow-sm"
                            : "border-stone-200 bg-white hover:border-brand-orange/40 hover:shadow-sm"
                        }`}
                      >
                        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-slate-50">
                          {unfiledPlans[0]?.background_file ? (
                            <img
                              src={unfiledPlans[0].use_cleaned_background && unfiledPlans[0].cleaned_background_file
                                ? unfiledPlans[0].cleaned_background_file
                                : unfiledPlans[0].background_file}
                              crossOrigin={imageCrossOrigin(unfiledPlans[0].background_file)}
                              alt="Sans dossier"
                              className="h-full w-full object-contain p-0.5"
                              loading="lazy"
                            />
                          ) : (
                            <FileText className="h-6 w-6 text-stone-400" />
                          )}
                          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/65 px-1 text-[7px] font-bold uppercase tracking-wider text-white">
                            1er
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate text-sm font-bold text-brand-ink">
                            Sans dossier
                          </h4>
                          <p className="mt-0.5 text-xs font-semibold text-stone-500">
                            {unfiledPlans.length} {unfiledPlans.length > 1 ? "plans" : "plan"}
                          </p>
                          {unfiledPlans[0] && (
                            <p className="truncate text-[10px] text-stone-400">
                              {unfiledPlans[0].title}
                            </p>
                          )}
                        </div>
                        <span
                          className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                            activeFolderId === "unfiled"
                              ? "bg-brand-orange text-white"
                              : "bg-stone-100 text-stone-600 group-hover:bg-brand-orange/10 group-hover:text-brand-orange"
                          }`}
                        >
                          {activeFolderId === "unfiled" ? "Ouvert" : "Ouvrir"}
                          {activeFolderId === "unfiled" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Section des plans du dossier ouvert */}
                {activeFolderData ? (
                  <div className="rounded-2xl border border-brand-orange/20 bg-white/70 p-5 shadow-sm">
                    <div className="mb-5 flex items-center justify-between border-b border-stone-100 pb-3.5">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-orange/10 text-brand-orange">
                          <FolderOpen className="h-5 w-5" />
                        </span>
                        <div>
                          <h3 className="text-base font-bold text-brand-ink">
                            {activeFolderData.title}
                          </h3>
                          <p className="text-xs text-stone-500">
                            {activeFolderData.plans.length} {activeFolderData.plans.length > 1 ? "plans dans ce dossier" : "plan dans ce dossier"}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveFolderId(null)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:border-brand-orange/30 hover:text-brand-orange"
                      >
                        <X className="h-3.5 w-3.5" />
                        Fermer ce dossier
                      </button>
                    </div>

                    {activeFolderData.plans.length === 0 ? (
                      <div className="py-10 text-center text-xs text-stone-400">
                        Ce dossier ne contient aucun plan correspondant à votre recherche.
                      </div>
                    ) : (
                      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                        {activeFolderData.plans.map((plan) => renderPlanCard(plan))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-stone-200 bg-white/60 p-8 text-center">
                    <Folder className="mx-auto h-8 w-8 text-brand-orange/60" />
                    <h3 className="mt-2 text-sm font-semibold text-brand-ink">
                      Cliquez sur un dossier ci-dessus pour afficher ses plans
                    </h3>
                    <p className="mt-1 text-xs text-stone-500">
                      Ou basculez sur l’affichage « Par plans » pour voir l’ensemble de vos plans à plat.
                    </p>
                    <button
                      type="button"
                      onClick={() => setViewMode("plans")}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-stone-700 transition hover:border-brand-orange/30 hover:bg-brand-orange/5 hover:text-brand-orange"
                    >
                      <LayoutGrid className="h-3.5 w-3.5 text-brand-orange" />
                      Afficher par plans
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {revisionPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-stone-100 p-5">
              <div>
                <h2 className="text-lg font-bold text-brand-ink">Historique immuable</h2>
                <p className="mt-1 text-sm text-stone-500">{revisionPlan.title} — restaurer crée une nouvelle révision sans effacer les anciennes.</p>
              </div>
              <button type="button" onClick={() => setRevisionPlan(null)} className="rounded p-1 text-stone-400 hover:bg-stone-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[58vh] overflow-y-auto p-5">
              {revisionsLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-7 w-7 animate-spin text-brand-orange" /></div>
              ) : revisions.length === 0 ? (
                <p className="py-8 text-center text-sm text-stone-500">Aucune révision disponible.</p>
              ) : (
                <div className="space-y-2">
                  {revisions.map((revision) => (
                    <div key={revision.revision_number} className="flex items-center gap-3 rounded-xl border border-stone-200 px-4 py-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-orange/10 text-xs font-bold text-brand-orange">
                        #{revision.revision_number}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-stone-700">
                          {revision.reason === "bootstrap" ? "Initialisation" : revision.reason === "duplicate" ? "Duplication" : revision.reason === "restore" ? "Restauration" : revision.reason === "archive" ? "Archivage" : revision.reason === "import" ? "Import" : "Sauvegarde"}
                        </p>
                        <p className="truncate text-[11px] text-stone-400">
                          {planDateFormatter.format(new Date(revision.created_at))} · SHA-256 {revision.manifest_sha256.slice(0, 12)}…
                          {revision.warning_count > 0 ? ` · ${revision.warning_count} avertissement(s)` : ""}
                        </p>
                      </div>
                      {revisionPlan.can_edit !== false && (
                        <button
                          type="button"
                          onClick={() => void restoreRevision(revision)}
                          disabled={projectBusyId === revisionPlan.id || revision.revision_number === revisionPlan.current_revision}
                          className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:border-brand-orange/30 hover:text-brand-orange disabled:opacity-40"
                        >
                          Restaurer
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {folderDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={(event) => { event.preventDefault(); void saveFolder(); }}
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-brand-ink">
                  {folderDialog.mode === "rename" ? "Renommer le dossier" : "Créer un dossier"}
                </h2>
                <p className="mt-1 text-sm text-stone-500">Regroupez les plans d’un même établissement ou bâtiment.</p>
              </div>
              <button type="button" onClick={() => setFolderDialog(null)} className="rounded p-1 text-stone-400 hover:bg-stone-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="mt-5 block text-sm font-semibold text-stone-700">
              Nom du dossier
              <input
                autoFocus
                value={folderName}
                maxLength={255}
                onChange={(event) => setFolderName(event.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-stone-200 px-3 text-sm outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/10"
                placeholder="Ex. Hôtel Central"
              />
            </label>
            {actionNotice?.type === "error" && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionNotice.message}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setFolderDialog(null)} className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Annuler</button>
              <button disabled={!folderName.trim() || folderBusy} className="brand-action inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {folderBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                Enregistrer
              </button>
            </div>
          </form>
        </div>
      )}

      {duplicateSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={(event) => { event.preventDefault(); void handleDuplicate(); }}
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-brand-ink">Dupliquer le plan</h2>
                <p className="mt-1 text-sm text-stone-500">Choisissez immédiatement le nom de la copie.</p>
              </div>
              <button type="button" onClick={() => setDuplicateSource(null)} className="rounded p-1 text-stone-400 hover:bg-stone-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="mt-5 block text-sm font-semibold text-stone-700">
              Nom du nouveau plan
              <input
                autoFocus
                value={duplicateTitle}
                maxLength={255}
                onChange={(event) => setDuplicateTitle(event.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-stone-200 px-3 text-sm outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/10"
              />
            </label>
            {actionNotice?.type === "error" && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionNotice.message}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDuplicateSource(null)} className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Annuler</button>
              <button disabled={!duplicateTitle.trim() || duplicatingPlanId !== null} className="brand-action inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {duplicatingPlanId !== null && <Loader2 className="h-4 w-4 animate-spin" />}
                Dupliquer
              </button>
            </div>
          </form>
        </div>
      )}

      {editingPlan && editingForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSavePlanInfo();
            }}
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* En-tête */}
            <div className="flex items-start justify-between gap-3 border-b border-stone-100 p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-orange/10 text-brand-orange">
                  <FileEdit className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-lg font-bold text-brand-ink">
                    Modifier les informations du plan
                  </h2>
                  <p className="mt-0.5 text-xs text-stone-500">
                    {editingPlan.title} {editingPlan.plan_number ? `· Plan n° ${editingPlan.plan_number}` : ""}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingPlan(null);
                  setEditingForm(null);
                }}
                className="rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
                title="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Corps du formulaire */}
            <div className="space-y-5 overflow-y-auto p-5">
              {editingError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-medium text-red-700">
                  {editingError}
                </div>
              )}

              {/* Section 1 : Identification générale */}
              <div>
                <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-stone-400">
                  <Info className="h-3.5 w-3.5 text-brand-orange" />
                  Identification générale
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="sm:col-span-2 block text-xs font-semibold text-stone-700">
                    Titre du plan *
                    <input
                      required
                      value={editingForm.title}
                      onChange={(e) => handleEditingFormChange("title", e.target.value)}
                      placeholder="Ex. Plan d'évacuation RDC"
                      className="mt-1.5 h-10 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm text-brand-ink outline-none transition focus:border-brand-orange focus:bg-white focus:ring-2 focus:ring-brand-orange/10"
                    />
                  </label>

                  <label className="block text-xs font-semibold text-stone-700">
                    Dossier de classement
                    <select
                      value={editingForm.folder ?? ""}
                      onChange={(e) =>
                        handleEditingFormChange("folder", e.target.value ? Number(e.target.value) : null)
                      }
                      className="mt-1.5 h-10 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm text-stone-700 outline-none transition focus:border-brand-orange focus:bg-white focus:ring-2 focus:ring-brand-orange/10"
                    >
                      <option value="">Sans dossier</option>
                      {folders
                        .filter((f) => f.user === editingPlan.user)
                        .map((folder) => (
                          <option key={folder.id} value={folder.id}>
                            {folder.name}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label className="block text-xs font-semibold text-stone-700">
                    Numéro du plan <span className="font-normal text-stone-400">(automatique)</span>
                    <input
                      readOnly
                      disabled
                      value={editingPlan.plan_number || "Généré à la création"}
                      className="mt-1.5 h-10 w-full cursor-not-allowed rounded-xl border border-stone-200 bg-stone-100 px-3 text-sm text-stone-500 outline-none"
                    />
                  </label>
                </div>
              </div>

              {/* Section 2 : Localisation */}
              <div className="border-t border-stone-100 pt-4">
                <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-stone-400">
                  <Folder className="h-3.5 w-3.5 text-brand-orange" />
                  Localisation du site
                </h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block text-xs font-semibold text-stone-700">
                    <span className="flex items-center justify-between">
                      <span>Établissement</span>
                      <button
                        type="button"
                        onClick={() => toggleFieldVisibility("establishment_name")}
                        title={editingForm.plan_information_visibility.establishment_name !== false ? "Visible sur le plan" : "Masqué sur le plan"}
                        className="text-stone-400 transition hover:text-brand-orange"
                      >
                        {editingForm.plan_information_visibility.establishment_name !== false ? (
                          <Eye className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5 text-stone-400" />
                        )}
                      </button>
                    </span>
                    <input
                      value={editingForm.establishment_name}
                      onChange={(e) => handleEditingFormChange("establishment_name", e.target.value)}
                      placeholder="Ex. Siège social"
                      className="mt-1.5 h-10 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm text-brand-ink outline-none transition focus:border-brand-orange focus:bg-white focus:ring-2 focus:ring-brand-orange/10"
                    />
                  </label>

                  <label className="block text-xs font-semibold text-stone-700">
                    <span className="flex items-center justify-between">
                      <span>Bâtiment / Zone *</span>
                      <button
                        type="button"
                        onClick={() => toggleFieldVisibility("building_name")}
                        title={editingForm.plan_information_visibility.building_name !== false ? "Visible sur le plan" : "Masqué sur le plan"}
                        className="text-stone-400 transition hover:text-brand-orange"
                      >
                        {editingForm.plan_information_visibility.building_name !== false ? (
                          <Eye className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5 text-stone-400" />
                        )}
                      </button>
                    </span>
                    <input
                      required
                      value={editingForm.building_name}
                      onChange={(e) => handleEditingFormChange("building_name", e.target.value)}
                      placeholder="Ex. Bâtiment A"
                      className="mt-1.5 h-10 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm text-brand-ink outline-none transition focus:border-brand-orange focus:bg-white focus:ring-2 focus:ring-brand-orange/10"
                    />
                  </label>

                  <label className="block text-xs font-semibold text-stone-700">
                    <span className="flex items-center justify-between">
                      <span>Étage *</span>
                      <button
                        type="button"
                        onClick={() => toggleFieldVisibility("floor_name")}
                        title={editingForm.plan_information_visibility.floor_name !== false ? "Visible sur le plan" : "Masqué sur le plan"}
                        className="text-stone-400 transition hover:text-brand-orange"
                      >
                        {editingForm.plan_information_visibility.floor_name !== false ? (
                          <Eye className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5 text-stone-400" />
                        )}
                      </button>
                    </span>
                    <input
                      required
                      value={editingForm.floor_name}
                      onChange={(e) => handleEditingFormChange("floor_name", e.target.value)}
                      placeholder="Ex. Rez-de-chaussée"
                      className="mt-1.5 h-10 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm text-brand-ink outline-none transition focus:border-brand-orange focus:bg-white focus:ring-2 focus:ring-brand-orange/10"
                    />
                  </label>
                </div>
              </div>

              {/* Section 3 : Révision et cartouche */}
              <div className="border-t border-stone-100 pt-4">
                <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-stone-400">
                  <LayoutTemplate className="h-3.5 w-3.5 text-brand-orange" />
                  Traçabilité & Cartouche
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-semibold text-stone-700">
                    <span className="flex items-center justify-between">
                      <span>Indice de révision</span>
                      <button
                        type="button"
                        onClick={() => toggleFieldVisibility("revision_index")}
                        title={editingForm.plan_information_visibility.revision_index !== false ? "Visible sur le plan" : "Masqué sur le plan"}
                        className="text-stone-400 transition hover:text-brand-orange"
                      >
                        {editingForm.plan_information_visibility.revision_index !== false ? (
                          <Eye className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5 text-stone-400" />
                        )}
                      </button>
                    </span>
                    <input
                      value={editingForm.revision_index}
                      onChange={(e) => handleEditingFormChange("revision_index", e.target.value)}
                      placeholder="Ex. A"
                      className="mt-1.5 h-10 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm text-brand-ink outline-none transition focus:border-brand-orange focus:bg-white focus:ring-2 focus:ring-brand-orange/10"
                    />
                  </label>

                  <label className="block text-xs font-semibold text-stone-700">
                    <span className="flex items-center justify-between">
                      <span>Nom du concepteur</span>
                      <button
                        type="button"
                        onClick={() => toggleFieldVisibility("designer")}
                        title={editingForm.plan_information_visibility.designer !== false ? "Visible sur le plan" : "Masqué sur le plan"}
                        className="text-stone-400 transition hover:text-brand-orange"
                      >
                        {editingForm.plan_information_visibility.designer !== false ? (
                          <Eye className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5 text-stone-400" />
                        )}
                      </button>
                    </span>
                    <input
                      value={editingForm.designer}
                      onChange={(e) => handleEditingFormChange("designer", e.target.value)}
                      placeholder="Ex. Bureau d'études"
                      className="mt-1.5 h-10 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm text-brand-ink outline-none transition focus:border-brand-orange focus:bg-white focus:ring-2 focus:ring-brand-orange/10"
                    />
                  </label>
                </div>
              </div>

              {/* Section 4 : Dates réglementaires */}
              <div className="border-t border-stone-100 pt-4">
                <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-stone-400">
                  <CalendarDays className="h-3.5 w-3.5 text-brand-orange" />
                  Dates réglementaires
                </h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block text-xs font-semibold text-stone-700">
                    <span className="flex items-center justify-between">
                      <span>Date de conception</span>
                      <button
                        type="button"
                        onClick={() => toggleFieldVisibility("design_date")}
                        title={editingForm.plan_information_visibility.design_date !== false ? "Visible sur le plan" : "Masqué sur le plan"}
                        className="text-stone-400 transition hover:text-brand-orange"
                      >
                        {editingForm.plan_information_visibility.design_date !== false ? (
                          <Eye className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5 text-stone-400" />
                        )}
                      </button>
                    </span>
                    <input
                      type="date"
                      value={editingForm.design_date}
                      onChange={(e) => handleEditingFormChange("design_date", e.target.value)}
                      className="mt-1.5 h-10 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm text-brand-ink outline-none transition focus:border-brand-orange focus:bg-white focus:ring-2 focus:ring-brand-orange/10"
                    />
                  </label>

                  <label className="block text-xs font-semibold text-stone-700">
                    <span className="flex items-center justify-between">
                      <span>Dernière vérification</span>
                      <button
                        type="button"
                        onClick={() => toggleFieldVisibility("last_verification_date")}
                        title={editingForm.plan_information_visibility.last_verification_date !== false ? "Visible sur le plan" : "Masqué sur le plan"}
                        className="text-stone-400 transition hover:text-brand-orange"
                      >
                        {editingForm.plan_information_visibility.last_verification_date !== false ? (
                          <Eye className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5 text-stone-400" />
                        )}
                      </button>
                    </span>
                    <input
                      type="date"
                      value={editingForm.last_verification_date}
                      onChange={(e) => handleEditingFormChange("last_verification_date", e.target.value)}
                      className="mt-1.5 h-10 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm text-brand-ink outline-none transition focus:border-brand-orange focus:bg-white focus:ring-2 focus:ring-brand-orange/10"
                    />
                  </label>

                  <label className="block text-xs font-semibold text-stone-700">
                    <span className="flex items-center justify-between">
                      <span>Prochaine vérification</span>
                      <button
                        type="button"
                        onClick={() => toggleFieldVisibility("next_verification_date")}
                        title={editingForm.plan_information_visibility.next_verification_date !== false ? "Visible sur le plan" : "Masqué sur le plan"}
                        className="text-stone-400 transition hover:text-brand-orange"
                      >
                        {editingForm.plan_information_visibility.next_verification_date !== false ? (
                          <Eye className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5 text-stone-400" />
                        )}
                      </button>
                    </span>
                    <input
                      type="date"
                      value={editingForm.next_verification_date}
                      onChange={(e) => handleEditingFormChange("next_verification_date", e.target.value)}
                      className="mt-1.5 h-10 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm text-brand-ink outline-none transition focus:border-brand-orange focus:bg-white focus:ring-2 focus:ring-brand-orange/10"
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Pied de dialogue */}
            <div className="flex items-center justify-end gap-2 border-t border-stone-100 bg-stone-50/50 p-4">
              <button
                type="button"
                onClick={() => {
                  setEditingPlan(null);
                  setEditingForm(null);
                }}
                disabled={editingBusy}
                className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-600 transition hover:bg-stone-50 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={editingBusy}
                className="brand-action inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {editingBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                Enregistrer les modifications
              </button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}
