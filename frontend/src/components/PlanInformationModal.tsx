"use client";

import React from "react";
import { AlertTriangle, Eye, EyeOff, Loader2, Save, X } from "lucide-react";
import {
  PLAN_INFORMATION_FIELDS,
  formatPlanReference,
  isPlanInformationFieldRequired,
  missingPlanInformationFields,
  nextVerificationDateFromDesignDate,
  type PlanInformationFieldKey,
  type PlanInformationValues,
  type PlanInformationVisibility,
} from "@/lib/planInformation";

interface PlanInformationModalProps {
  open: boolean;
  templateName: string;
  values: PlanInformationValues;
  visibility: PlanInformationVisibility;
  onValuesChange: (values: PlanInformationValues) => void;
  onVisibilityChange: (visibility: PlanInformationVisibility) => void;
  onSave: () => void;
  onClose: () => void;
  saving?: boolean;
  error?: string;
  canEdit?: boolean;
}

export default function PlanInformationModal({
  open,
  templateName,
  values,
  visibility,
  onValuesChange,
  onVisibilityChange,
  onSave,
  onClose,
  saving = false,
  error = "",
  canEdit = true,
}: PlanInformationModalProps) {
  if (!open) return null;

  const missingCount = missingPlanInformationFields(values).length;
  const setValue = (key: PlanInformationFieldKey, value: string) => {
    onValuesChange({
      ...values,
      [key]: value,
      ...(key === "design_date"
        ? { next_verification_date: nextVerificationDateFromDesignDate(value) }
        : {}),
    });
  };
  const toggleVisibility = (key: PlanInformationFieldKey) => {
    onVisibilityChange({ ...visibility, [key]: !visibility[key] });
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#242426] text-neutral-100 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-information-title"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <h2 id="plan-information-title" className="text-base font-bold text-white">
              Informations du plan
            </h2>
            <p className="mt-1 text-xs text-neutral-400">
              Template : {templateName}. L’œil contrôle uniquement l’affichage sur la planche ; la valeur reste enregistrée.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-neutral-400 transition hover:bg-white/10 hover:text-white"
            title="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {missingCount > 0 && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-xs text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <span>
                {missingCount} information{missingCount > 1 ? "s" : ""} à compléter avant l’enregistrement du template et l’export.
              </span>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-xs text-red-100">
              {error}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {PLAN_INFORMATION_FIELDS.map(({ key, label, type }) => {
              const required = isPlanInformationFieldRequired(key);
              const automatic = key === "next_verification_date" || key === "plan_number";
              const displayValue = key === "plan_number"
                ? formatPlanReference(values.plan_number, values.revision_index)
                : values[key];
              return (
                <label key={key} className="rounded-xl border border-white/10 bg-black/15 p-3">
                  <span className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">
                      {label} {automatic ? "(automatique)" : required ? "*" : "(facultatif)"}
                    </span>
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => toggleVisibility(key)}
                      className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        visibility[key]
                          ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                          : "bg-white/5 text-neutral-500 hover:bg-white/10 hover:text-neutral-300"
                      }`}
                      title={visibility[key] ? "Masquer cette information sur le plan" : "Afficher cette information sur le plan"}
                    >
                      {visibility[key] ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      {visibility[key] ? "Visible" : "Masqué"}
                    </button>
                  </span>
                  <input
                    type={type}
                    required={required}
                    disabled={!canEdit}
                    readOnly={automatic}
                    value={displayValue}
                    onChange={(event) => setValue(key, event.target.value)}
                    className={`block w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 ${automatic ? "cursor-default text-emerald-200" : ""}`}
                  />
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-white/10 bg-black/10 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-semibold text-neutral-400 transition hover:bg-white/10 hover:text-white"
          >
            {canEdit ? "Annuler" : "Fermer"}
          </button>
          {canEdit && (
            <button
              type="submit"
              disabled={saving || missingCount > 0}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Enregistrer et appliquer
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
