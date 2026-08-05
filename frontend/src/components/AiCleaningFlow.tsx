"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Check, AlertTriangle, ScanSearch, Sparkles } from "lucide-react";

/**
 * The three-step OpenAI cleaning flow.
 *
 * 1. the model classifies the imported plan and reports its confidence;
 * 2. the user picks an objective — the choices depend on the detected type, and
 *    an existing evacuation plan is the one case with two opposite answers;
 * 3. the options are confirmed and the job runs, one step at a time.
 *
 * The prompt family is decided server-side from the confirmed type and the
 * chosen objective, so this component only has to send them.
 */

export type PlanType =
  | "hand_drawn_sketch"
  | "clear_architectural_plan"
  | "noisy_architectural_plan"
  | "existing_evacuation_plan"
  | "unknown_or_mixed";

export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  hand_drawn_sketch: "Croquis dessiné au stylo",
  clear_architectural_plan: "Plan architectural clair",
  noisy_architectural_plan: "Plan architectural bruité",
  existing_evacuation_plan: "Plan d'évacuation existant",
  unknown_or_mixed: "Plan incertain ou mixte",
};

const ELEMENT_LABELS: Record<string, string> = {
  handwriting: "Écriture manuscrite",
  paper_background: "Fond papier",
  shadows: "Ombres",
  perspective_distortion: "Perspective déformée",
  dimensions: "Dimensions",
  dimension_lines: "Lignes de cotation",
  room_labels: "Noms des locaux",
  furniture: "Mobilier",
  hatching: "Hachures",
  title_block: "Cartouche",
  stairs: "Escaliers",
  doors: "Portes",
  openings: "Ouvertures",
  windows: "Fenêtres",
  machines: "Machines",
  obstacles: "Obstacles",
  technical_symbols: "Symboles techniques",
  evacuation_icons: "Pictogrammes de sécurité",
  evacuation_routes: "Flèches d'évacuation",
  you_are_here: "« Vous êtes ici »",
  legend: "Légende",
  logos: "Logos",
};

const OPTION_LABELS: Record<string, string> = {
  remove_paper_shadows: "Supprimer le papier et les ombres",
  remove_handwriting: "Supprimer les textes manuscrits",
  correct_perspective: "Corriger la perspective",
  straighten_lines: "Redresser les lignes",
  keep_machines: "Conserver les machines",
  keep_obstacles: "Conserver les obstacles",
  remove_dimensions: "Supprimer dimensions et cotations",
  remove_title_block: "Supprimer le cartouche",
  remove_hatching: "Supprimer les hachures",
  remove_furniture: "Supprimer le mobilier",
  remove_technical_symbols: "Supprimer les symboles techniques",
  keep_room_labels: "Conserver les noms des locaux",
  remove_text: "Supprimer tous les textes",
  reduce_visual_noise: "Réduire le bruit visuel",
  remove_existing_pictograms: "Supprimer les pictogrammes",
  remove_routes: "Supprimer flèches et itinéraires",
  remove_you_are_here: "Supprimer « Vous êtes ici »",
  remove_legend: "Supprimer la légende",
  remove_logos: "Supprimer les logos",
  keep_pictograms: "Conserver les pictogrammes",
  keep_routes: "Conserver flèches et itinéraires",
  keep_you_are_here: "Conserver « Vous êtes ici »",
  keep_legend: "Conserver la légende",
  sharpen: "Améliorer la netteté",
};

const CLEANUP_LEVELS: { value: string; label: string; hint: string }[] = [
  { value: "light", label: "Léger", hint: "Modifie le moins possible" },
  { value: "medium", label: "Moyen", hint: "Retire les éléments listés" },
  { value: "strong", label: "Renforcé", hint: "Simplifie fermement" },
];

const QUALITY_LEVELS: { value: string; label: string; hint: string }[] = [
  { value: "low", label: "Low", hint: "Rapide, moins cher" },
  { value: "medium", label: "Medium", hint: "Équilibré" },
  { value: "high", label: "High", hint: "Meilleur rendu" },
];

/** The six steps, in the order the user sees them. */
const FLOW_STEPS = [
  { key: "detect", label: "Détection du type de plan" },
  { key: "elements", label: "Analyse des éléments" },
  { key: "confirm", label: "Confirmation des options" },
  { key: "prompt", label: "Création des instructions" },
  { key: "clean", label: "Nettoyage du plan" },
  { key: "save", label: "Enregistrement du résultat" },
] as const;

/** Job status -> which of the six steps is currently running. */
const STATUS_TO_STEP: Record<string, number> = {
  pending: 3,
  loading_source: 3,
  detecting_type: 0,
  analyzing: 3,
  prompt_ready: 3,
  generating: 4,
  saving_result: 5,
  completed: 6,
};

