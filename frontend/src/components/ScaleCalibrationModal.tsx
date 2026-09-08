"use client";

import React, { useState } from "react";
import { Ruler, Save, X } from "lucide-react";

interface ScaleCalibrationModalProps {
  open: boolean;
  initialDistanceM?: number | null;
  onSave: (realDistanceM: number) => void;
  onCancel: () => void;
}

export default function ScaleCalibrationModal(props: ScaleCalibrationModalProps) {
  return props.open ? <ScaleCalibrationForm key={props.initialDistanceM ?? "new"} {...props} /> : null;
}

function ScaleCalibrationForm({
  initialDistanceM,
  onSave,
  onCancel,
}: ScaleCalibrationModalProps) {
  const [value, setValue] = useState(initialDistanceM ? String(initialDistanceM) : "");
  const [error, setError] = useState("");

  const submit = () => {
    const distance = Number(value.trim().replace(",", "."));
    if (!Number.isFinite(distance) || distance <= 0 || distance > 1_000_000) {
      setError("Indiquez une distance réelle positive, en mètres.");
      return;
    }
    onSave(distance);
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#242426] p-5 text-neutral-100 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scale-calibration-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sky-300">
              <Ruler className="h-5 w-5" />
            </div>
            <div>
              <h2 id="scale-calibration-title" className="text-sm font-bold text-white">
                Distance réelle de référence
              </h2>
              <p className="mt-1 text-xs leading-5 text-neutral-400">
                Indiquez la distance réelle entre les deux points que vous venez de tracer.
              </p>
            </div>
          </div>
          <button type="button" onClick={onCancel} className="rounded p-1.5 text-neutral-500 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mt-5 block">
          <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            Distance réelle
          </span>
          <div className="flex items-center overflow-hidden rounded-lg border border-white/10 bg-neutral-900 focus-within:border-sky-500">
            <input
              autoFocus
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="Ex. 10"
              className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-white outline-none"
            />
            <span className="border-l border-white/10 px-3 text-xs font-semibold text-neutral-400">mètres</span>
          </div>
        </label>

        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
        <p className="mt-3 text-[11px] leading-5 text-neutral-500">
          La ligne sera enregistrée comme calibration technique, verrouillée et invisible dans le fichier exporté.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-xs font-semibold text-neutral-400 hover:bg-white/10 hover:text-white">
            Annuler
          </button>
          <button type="submit" className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-500">
            <Save className="h-3.5 w-3.5" />
            Enregistrer la calibration
          </button>
        </div>
      </form>
    </div>
  );
}
