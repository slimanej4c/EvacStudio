"use client";

import React from "react";
import { ZoomIn, ZoomOut, Maximize, Move, MousePointerClick, Eraser } from "lucide-react";

interface ZoomControlsProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  mode: "select" | "pan" | "erase";
  onModeChange: (mode: "select" | "pan" | "erase") => void;
  onFitToView?: () => void;
}

const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5];

export default function ZoomControls({
  zoom,
  onZoomChange,
  mode,
  onModeChange,
  onFitToView
}: ZoomControlsProps) {
  const stepZoom = (direction: 1 | -1) => {
    const current = zoom;
    const next =
      direction === 1
        ? ZOOM_PRESETS.find((preset) => preset > current + 0.001)
        : [...ZOOM_PRESETS].reverse().find((preset) => preset < current - 0.001);
    onZoomChange(Math.max(0.1, Math.min(5, next ?? current)));
  };

  return (
    <div className="flex items-center gap-1">
      {/* Interaction mode */}
      <div className="flex items-center gap-0.5 rounded bg-black/30 p-0.5">
        <button
          onClick={() => onModeChange("select")}
          className={`flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
            mode === "select"
              ? "bg-emerald-600 text-white"
              : "text-neutral-400 hover:bg-white/10 hover:text-neutral-200"
          }`}
          title="Sélectionner et déplacer (V)"
        >
          <MousePointerClick className="h-3.5 w-3.5" />
          <span>Édition</span>
        </button>
        <button
          onClick={() => onModeChange("pan")}
          className={`flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
            mode === "pan"
              ? "bg-emerald-600 text-white"
              : "text-neutral-400 hover:bg-white/10 hover:text-neutral-200"
          }`}
          title="Naviguer dans le plan (H)"
        >
          <Move className="h-3.5 w-3.5" />
          <span>Navigation</span>
        </button>
        <button
          onClick={() => onModeChange("erase")}
          className={`flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
            mode === "erase"
              ? "bg-amber-600 text-white"
              : "text-neutral-400 hover:bg-white/10 hover:text-neutral-200"
          }`}
          title="Gommer une partie du plan (E)"
        >
          <Eraser className="h-3.5 w-3.5" />
          <span>Gomme</span>
        </button>
      </div>

      <span className="mx-1 h-4 w-px bg-white/10" />

      {/* Zoom */}
      <button
        onClick={() => stepZoom(-1)}
        className="cursor-pointer rounded p-1 text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100"
        title="Zoom arrière"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </button>

      <select
        value={ZOOM_PRESETS.includes(zoom) ? zoom : ""}
        onChange={(e) => onZoomChange(Number(e.target.value))}
        className="cursor-pointer rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] font-medium tabular-nums text-neutral-200 hover:border-white/15 focus:border-emerald-500/60 focus:outline-none"
        title="Niveau de zoom"
      >
        {!ZOOM_PRESETS.includes(zoom) && (
          <option value="" className="bg-[#252527]">
            {Math.round(zoom * 100)}%
          </option>
        )}
        {ZOOM_PRESETS.map((preset) => (
          <option key={preset} value={preset} className="bg-[#252527]">
            {Math.round(preset * 100)}%
          </option>
        ))}
      </select>

      <button
        onClick={() => stepZoom(1)}
        className="cursor-pointer rounded p-1 text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100"
        title="Zoom avant"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </button>

      <button
        onClick={() => onFitToView?.()}
        className="ml-0.5 flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100"
        title="Ajuster le plan à la fenêtre"
      >
        <Maximize className="h-3.5 w-3.5" />
        <span>Ajuster</span>
      </button>
    </div>
  );
}
