"use client";

import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SAFETY_ICONS, IconType, SafetyIconDefinition } from "@/utils/safetyIcons";
import { FileCode2, Loader2, Pencil, Plus, Search, Trash2, Type, Upload, X } from "lucide-react";

export interface AddSvgPictogramInput {
  name: string;
  svg: string;
}

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
  /** Store a user-created SVG in the shared pictogram library. */
  onAddSvg?: (input: AddSvgPictogramInput) => Promise<void>;
  /** Remove an unused user-created SVG from the library. */
  onDeleteSvg?: (icon: SafetyIconDefinition) => Promise<void>;
  /** Rename a user-created SVG and keep placed instances linked to it. */
  onRenameSvg?: (icon: SafetyIconDefinition, name: string) => Promise<void>;
}

const EMPTY_SVG_TEMPLATE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 170 170">
  <!-- Dessinez votre pictogramme dans ce cadre carré -->
  <rect x="10" y="10" width="150" height="150" rx="12" fill="#ffffff" stroke="#111111" stroke-width="6" />
</svg>`;

const MAX_SVG_BYTES = 250 * 1024;

export default function IconToolbar({
  onAddIcon,
  activeIconType = null,
  onCancelPlacement,
  iconDefinitions = SAFETY_ICONS,
  onAddText,
  placementTextActive = false,
  onCancelTextPlacement,
  onAddSvg,
  onDeleteSvg,
  onRenameSvg,
}: IconToolbarProps) {
  const [search, setSearch] = useState("");
  const [svgModalOpen, setSvgModalOpen] = useState(false);
  const [svgName, setSvgName] = useState("");
  const [svgCode, setSvgCode] = useState(EMPTY_SVG_TEMPLATE);
  const [svgSaving, setSvgSaving] = useState(false);
  const [svgError, setSvgError] = useState("");
  const [deletingIconType, setDeletingIconType] = useState<IconType | null>(null);
  const [renamingIconType, setRenamingIconType] = useState<IconType | null>(null);
  const [libraryError, setLibraryError] = useState("");
  const svgFileInputRef = useRef<HTMLInputElement>(null);

  const iconsList = Object.values(iconDefinitions).filter((icon) =>
    icon.label.toLowerCase().includes(search.toLowerCase())
  );
  const activeLibraryIcon = activeIconType ? iconDefinitions[activeIconType] : null;

  const closeSvgModal = () => {
    if (svgSaving) return;
    setSvgModalOpen(false);
    setSvgName("");
    setSvgCode(EMPTY_SVG_TEMPLATE);
    setSvgError("");
  };

  const handleSvgFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".svg")) {
      setSvgError("Sélectionnez un fichier portant l’extension .svg.");
      return;
    }
    if (file.size > MAX_SVG_BYTES) {
      setSvgError("Le fichier dépasse la taille maximale de 250 Ko.");
      return;
    }

    try {
      const source = await file.text();
      setSvgCode(source);
      setSvgName((current) => current || file.name.replace(/\.svg$/i, ""));
      setSvgError("");
    } catch {
      setSvgError("Impossible de lire ce fichier SVG.");
    }
  };

  const handleAddSvg = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onAddSvg || svgSaving) return;
    if (!svgName.trim()) {
      setSvgError("Donnez un nom au pictogramme.");
      return;
    }
    if (!svgCode.trim()) {
      setSvgError("Importez un SVG ou collez son code.");
      return;
    }

    setSvgSaving(true);
    setSvgError("");
    try {
      await onAddSvg({ name: svgName.trim(), svg: svgCode });
      setSearch("");
      setSvgModalOpen(false);
      setSvgName("");
      setSvgCode(EMPTY_SVG_TEMPLATE);
    } catch (error) {
      setSvgError(error instanceof Error ? error.message : "Le SVG n’a pas pu être ajouté.");
    } finally {
      setSvgSaving(false);
    }
  };

  const handleDeleteSvg = async (icon: SafetyIconDefinition) => {
    if (!onDeleteSvg || !icon.deletable || deletingIconType) return;
    const confirmed = window.confirm(
      `Supprimer définitivement « ${icon.label} » de la bibliothèque ?`
    );
    if (!confirmed) return;

    setDeletingIconType(icon.type);
    setLibraryError("");
    try {
      await onDeleteSvg(icon);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "Le SVG n’a pas pu être supprimé.");
    } finally {
      setDeletingIconType(null);
    }
  };

  const handleRenameSvg = async (icon: SafetyIconDefinition) => {
    if (!onRenameSvg || !icon.deletable || renamingIconType || deletingIconType) return;
    const requestedName = window.prompt("Nouveau nom du pictogramme SVG :", icon.label);
    if (requestedName === null) return;
    const name = requestedName.trim();
    if (!name) {
      setLibraryError("Le nom du pictogramme ne peut pas être vide.");
      return;
    }
    if (name === icon.label) return;

    setRenamingIconType(icon.type);
    setLibraryError("");
    try {
      await onRenameSvg(icon, name);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "Le SVG n’a pas pu être renommé.");
    } finally {
      setRenamingIconType(null);
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#252527]">
      {/* Panel title */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-black/40 px-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">
          Équipements
        </span>
        <div className="flex items-center gap-1">
          {onAddSvg && (
            <button
              type="button"
              onClick={() => setSvgModalOpen(true)}
              title="Créer ou importer un SVG"
              className="flex cursor-pointer items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-1 text-[9px] font-semibold text-emerald-300 hover:bg-emerald-500/20"
            >
              <Plus className="h-3 w-3" />
              SVG
            </button>
          )}
          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-neutral-500">
            {iconsList.length}
          </span>
        </div>
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
        {libraryError && (
          <div className="mt-2 flex items-start gap-1.5 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5">
            <p className="min-w-0 flex-1 text-[10px] leading-tight text-red-300">{libraryError}</p>
            <button
              type="button"
              onClick={() => setLibraryError("")}
              title="Fermer le message"
              className="cursor-pointer text-red-300/70 hover:text-red-200"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
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

      {activeLibraryIcon?.deletable && (
        <div className="shrink-0 border-b border-black/40 bg-sky-500/[0.06] px-2 py-2">
          <p className="truncate px-1 text-[10px] font-medium text-neutral-300" title={activeLibraryIcon.label}>
            SVG : {activeLibraryIcon.label}
          </p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => void handleRenameSvg(activeLibraryIcon)}
              disabled={Boolean(deletingIconType || renamingIconType)}
              className="flex cursor-pointer items-center justify-center gap-1 rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-1.5 text-[10px] font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {renamingIconType === activeLibraryIcon.type ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Pencil className="h-3 w-3" />
              )}
              Renommer
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteSvg(activeLibraryIcon)}
              disabled={Boolean(deletingIconType || renamingIconType)}
              className="flex cursor-pointer items-center justify-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-1.5 text-[10px] font-medium text-red-300 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {deletingIconType === activeLibraryIcon.type ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              Supprimer
            </button>
          </div>
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
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-2">
        <div className="grid grid-cols-2 gap-1.5">
          {iconsList.map((icon) => {
            const isActive = activeIconType === icon.type;
            const isDeleting = deletingIconType === icon.type;
            const isRenaming = renamingIconType === icon.type;
            return (
              <div key={icon.type} className="group/item relative min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    if (isActive && onCancelPlacement) {
                      onCancelPlacement();
                      return;
                    }
                    onAddIcon(icon.type);
                  }}
                  title={icon.label}
                  className={`group flex h-full w-full cursor-pointer flex-col items-center justify-start gap-1 rounded border p-1.5 transition-colors ${
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

                {onRenameSvg && icon.deletable && (
                  <button
                    type="button"
                    onClick={() => void handleRenameSvg(icon)}
                    disabled={Boolean(deletingIconType || renamingIconType)}
                    title={`Renommer ${icon.label}`}
                    className="absolute right-7 top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded bg-[#252527]/95 text-neutral-400 opacity-80 shadow transition hover:bg-sky-500/20 hover:text-sky-300 hover:opacity-100 focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isRenaming ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Pencil className="h-3 w-3" />
                    )}
                  </button>
                )}

                {onDeleteSvg && icon.deletable && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteSvg(icon)}
                    disabled={Boolean(deletingIconType || renamingIconType)}
                    title={`Supprimer définitivement ${icon.label}`}
                    className="absolute right-1 top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded bg-[#252527]/95 text-neutral-400 opacity-80 shadow transition hover:bg-red-500/20 hover:text-red-300 hover:opacity-100 focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isDeleting ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {iconsList.length === 0 && (
          <p className="px-2 py-6 text-center text-[11px] text-neutral-600">
            Aucun équipement ne correspond à « {search} ».
          </p>
        )}
      </div>

      {svgModalOpen && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSvgModal();
          }}
        >
          <form
            onSubmit={handleAddSvg}
            role="dialog"
            aria-modal="true"
            aria-labelledby="svg-library-title"
            className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#252527] shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-black/40 px-4 py-3">
              <div>
                <h2 id="svg-library-title" className="text-sm font-semibold text-white">
                  Créer ou ajouter un SVG
                </h2>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  Le pictogramme sera ajouté à la bibliothèque de l’éditeur.
                </p>
              </div>
              <button
                type="button"
                onClick={closeSvgModal}
                disabled={svgSaving}
                title="Fermer"
                className="cursor-pointer rounded p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 overflow-y-auto p-4">
              <label className="block text-[11px] font-medium text-neutral-300">
                Nom du pictogramme
                <input
                  autoFocus
                  type="text"
                  maxLength={80}
                  value={svgName}
                  onChange={(event) => setSvgName(event.target.value)}
                  placeholder="Ex. Sortie de secours personnalisée"
                  className="mt-1.5 w-full rounded border border-black/50 bg-[#1b1b1d] px-3 py-2 text-xs text-neutral-100 placeholder-neutral-600 focus:border-emerald-500/60 focus:outline-none"
                />
              </label>

              <input
                ref={svgFileInputRef}
                type="file"
                accept=".svg,image/svg+xml"
                onChange={handleSvgFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => svgFileInputRef.current?.click()}
                className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-neutral-600 bg-white/[0.03] px-3 py-3 text-xs font-medium text-neutral-300 hover:border-emerald-500/50 hover:bg-emerald-500/5 hover:text-white"
              >
                <Upload className="h-4 w-4" />
                Importer un fichier .svg
              </button>

              <div className="my-3 flex items-center gap-3 text-[10px] uppercase tracking-wider text-neutral-600">
                <span className="h-px flex-1 bg-white/10" />
                ou créer / coller le code
                <span className="h-px flex-1 bg-white/10" />
              </div>

              <label className="block text-[11px] font-medium text-neutral-300">
                Code SVG
                <div className="relative mt-1.5">
                  <FileCode2 className="pointer-events-none absolute right-2 top-2 h-4 w-4 text-neutral-600" />
                  <textarea
                    value={svgCode}
                    onChange={(event) => setSvgCode(event.target.value)}
                    spellCheck={false}
                    rows={11}
                    className="min-h-44 w-full resize-y rounded border border-black/50 bg-[#151517] p-3 pr-8 font-mono text-[11px] leading-relaxed text-neutral-300 focus:border-emerald-500/60 focus:outline-none"
                  />
                </div>
              </label>

              <p className="mt-2 text-[10px] leading-relaxed text-neutral-500">
                Conditions : format carré avec un <code className="text-neutral-400">viewBox</code> (par exemple 0 0 170 170), 250 Ko maximum, sans script, image ou lien externe.
              </p>

              {svgError && (
                <p className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
                  {svgError}
                </p>
              )}
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-black/40 px-4 py-3">
              <button
                type="button"
                onClick={closeSvgModal}
                disabled={svgSaving}
                className="cursor-pointer rounded border border-white/10 px-3 py-2 text-xs font-medium text-neutral-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={svgSaving}
                className="flex cursor-pointer items-center gap-2 rounded bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {svgSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Ajouter à la bibliothèque
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}
