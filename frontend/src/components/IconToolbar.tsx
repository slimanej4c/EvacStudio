"use client";

import React, { useState } from "react";
import { SAFETY_ICONS, IconType, SafetyIconDefinition } from "@/utils/safetyIcons";
import { Search, X, Type } from "lucide-react";

interface IconToolbarProps {
  onAddIcon: (type: IconType) => void;
  activeIconType?: IconType | null;
  onCancelPlacement?: () => void;
  iconDefinitions?: Record<string, SafetyIconDefinition>;
  /** Requested when the user clicks the "Text" tool. */
  onAddText?: () => void;
  /** True while the text placement mode is armed. */
  placementTextActive?: boolean;
  /** Cancel an armed text placement. */
  onCancelTextPlacement?: () => void;
}

export default function IconToolbar({
  onAddIcon,
  activeIconType = null,
  onCancelPlacement,
  iconDefinitions = SAFETY_ICONS,
  onAddText,
  placementTextActive = false,
  onCancelTextPlacement,
}: IconToolbarProps) {
  const [search, setSearch] = useState("");

  const iconsList = Object.values(iconDefinitions).filter((icon) =>
    icon.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#252527]">
      {/* Panel title */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-black/40 px-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">
          Équipements
        </span>
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-neutral-500">
          {iconsList.length}
        </span>
      </div>

      {/* Search */}
      <div className="shrink-0 border-b border-black/40 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
          <input
            type="text"
            placeholder="Rechercher…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded border border-black/50 bg-[#1b1b1d] py-1.5 pl-7 pr-7 text-xs text-neutral-200 placeholder-neutral-600 focus:border-emerald-500/60 focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded p-0.5 text-neutral-500 hover:bg-white/10 hover:text-neutral-300"
              title="Effacer"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Placement hint */}
      {(activeIconType || placementTextActive) && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-black/40 bg-emerald-500/10 px-3 py-2">
          <span className="text-[11px] leading-tight text-emerald-300">
            Cliquez sur le plan pour placer
          </span>
          <button
            type="button"
            onClick={() => {
              if (placementTextActive) onCancelTextPlacement?.();
              else onCancelPlacement?.();
            }}
            className="cursor-pointer rounded border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/20"
          >
            Annuler
          </button>
        </div>
      )}

      {/* Text tool — sits above the equipment grid */}
      {onAddText && (
        <div className="shrink-0 border-b border-black/40 p-2">
          <button
            onClick={() => {
              if (placementTextActive && onCancelTextPlacement) {
                onCancelTextPlacement();
                return;
              }
              onAddText();
            }}
            title="Insérer un texte sur le plan"
            className={`group flex w-full cursor-pointer items-center gap-2 rounded border p-2 transition-colors ${
              placementTextActive
                ? "border-emerald-500 bg-emerald-500/15"
                : "border-transparent bg-white/[0.04] hover:border-white/15 hover:bg-white/10"
            }`}
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded ${
                placementTextActive ? "text-emerald-300" : "text-neutral-300"
              }`}
            >
              <Type className="h-4 w-4" />
            </span>
            <span className="text-[11px] font-medium text-neutral-200 group-hover:text-white">
              Texte
            </span>
          </button>
        </div>
      )}

      {/* Icon grid — the only scrollable region of this panel */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-2 gap-1.5">
          {iconsList.map((icon) => {
            const isActive = activeIconType === icon.type;
            return (
              <button
                key={icon.type}
                onClick={() => {
                  if (isActive && onCancelPlacement) {
                    onCancelPlacement();
                    return;
                  }
                  onAddIcon(icon.type);
                }}
                title={icon.label}
                className={`group flex cursor-pointer flex-col items-center justify-start gap-1 rounded border p-1.5 transition-colors ${
                  isActive
                    ? "border-emerald-500 bg-emerald-500/15"
                    : "border-transparent bg-white/[0.04] hover:border-white/15 hover:bg-white/10"
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                  {icon.imageUrl ? (
                    <img src={icon.imageUrl} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <span
                      className="h-full w-full"
                      style={{ color: icon.color }}
                      dangerouslySetInnerHTML={{ __html: icon.svg || "" }}
                    />
                  )}
                </span>
                <span className="line-clamp-2 w-full text-center text-[9px] leading-tight text-neutral-400 group-hover:text-neutral-200">
                  {icon.label}
                </span>
              </button>
            );
          })}
        </div>

        {iconsList.length === 0 && (
          <p className="px-2 py-6 text-center text-[11px] text-neutral-600">
            Aucun équipement ne correspond à « {search} ».
          </p>
        )}
      </div>
    </div>
  );
}
