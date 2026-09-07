"use client";

import React from "react";
import { Check, Clock, Minus, Plus, RotateCcw, Save, X } from "lucide-react";

interface AutoSaveModalProps {
  open: boolean;
  enabled: boolean;
  interval: number; // en secondes
  onToggle: (enabled: boolean) => void;
  onChangeInterval: (interval: number) => void;
  onClose: () => void;
  secondsUntilNextSave?: number;
  hasUnsavedChanges?: boolean;
}

const PRESET_INTERVALS = [10, 15, 20, 30, 45, 60, 120];

export function AutoSaveModal({
  open,
  enabled,
  interval,
  onToggle,
  onChangeInterval,
  onClose,
  secondsUntilNextSave,
  hasUnsavedChanges,
}: AutoSaveModalProps) {
  if (!open) return null;

  const handleDecrease = () => {
    onChangeInterval(Math.max(5, interval - 5));
  };

  const handleIncrease = () => {
    onChangeInterval(Math.min(600, interval + 5));
  };

  const handleResetDefault = () => {
    onToggle(true);
    onChangeInterval(20);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="autosave-title"
        className="w-full max-w-md overflow-hidden rounded-xl border border-white/15 bg-[#252527] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
              <Save className="h-4 w-4" />
            </div>
            <div>
              <h2 id="autosave-title" className="text-sm font-bold text-white">
                Sauvegarde automatique
              </h2>
              <p className="text-[11px] text-neutral-400">
                Configuration de l’enregistrement automatique en arrière-plan
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded p-1.5 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-5 p-5">
          {/* Activation Switch */}
          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/25 p-3.5">
            <div>
              <div className="text-xs font-semibold text-white">
                Activer la sauvegarde automatique
              </div>
              <div className="mt-0.5 text-[11px] text-neutral-400">
                Enregistre automatiquement les modifications sur le serveur
              </div>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => onToggle(e.target.checked)}
                className="peer sr-only"
              />
              <div className="h-6 w-11 rounded-full bg-neutral-700 transition-colors peer-checked:bg-emerald-600 peer-focus:outline-none after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white"></div>
            </label>
          </div>

          {/* Interval Setting */}
          <div className={`space-y-3 transition-opacity ${enabled ? "opacity-100" : "pointer-events-none opacity-40"}`}>
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                Fréquence de sauvegarde (secondes)
              </label>
              <button
                type="button"
                onClick={handleResetDefault}
                className="flex items-center gap-1 text-[10px] text-neutral-400 hover:text-emerald-400"
                title="Rétablir 20 secondes par défaut"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Défaut (20s)</span>
              </button>
            </div>

            {/* Stepper controls */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleDecrease}
                disabled={interval <= 5}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-black/30 text-white transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/20 disabled:opacity-30"
                title="Diminuer la durée (-5s)"
              >
                <Minus className="h-4 w-4" />
              </button>

              <div className="relative flex-1">
                <input
                  type="number"
                  min={5}
                  max={600}
                  value={interval}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (Number.isFinite(val)) {
                      onChangeInterval(Math.max(5, Math.min(600, val)));
                    }
                  }}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-center text-sm font-bold text-white outline-none focus:border-emerald-500"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">
                  sec
                </span>
              </div>

              <button
                type="button"
                onClick={handleIncrease}
                disabled={interval >= 600}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-black/30 text-white transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/20 disabled:opacity-30"
                title="Augmenter la durée (+5s)"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {/* Preset chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-neutral-500 mr-1">Raccourcis :</span>
              {PRESET_INTERVALS.map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => onChangeInterval(sec)}
                  className={`rounded px-2 py-1 text-[10px] font-semibold transition-colors ${
                    interval === sec
                      ? "border border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                      : "border border-white/10 bg-black/20 text-neutral-400 hover:border-white/20 hover:text-white"
                  }`}
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>

          {/* Status badge */}
          <div className="rounded-lg border border-white/5 bg-black/20 p-3 text-[11px] text-neutral-400 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-neutral-400" />
              <span>
                {enabled ? (
                  hasUnsavedChanges ? (
                    <span>
                      Modifications en cours • Prochaine sauvegarde dans{" "}
                      <strong className="text-emerald-400">
                        {secondsUntilNextSave ?? interval}s
                      </strong>
                    </span>
                  ) : (
                    <span>Tout est à jour • En attente de modifications</span>
                  )
                ) : (
                  <span className="text-amber-400/80">Sauvegarde automatique désactivée</span>
                )}
              </span>
            </div>
            {enabled && (
              <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-white/10 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 rounded bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500"
          >
            <Check className="h-3.5 w-3.5" />
            <span>Fermer</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default AutoSaveModal;
