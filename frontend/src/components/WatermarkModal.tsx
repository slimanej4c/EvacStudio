"use client";

import React, { useState } from "react";
import { Check, ImagePlus, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import { WatermarkConfig } from "@/lib/watermark";
import { DEFAULT_STUDIO_LOGO, prepareLogoFile } from "@/lib/brandLogos";

type LogoKey = "client_logo" | "creator_logo";

interface WatermarkModalProps {
  open: boolean;
  value: WatermarkConfig;
  onChange: (value: WatermarkConfig) => void;
  onApply: () => void;
  onCancel: () => void;
}

export function WatermarkModal({
  open,
  value,
  onChange,
  onApply,
  onCancel,
}: WatermarkModalProps) {
  const [logoBusy, setLogoBusy] = useState<LogoKey | null>(null);
  const [logoError, setLogoError] = useState("");

  if (!open) return null;

  const update = <K extends keyof WatermarkConfig>(key: K, next: WatermarkConfig[K]) =>
    onChange({ ...value, [key]: next });

  const importLogo = async (key: LogoKey, file: File | undefined) => {
    if (!file) return;
    setLogoBusy(key);
    setLogoError("");
    try {
      update(key, await prepareLogoFile(file));
    } catch (error) {
      setLogoError(error instanceof Error ? error.message : "Impossible d’importer le logo.");
    } finally {
      setLogoBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="watermark-title"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-white/15 bg-[#252527] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 id="watermark-title" className="text-sm font-bold text-white">
              Version filigranée
            </h2>
            <p className="mt-1 text-[11px] text-neutral-400">
              Le résultat apparaît immédiatement sur le canvas et sera inclus dans l’export.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Fermer"
            className="rounded p-1.5 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid max-h-[70vh] gap-4 overflow-y-auto p-5 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Texte du filigrane
            </span>
            <textarea
              value={value.text}
              onChange={(event) => update("text", event.target.value)}
              rows={2}
              className="w-full resize-y rounded border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
            />
          </label>

          <label>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Nom du client
            </span>
            <input
              value={value.client}
              onChange={(event) => update("client", event.target.value)}
              className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
            />
          </label>

          <label>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Référence du plan
            </span>
            <input
              value={value.reference}
              onChange={(event) => update("reference", event.target.value)}
              className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
            />
          </label>

          <label>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Date
            </span>
            <input
              type="date"
              value={value.date}
              onChange={(event) => update("date", event.target.value)}
              className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
            />
          </label>

          <label>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Commentaire
            </span>
            <input
              value={value.comment}
              onChange={(event) => update("comment", event.target.value)}
              className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
            />
          </label>

          <div className="sm:col-span-2 rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="mb-3">
              <h3 className="text-xs font-bold text-neutral-200">Logos du BON À TIRER</h3>
              <p className="mt-1 text-[10px] leading-4 text-neutral-500">
                Le logo client appartient au plan courant. Le logo studio est partagé par tous les plans et utilise
                PREV&apos; INC &amp; CIE par défaut. PNG, JPEG, SVG ou WebP, 5 Mo maximum.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ["client_logo", "Logo client · ce plan"],
                ["creator_logo", "Logo studio · tous les plans"],
              ] as const).map(([key, label]) => {
                const logo = value[key];
                const busy = logoBusy === key;
                return (
                  <div key={key} className="rounded-lg border border-white/10 bg-[#202022] p-2.5">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                        {label}
                      </span>
                      {logo && (
                        <button
                          type="button"
                          onClick={() => update(key, key === "creator_logo" ? DEFAULT_STUDIO_LOGO : "")}
                          title={key === "creator_logo" ? "Rétablir le logo PREV’ INC & CIE" : "Retirer le logo client"}
                          className="rounded p-1 text-neutral-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
                        >
                          {key === "creator_logo" ? <RefreshCw className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                    <label className="flex h-20 cursor-pointer items-center justify-center overflow-hidden rounded border border-dashed border-white/15 bg-black/20 transition-colors hover:border-emerald-500/60 hover:bg-emerald-500/5">
                      {busy ? (
                        <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
                      ) : logo ? (
                        <span
                          role="img"
                          aria-label={`Aperçu ${label.toLowerCase()}`}
                          className="h-16 w-[90%] bg-contain bg-center bg-no-repeat"
                          style={{ backgroundImage: `url(${logo})` }}
                        />
                      ) : (
                        <span className="flex items-center gap-2 text-[11px] font-medium text-neutral-400">
                          <ImagePlus className="h-4 w-4 text-emerald-400" />
                          Importer
                        </span>
                      )}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml,image/webp"
                        aria-label={`Importer le ${label.toLowerCase()}`}
                        className="hidden"
                        disabled={busy}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          void importLogo(key, file);
                        }}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
            {logoError && (
              <p role="alert" className="mt-2 text-[11px] font-medium text-red-300">
                {logoError}
              </p>
            )}
          </div>

          <div className="sm:col-span-2 grid gap-2 rounded-lg border border-white/10 bg-black/20 p-3 sm:grid-cols-3">
            {([
              ["show_bat_block", "Afficher le bloc BAT"],
              ["repeat", "Répéter le filigrane"],
              ["diagonal", "Filigrane diagonal"],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-[11px] font-medium text-neutral-300">
                <input
                  type="checkbox"
                  checked={value[key]}
                  onChange={(event) => update(key, event.target.checked)}
                  className="h-3.5 w-3.5 accent-emerald-500"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-white/10 px-4 py-2 text-xs font-semibold text-neutral-300 transition-colors hover:bg-white/10"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onApply}
            className="flex items-center gap-2 rounded bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500"
          >
            <Check className="h-3.5 w-3.5" />
            Appliquer
          </button>
        </div>
      </div>
    </div>
  );
}

export default WatermarkModal;
