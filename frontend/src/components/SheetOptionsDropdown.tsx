"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ImagePlus,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Stamp,
  Unlock,
  X
} from "lucide-react";
import type { WatermarkConfig } from "@/lib/watermark";

interface SheetOptionsDropdownProps {
  openLogoManager: () => void;
  openWatermarkSettings: () => void;
  watermarkConfig: WatermarkConfig;
  disableWatermark: () => void;
  sheetActive: boolean;
  restoreCurrentSheetTemplateDefault: () => void;
  defaultSheetTemplateActive: boolean;
  canEditDefaultTemplates: boolean;
  publishCurrentTemplateAsDefault: () => void;
}

const MENU_WIDTH = 290;

export default function SheetOptionsDropdown({
  openLogoManager,
  openWatermarkSettings,
  watermarkConfig,
  disableWatermark,
  sheetActive,
  restoreCurrentSheetTemplateDefault,
  defaultSheetTemplateActive,
  canEditDefaultTemplates,
  publishCurrentTemplateAsDefault
}: SheetOptionsDropdownProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const placeMenu = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const maxLeft = Math.max(8, window.innerWidth - MENU_WIDTH - 8);
    const left = Math.min(Math.max(8, rect.left), maxLeft);
    setAnchor({
      top: rect.bottom + 4,
      left
    });
  }, []);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [open, placeMenu]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    placeMenu();
    setOpen(true);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Options du template : Logos, Version filigranée, Réinitialisation"
        className={`flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[10px] font-semibold transition-colors ${
          open
            ? "bg-white/15 text-white"
            : watermarkConfig.enabled
              ? "border border-red-500/40 bg-red-950/60 text-red-200 hover:bg-red-900/70"
              : "bg-white/[0.05] text-neutral-300 hover:bg-white/10 hover:text-white"
        }`}
      >
        <SlidersHorizontal className="h-3.5 w-3.5 text-neutral-400" />
        <span>Options</span>
        {watermarkConfig.enabled && (
          <span className="h-1.5 w-1.5 rounded-full bg-red-400" title="Filigrane actif" />
        )}
        <ChevronDown className={`h-3 w-3 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open &&
        anchor &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Options du template"
            style={{
              position: "fixed",
              top: `${anchor.top}px`,
              left: `${anchor.left}px`,
              width: `${MENU_WIDTH}px`,
              zIndex: 9999
            }}
            className="rounded-lg border border-neutral-700/80 bg-[#1f1f23] p-1.5 text-neutral-100 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-400 border-b border-white/5 mb-1">
              Options planche & template
            </div>

            {/* Logos */}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                openLogoManager();
              }}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-neutral-200 transition-colors hover:bg-white/10 hover:text-white"
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-emerald-500/15 text-emerald-400">
                <ImagePlus className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-neutral-100">Logos & Identité</div>
                <div className="truncate text-[10px] text-neutral-400">Logo client, studio et coordonnées</div>
              </div>
            </button>

            {/* Version filigranée / BAT */}
            <div className="flex items-center gap-1 rounded-md transition-colors hover:bg-white/5">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  openWatermarkSettings();
                }}
                className="flex flex-1 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-neutral-200 transition-colors hover:bg-white/10 hover:text-white"
              >
                <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${
                  watermarkConfig.enabled ? "bg-red-500/20 text-red-400" : "bg-white/10 text-neutral-400"
                }`}>
                  <Stamp className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-semibold text-neutral-100">
                    <span>Version filigranée (BAT)</span>
                    {watermarkConfig.enabled && (
                      <span className="rounded bg-red-500/25 px-1 py-0.2 text-[9px] font-bold text-red-300">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[10px] text-neutral-400">Filigrane diag. et bloc Bon à Tirer</div>
                </div>
              </button>

              {watermarkConfig.enabled && (
                <button
                  type="button"
                  onClick={() => {
                    disableWatermark();
                    setOpen(false);
                  }}
                  title="Désactiver le filigrane"
                  className="mr-1.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded text-neutral-400 hover:bg-red-500/20 hover:text-red-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Rétablir template */}
            {sheetActive && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  restoreCurrentSheetTemplateDefault();
                }}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-neutral-200 transition-colors hover:bg-white/10 hover:text-white"
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-amber-500/15 text-amber-400">
                  <RefreshCw className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-neutral-100">Rétablir template d&apos;origine</div>
                  <div className="truncate text-[10px] text-neutral-400">Réinitialiser les blocs modifiés</div>
                </div>
              </button>
            )}

            {/* Template officiel éditable / Enregistrer par défaut (Admin) */}
            {defaultSheetTemplateActive && canEditDefaultTemplates && (
              <>
                <div className="my-1 border-t border-white/10" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    publishCurrentTemplateAsDefault();
                  }}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-md bg-emerald-950/40 border border-emerald-500/30 px-2 py-1.5 text-left text-[11px] font-medium text-emerald-200 transition-colors hover:bg-emerald-900/60 hover:text-white"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-emerald-500/20 text-emerald-300">
                    <Save className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 font-bold text-emerald-300">
                      <Unlock className="h-3 w-3" />
                      <span>Publier modèle officiel</span>
                    </div>
                    <div className="truncate text-[10px] text-emerald-400/80">Définir comme template par défaut (tous)</div>
                  </div>
                </button>
              </>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