interface ProfileDescriptor {
  key: string;
  label: string;
  objective: string;
  default_cleanup_level: string;
  warning: string;
  exposed_options: string[];
  options: Record<string, boolean>;
}

interface Detection {
  plan_type: PlanType;
  confidence: number;
  summary: string;
  image_quality: string;
  readability: string;
  detected_elements: Record<string, boolean>;
  recommended_cleaning_level: string;
  cleaning_options: Record<string, boolean>;
  available_profiles: ProfileDescriptor[];
  needs_confirmation: boolean;
  warnings: string[];
}

interface AiCleaningFlowProps {
  planId: string;
  apiUrl: string;
  authHeaders: () => Record<string, string>;
  onApplied: (plan: unknown) => void;
  onBusyChange?: (busy: boolean) => void;
}

export default function AiCleaningFlow({
  planId,
  apiUrl,
  authHeaders,
  onApplied,
  onBusyChange,
}: AiCleaningFlowProps) {
  const [phase, setPhase] = useState<"detecting" | "review" | "running" | "result">("detecting");
  const [detection, setDetection] = useState<Detection | null>(null);
  const [planType, setPlanType] = useState<PlanType>("unknown_or_mixed");
  const [profileKey, setProfileKey] = useState("");
  const [options, setOptions] = useState<Record<string, boolean>>({});
  const [cleanupLevel, setCleanupLevel] = useState("medium");
  const [quality, setQuality] = useState("high");
  const [cost, setCost] = useState<{ min: number; max: number; currency: string } | null>(null);
  const [jobStatus, setJobStatus] = useState("");
  const [result, setResult] = useState<{ before: string; after: string } | null>(null);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);

  const pollRef = useRef<number | null>(null);

  const profiles = detection?.available_profiles ?? [];
  const profile = profiles.find((item) => item.key === profileKey) ?? profiles[0];

  useEffect(() => {
    onBusyChange?.(phase === "detecting" || phase === "running" || applying);
  }, [phase, applying, onBusyChange]);

  // ── Step 1: detection ─────────────────────────────────────────────────────
  const runDetection = useCallback(async () => {
    setPhase("detecting");
    setError("");
    try {
      const res = await fetch(`${apiUrl}/api/plans/${planId}/detect-plan-type/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          `${data.error_code || "DETECTION_FAILED"} — ${data.error || "Détection impossible."}` +
            (data.diagnostic ? `\n\nDétail technique : ${data.diagnostic}` : "")
        );
        setPhase("review");
        return;
      }

      setDetection(data);
      setPlanType(data.plan_type);
      const first: ProfileDescriptor | undefined = data.available_profiles?.[0];
      setProfileKey(first?.key ?? "");
      setOptions({ ...(first?.options ?? {}) });
      setCleanupLevel(data.recommended_cleaning_level || first?.default_cleanup_level || "medium");
      setPhase("review");
    } catch {
      setError("Impossible de joindre le serveur pour analyser le plan.");
      setPhase("review");
    }
  }, [apiUrl, planId, authHeaders]);

  useEffect(() => {
    void runDetection();
    // Detection runs once when the flow opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Changing the type or the objective re-seeds the options from that family.
  const selectProfile = (key: string) => {
    setProfileKey(key);
    const next = profiles.find((item) => item.key === key);
    if (next) {
      setOptions({ ...next.options });
      setCleanupLevel(next.default_cleanup_level);
    }
  };

  const cleaningModeFor = (key: string) =>
    key === "sketch_to_clean_plan" ? "sketch_to_plan" : "existing_plan_cleanup";

  // ── Cost estimate, refreshed with the choices ─────────────────────────────
  useEffect(() => {
    if (phase !== "review" || !profile) return;
    let cancelled = false;

    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`${apiUrl}/api/plans/${planId}/openai-clean-cost-estimate/`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ cleaning_mode: cleaningModeFor(profile.key), quality }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setCost({
            min: data.estimated_min,
            max: data.estimated_max,
            currency: data.currency || "USD",
          });
        }
      } catch {
        /* the estimate is informational; a failure must not block the flow */
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phase, profile, quality, apiUrl, planId, authHeaders]);

  // ── Step 3: run ───────────────────────────────────────────────────────────
  const launch = async () => {
    if (!profile) return;
    setPhase("running");
    setError("");
    setJobStatus("pending");

    const payload: Record<string, unknown> = {
      cleaning_mode: cleaningModeFor(profile.key),
      cleaning_profile: profile.key,
      plan_type: planType,
      detected_plan_type: detection?.plan_type ?? "",
      detection_confidence: detection?.confidence ?? null,
      detected_elements: detection?.detected_elements ?? {},
      niveau_nettoyage: cleanupLevel,
      quality,
      ...options,
    };

    try {
      const res = await fetch(`${apiUrl}/api/plans/${planId}/openai-clean/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(`${data.error_code || ""} ${data.error || "Nettoyage impossible."}`.trim());
        setPhase("review");
        return;
      }
      pollJob(data.job_id);
    } catch {
      setError("Impossible de joindre le serveur pour lancer le nettoyage.");
      setPhase("review");
    }
  };

  const pollJob = (jobId: number) => {
    const tick = async () => {
      try {
        const res = await fetch(
          `${apiUrl}/api/plans/${planId}/openai-clean-status/?job_id=${jobId}`,
          { headers: authHeaders() }
        );
        const data = await res.json();
        setJobStatus(data.status);

        if (data.status === "failed") {
          setError(
            `${data.error_code || ""} ${data.error || "Nettoyage échoué."}`.trim() +
              (data.diagnostic ? `\n\nDétail technique : ${data.diagnostic}` : "")
          );
          setPhase("review");
          return;
        }
        // "completed" only ever arrives together with the image, never before.
        if (data.status === "completed") {
          setResult({ before: data.before_image, after: data.after_image });
          setPhase("result");
          return;
        }
        pollRef.current = window.setTimeout(tick, 2000);
      } catch {
        setError("Perte de contact avec le serveur pendant le nettoyage.");
        setPhase("review");
      }
    };
    void tick();
  };

  useEffect(() => () => {
    if (pollRef.current) window.clearTimeout(pollRef.current);
  }, []);

  const applyResult = async () => {
    if (!result) return;
    setApplying(true);
    try {
      const res = await fetch(`${apiUrl}/api/plans/${planId}/use-openai-cleaned/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ image_data: result.after }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Impossible d'appliquer ce plan.");
        return;
      }
      onApplied(data);
    } catch {
      setError("Impossible de joindre le serveur.");
    } finally {
      setApplying(false);
    }
  };

  const currentStep = STATUS_TO_STEP[jobStatus] ?? 3;
  const detectedElements = Object.entries(detection?.detected_elements ?? {}).filter(
    ([, present]) => present
  );

  // ── Rendering ─────────────────────────────────────────────────────────────
  if (phase === "detecting") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-10">
        <ScanSearch className="h-8 w-8 animate-pulse text-safety-green" />
        <p className="text-sm font-semibold text-slate-700">Détection du type de plan…</p>
        <p className="text-xs text-slate-500">L&apos;IA examine l&apos;image importée.</p>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        {FLOW_STEPS.map((step, index) => {
          const done = index < currentStep;
          const active = index === currentStep;
          return (
            <div key={step.key} className="flex items-center gap-3 text-sm">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                  done
                    ? "border-safety-green bg-safety-green text-white"
                    : active
                      ? "border-safety-green text-safety-green"
                      : "border-slate-300 text-slate-400"
                }`}
              >
                {done ? (
                  <Check className="h-3.5 w-3.5" />
                ) : active ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <span className="text-[11px]">{index + 1}</span>
                )}
              </span>
              <span
                className={
                  done ? "text-slate-500" : active ? "font-semibold text-slate-900" : "text-slate-400"
                }
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  if (phase === "result" && result) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          <Check className="h-4 w-4" />
          Nettoyage terminé et résultat enregistré.
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Avant</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={result.before} alt="Plan avant" className="w-full rounded-lg border border-slate-200" />
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Après</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={result.after} alt="Plan après" className="w-full rounded-lg border border-slate-200" />
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setPhase("review")}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Recommencer
          </button>
          <button
            onClick={applyResult}
            disabled={applying}
            className="flex items-center gap-2 rounded-xl bg-safety-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-50"
          >
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Utiliser ce plan
          </button>
        </div>
      </div>
    );
  }

  // phase === "review"
  return (
    <div className="space-y-5">
      {error && (
        <div className="whitespace-pre-line rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {/* ── Step 1: what was detected ── */}
      {detection && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-bold text-slate-900">
              Type détecté : {PLAN_TYPE_LABELS[detection.plan_type]}
            </p>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                detection.needs_confirmation
                  ? "bg-amber-100 text-amber-800"
                  : "bg-emerald-100 text-emerald-800"
              }`}
            >
              Confiance : {Math.round(detection.confidence * 100)} %
            </span>
          </div>

          {detection.summary && <p className="mb-2 text-xs text-slate-600">{detection.summary}</p>}

          <p className="mb-2 text-[11px] text-slate-500">
            Qualité de l&apos;image : {detection.image_quality} · Lisibilité : {detection.readability}
          </p>

          {detectedElements.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {detectedElements.map(([key]) => (
                <span
                  key={key}
                  className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600"
                >
                  {ELEMENT_LABELS[key] ?? key}
                </span>
              ))}
            </div>
          )}

          {detection.needs_confirmation && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                <AlertTriangle className="h-3.5 w-3.5" />
                Confiance insuffisante — confirmez ou corrigez le type.
              </p>
              <select
                value={planType}
                onChange={(event) => setPlanType(event.target.value as PlanType)}
                className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm"
              >
                {(Object.keys(PLAN_TYPE_LABELS) as PlanType[]).map((type) => (
                  <option key={type} value={type}>
                    {PLAN_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
          )}

          {detection.warnings?.map((warning) => (
            <p key={warning} className="mt-2 text-[11px] text-amber-700">
              {warning}
            </p>
          ))}
        </div>
      )}

      {/* ── Step 2: objective ── */}
      {profiles.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Objectif
          </p>
          <div className="grid gap-2">
            {profiles.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => selectProfile(item.key)}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  profile?.key === item.key
                    ? "border-safety-green bg-green-50"
                    : "border-slate-200 bg-white hover:border-green-200"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                      profile?.key === item.key ? "border-safety-green" : "border-slate-300"
                    }`}
                  >
                    {profile?.key === item.key && (
                      <span className="h-2 w-2 rounded-full bg-safety-green" />
                    )}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">{item.label}</span>
                </div>
                {item.warning && (
                  <p className="mt-1.5 flex items-start gap-1.5 pl-6 text-[11px] text-amber-700">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {item.warning}
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 3: options of that family ── */}
      {profile && profile.exposed_options.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Options recommandées
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {profile.exposed_options.map((key) => (
              <label
                key={key}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700"
              >
                <input
                  type="checkbox"
                  checked={Boolean(options[key])}
                  onChange={(event) =>
                    setOptions((current) => ({ ...current, [key]: event.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300 accent-safety-green"
                />
                <span>{OPTION_LABELS[key] ?? key}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Two settings that are deliberately separate. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Niveau de nettoyage
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {CLEANUP_LEVELS.map((level) => (
              <button
                key={level.value}
                type="button"
                onClick={() => setCleanupLevel(level.value)}
                title={level.hint}
                className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                  cleanupLevel === level.value
                    ? "border-safety-green bg-safety-green text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {level.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Intensité des modifications.</p>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Qualité finale
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {QUALITY_LEVELS.map((level) => (
              <button
                key={level.value}
                type="button"
                onClick={() => setQuality(level.value)}
                title={level.hint}
                className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                  quality === level.value
                    ? "border-safety-green bg-safety-green text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {level.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Rendu et coût OpenAI.</p>
        </div>
      </div>

      {/* Recap before launching */}
      {profile && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Récapitulatif
          </p>
          <dl className="grid gap-1 sm:grid-cols-2">
            <div className="flex gap-1.5">
              <dt className="text-slate-500">Type :</dt>
              <dd className="font-semibold text-slate-800">{PLAN_TYPE_LABELS[planType]}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-slate-500">Objectif :</dt>
              <dd className="font-semibold text-slate-800">{profile.label}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-slate-500">Niveau :</dt>
              <dd className="font-semibold text-slate-800">
                {CLEANUP_LEVELS.find((l) => l.value === cleanupLevel)?.label}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-slate-500">Qualité :</dt>
              <dd className="font-semibold text-slate-800">{quality}</dd>
            </div>
          </dl>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            <p>
              <span className="text-slate-500">À supprimer : </span>
              {profile.exposed_options.filter((k) => k.startsWith("remove") && options[k]).length ||
                "—"}
            </p>
            <p>
              <span className="text-slate-500">À conserver : </span>
              {profile.exposed_options.filter(
                (k) => (k.startsWith("keep") || k.startsWith("preserve")) && options[k]
              ).length || "—"}
            </p>
          </div>
          {cost && (
            <p className="mt-2 font-semibold text-slate-800">
              Coût estimé : {cost.min.toFixed(3)} – {cost.max.toFixed(3)} {cost.currency}
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button
          onClick={() => void runDetection()}
          className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          Relancer la détection
        </button>
        <button
          onClick={() => void launch()}
          disabled={!profile}
          className="flex items-center gap-2 rounded-xl bg-safety-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          Lancer le nettoyage
        </button>
      </div>
    </div>
  );
}
