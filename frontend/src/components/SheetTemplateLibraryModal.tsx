"use client";

import React, { useMemo, useRef, useState } from "react";
import { CopyPlus, FilePlus2, FileUp, Library, Loader2, Lock, Trash2, X } from "lucide-react";
import {
  SHEET_DOCUMENT_TYPES,
  SHEET_TEMPLATE_STANDARDS,
} from "@/lib/sheetTemplates";
import { SAFETY_RED } from "@/utils/safetyIcons";
import type {
  SheetBlock,
  SheetDocumentTypeKey,
  SheetTemplateKey,
  SheetTemplateStandardKey,
} from "@/lib/sheetTemplates";

export interface SheetTemplateLibraryItem {
  id: string;
  template: SheetTemplateKey;
  name: string;
  description: string;
  width: number;
  height: number;
  blocks: SheetBlock[];
  kind: "builtin" | "custom";
  standard: SheetTemplateStandardKey;
  documentTypes: readonly SheetDocumentTypeKey[];
}

interface SheetTemplateLibraryModalProps {
  open: boolean;
  items: SheetTemplateLibraryItem[];
  activeItemId?: string;
  onClose: () => void;
  onUsePlanOnly: () => void;
  onUse: (item: SheetTemplateLibraryItem) => void;
  onClone: (item: SheetTemplateLibraryItem, name: string) => void;
  onCreate: (formatSource: SheetTemplateLibraryItem, name: string) => void;
  onImportPdf: (file: File, name: string) => Promise<void>;
  onDelete: (item: SheetTemplateLibraryItem) => void;
  images?: Partial<Record<string, HTMLImageElement | null>>;
}

const visibleFill = (value?: string) => {
  if (!value || value === "none" || value === "transparent") return "#ffffff";
  return value;
};

const pictogramColor = (block: SheetBlock) => {
  if (block.color) return block.color;
  const key = `${block.iconType || ""} ${block.label || ""}`.toLowerCase();
  if (/extinct|incend|fire|ria|alarme/.test(key)) return SAFETY_RED;
  if (/sortie|evac|issue|rassemblement|vous etes ici/.test(key)) return "#00a651";
  return "#2563eb";
};

function SheetTemplatePreview({
  item,
  large = false,
  images = {},
}: {
  item: SheetTemplateLibraryItem;
  large?: boolean;
  images?: Partial<Record<string, HTMLImageElement | null>>;
}) {
  const blocks = item.blocks.filter((block) => block.visible);
  return (
    <div className={`flex h-full w-full items-center justify-center overflow-hidden ${large ? "p-5" : "p-2"}`}>
      <svg
        viewBox={`0 0 ${item.width} ${item.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full drop-shadow-[0_8px_16px_rgba(0,0,0,0.25)]"
        role="img"
        aria-label={`Aperçu du template ${item.name}`}
      >
        <rect width={item.width} height={item.height} fill="#ffffff" />
        {blocks.map((block, index) => {
          const transform = block.rotation
            ? `rotate(${block.rotation} ${block.x + block.width / 2} ${block.y + block.height / 2})`
            : undefined;
          const key = `${block.id}-${index}`;
          if (block.kind === "background") {
            const image = block.imageKey ? images[block.imageKey] : null;
            return image ? (
              <image key={key} href={image.src} x={block.x} y={block.y} width={block.width} height={block.height} preserveAspectRatio="none" />
            ) : (
              <rect key={key} x={block.x} y={block.y} width={block.width} height={block.height} fill="#f5f0e8" />
            );
          }
          if (block.kind === "plan") {
            return (
              <g key={key} transform={transform}>
                <rect x={block.x} y={block.y} width={block.width} height={block.height} fill="#f8fafc" stroke={block.stroke || "#64748b"} strokeWidth={Math.max(1.5, block.strokeWidth || 1)} />
                <path d={`M ${block.x} ${block.y + block.height * 0.28} H ${block.x + block.width} M ${block.x + block.width * 0.34} ${block.y} V ${block.y + block.height} M ${block.x + block.width * 0.7} ${block.y} V ${block.y + block.height}`} stroke="#cbd5e1" strokeWidth="1.5" />
                <text x={block.x + block.width / 2} y={block.y + block.height / 2} textAnchor="middle" dominantBaseline="middle" fill="#94a3b8" fontSize={Math.max(12, Math.min(34, block.width / 10))} fontWeight="700">PLAN</text>
              </g>
            );
          }
          if (block.kind === "shape") {
            const stroke = block.stroke || block.color || "#111827";
            if (block.shapeType === "line") {
              return <line key={key} x1={block.x} y1={block.y} x2={block.x + block.width} y2={block.y + block.height} stroke={stroke} strokeWidth={Math.max(2, block.strokeWidth || 2)} transform={transform} />;
            }
            return <rect key={key} x={block.x} y={block.y} width={block.width} height={block.height} rx={block.cornerRadius || 0} fill={visibleFill(block.fill)} fillOpacity={block.fillOpacity ?? 0.25} stroke={stroke} strokeWidth={Math.max(1.5, block.strokeWidth || 1)} transform={transform} />;
          }
          if (block.kind === "picto") {
            const color = pictogramColor(block);
            return (
              <g key={key} transform={transform}>
                <rect x={block.x} y={block.y} width={block.width} height={block.height} rx={Math.min(block.width, block.height) * 0.12} fill={color} />
                <path d={`M ${block.x + block.width * 0.25} ${block.y + block.height * 0.5} H ${block.x + block.width * 0.75} M ${block.x + block.width * 0.5} ${block.y + block.height * 0.25} V ${block.y + block.height * 0.75}`} stroke="#ffffff" strokeWidth={Math.max(2, Math.min(block.width, block.height) * 0.1)} />
              </g>
            );
          }
          if (block.kind === "image") {
            return (
              <g key={key} transform={transform}>
                <rect x={block.x} y={block.y} width={block.width} height={block.height} rx="4" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.5" />
                <text x={block.x + block.width / 2} y={block.y + block.height / 2} textAnchor="middle" dominantBaseline="middle" fill="#64748b" fontSize={Math.max(7, Math.min(18, block.height / 3))} fontWeight="700">LOGO</text>
              </g>
            );
          }
          const copy = (block.text || block.title || block.label || "").replace(/\s+/g, " ").trim().slice(0, large ? 60 : 28);
          return (
            <g key={key} transform={transform}>
              <rect x={block.x} y={block.y} width={block.width} height={block.height} rx={block.cornerRadius || 0} fill={visibleFill(block.fill)} stroke={block.stroke || "none"} strokeWidth={block.strokeWidth || 0} />
              {copy && (
                <text
                  x={block.x + (block.align === "center" ? block.width / 2 : Math.max(3, block.padding || 4))}
                  y={block.y + block.height / 2}
                  textAnchor={block.align === "center" ? "middle" : "start"}
                  dominantBaseline="middle"
                  fill={block.color || "#1f2937"}
                  fontSize={Math.max(5, Math.min(block.fontSize || 12, block.height * 0.42))}
                  fontWeight={block.fontStyle?.includes("bold") ? "700" : "500"}
                >
                  {copy}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function SheetTemplateLibraryModal({
  open,
  items,
  activeItemId,
  onClose,
  onUsePlanOnly,
  onUse,
  onClone,
  onCreate,
  onImportPdf,
  onDelete,
  images = {},
}: SheetTemplateLibraryModalProps) {
  const [selectedId, setSelectedId] = useState("");
  const [nameAction, setNameAction] = useState<"create" | "clone" | "pdf" | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);
  const [importingPdf, setImportingPdf] = useState(false);
  const [pdfImportError, setPdfImportError] = useState("");
  const [selectedStandard, setSelectedStandard] = useState<SheetTemplateStandardKey>("nfx08070");
  const [selectedDocumentType, setSelectedDocumentType] = useState<SheetDocumentTypeKey | "all">("all");
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const standard = SHEET_TEMPLATE_STANDARDS[selectedStandard];
  const documentTypeCounts = useMemo(() => {
    const counts = Object.fromEntries(
      standard.documentTypes.map((documentType) => [documentType, 0])
    ) as Record<SheetDocumentTypeKey, number>;
    items
      .filter((item) => item.standard === selectedStandard)
      .forEach((item) => {
        item.documentTypes.forEach((documentType) => {
          counts[documentType] = (counts[documentType] || 0) + 1;
        });
      });
    return counts;
  }, [items, selectedStandard, standard.documentTypes]);

  const filteredItems = useMemo(
    () => items.filter((item) =>
      item.standard === selectedStandard
      && (selectedDocumentType === "all" || item.documentTypes.includes(selectedDocumentType))
    ),
    [items, selectedDocumentType, selectedStandard]
  );

  const selected = useMemo(
    () => filteredItems.find((item) => item.id === selectedId)
      || filteredItems.find((item) => item.id === activeItemId)
      || filteredItems[0]
      || null,
    [filteredItems, selectedId, activeItemId]
  );

  const askForName = (action: "create" | "clone") => {
    setNameAction(action);
    setTemplateName(action === "clone" ? `Copie de ${selected?.name || "template"}` : "Nouveau template");
  };

  const submitName = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = templateName.trim();
    if (!name || !nameAction) return;
    if (nameAction === "pdf" && pendingPdfFile) {
      setImportingPdf(true);
      setPdfImportError("");
      try {
        await onImportPdf(pendingPdfFile, name);
        setNameAction(null);
        setPendingPdfFile(null);
      } catch (error) {
        setPdfImportError(error instanceof Error ? error.message : "Impossible d’importer le PDF.");
      } finally {
        setImportingPdf(false);
      }
      return;
    }
    if (!selected) return;
    if (nameAction === "clone") onClone(selected, name);
    else onCreate(selected, name);
    setNameAction(null);
  };

  const selectPdf = (file?: File) => {
    if (!file) return;
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setPdfImportError("Sélectionnez un fichier PDF.");
      return;
    }
    setPendingPdfFile(file);
    setTemplateName(file.name.replace(/\.pdf$/i, "").trim() || "Template PDF");
    setPdfImportError("");
    setNameAction("pdf");
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
      <div className="relative flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#242426] text-neutral-100 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-orange/15 text-brand-orange">
              <Library className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-bold">Bibliothèque des templates</h2>
              <p className="text-[11px] text-neutral-400">Cliquez un modèle pour voir son titre et son design intérieur.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} title="Fermer" className="rounded-lg p-2 text-neutral-400 transition hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="shrink-0 border-b border-white/10 bg-black/15 px-5 py-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
            <label className="block w-full shrink-0 xl:w-56">
              <span className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">
                Norme
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[8px] text-emerald-300">Par défaut</span>
              </span>
              <select
                value={selectedStandard}
                onChange={(event) => {
                  setSelectedStandard(event.target.value as SheetTemplateStandardKey);
                  setSelectedDocumentType("all");
                  setSelectedId("");
                }}
                className="w-full rounded-xl border border-white/15 bg-[#1b1b1d] px-3 py-2.5 text-sm font-semibold text-white outline-none transition focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/20"
              >
                {(Object.entries(SHEET_TEMPLATE_STANDARDS) as Array<[
                  SheetTemplateStandardKey,
                  (typeof SHEET_TEMPLATE_STANDARDS)[SheetTemplateStandardKey]
                ]>).map(([standardKey, definition]) => (
                  <option key={standardKey} value={standardKey}>{definition.label}</option>
                ))}
              </select>
            </label>

            <div className="min-w-0 flex-1">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-brand-orange">
                Étape 1 — Type de document
              </p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par type de document">
                <button
                  type="button"
                  aria-pressed={selectedDocumentType === "all"}
                  onClick={() => { setSelectedDocumentType("all"); setSelectedId(""); }}
                  className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold transition ${selectedDocumentType === "all" ? "border-brand-orange bg-brand-orange text-white shadow-lg shadow-brand-orange/10" : "border-white/10 bg-white/5 text-neutral-300 hover:border-white/25 hover:bg-white/10"}`}
                >
                  Tous les types <span className="ml-1 text-[10px] opacity-70">{items.filter((item) => item.standard === selectedStandard).length}</span>
                </button>
                {standard.documentTypes.map((documentType) => {
                  const active = selectedDocumentType === documentType;
                  return (
                    <button
                      key={documentType}
                      type="button"
                      aria-pressed={active}
                      onClick={() => { setSelectedDocumentType(documentType); setSelectedId(""); }}
                      className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold transition ${active ? "border-brand-orange bg-brand-orange text-white shadow-lg shadow-brand-orange/10" : "border-white/10 bg-white/5 text-neutral-300 hover:border-white/25 hover:bg-white/10"}`}
                    >
                      {SHEET_DOCUMENT_TYPES[documentType].label}
                      <span className="ml-1 text-[10px] opacity-70">{documentTypeCounts[documentType]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(380px,0.9fr)_minmax(480px,1.3fr)]">
          <div className="min-h-0 overflow-y-auto border-r border-white/10 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(event) => {
                  selectPdf(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <button type="button" onClick={() => pdfInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-500">
                <FileUp className="h-4 w-4" />
                Importer un PDF
              </button>
              <button type="button" disabled={!selected} onClick={() => askForName("create")} className="inline-flex items-center gap-2 rounded-lg bg-brand-orange px-3 py-2 text-xs font-bold text-white transition hover:bg-brand-red disabled:cursor-not-allowed disabled:opacity-40">
                <FilePlus2 className="h-4 w-4" />
                Nouveau template
              </button>
              <button type="button" disabled={!selected} onClick={() => askForName("clone")} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">
                <CopyPlus className="h-4 w-4" />
                Cloner le modèle choisi
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {filteredItems.map((item) => {
                const active = item.id === selected?.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`overflow-hidden rounded-xl border text-left transition ${active ? "border-brand-orange bg-brand-orange/10 ring-2 ring-brand-orange/20" : "border-white/10 bg-black/20 hover:border-white/25 hover:bg-white/5"}`}
                  >
                    <div className="h-36 bg-[#d8d8dc]">
                      <SheetTemplatePreview item={item} images={images} />
                    </div>
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-xs font-bold text-neutral-100">{item.name}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide ${item.kind === "builtin" ? "bg-emerald-500/15 text-emerald-300" : "bg-violet-500/15 text-violet-300"}`}>
                          {item.kind === "builtin" ? "Par défaut verrouillé" : "Personnel"}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.documentTypes.map((documentType) => (
                          <span key={documentType} className="rounded-md bg-white/[0.07] px-1.5 py-1 text-[9px] font-semibold text-neutral-400">
                            {SHEET_DOCUMENT_TYPES[documentType].label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })}
              {!filteredItems.length && (
                <div className="col-span-full rounded-xl border border-dashed border-white/15 bg-black/20 px-5 py-10 text-center">
                  <p className="text-sm font-semibold text-neutral-200">Aucun template pour ce type</p>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                    La catégorie est prête pour les futurs modèles conformes à {standard.label}.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col bg-[#1b1b1d]">
            {selected ? <>
              <div className="shrink-0 border-b border-white/10 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-orange">Aperçu sélectionné</p>
                  <h3 className="mt-1 text-lg font-bold text-white">{selected.name}</h3>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-neutral-400">{selected.description}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-[9px] font-bold text-emerald-300">{SHEET_TEMPLATE_STANDARDS[selected.standard].label}</span>
                    {selected.documentTypes.map((documentType) => (
                      <span key={documentType} className="rounded-md bg-brand-orange/10 px-2 py-1 text-[9px] font-bold text-brand-orange">
                        {SHEET_DOCUMENT_TYPES[documentType].label}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-neutral-400">
                  {selected.width < selected.height ? "Portrait" : "Paysage"}
                </span>
              </div>
            </div>
            <div className="min-h-0 flex-1 bg-[#bfc0c4]">
              <SheetTemplatePreview item={selected} large images={images} />
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-white/10 bg-[#242426] px-5 py-3.5">
              <button type="button" onClick={() => onUse(selected)} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500">
                Utiliser ce template
              </button>
              <button type="button" onClick={() => askForName("clone")} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:bg-white/10">
                <CopyPlus className="h-4 w-4" />
                Cloner et modifier
              </button>
              {selected.kind === "builtin" && (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[10px] font-semibold text-amber-300">
                  <Lock className="h-3.5 w-3.5" />
                  Original protégé
                </span>
              )}
              <button type="button" onClick={onUsePlanOnly} className="rounded-lg px-3 py-2 text-xs font-semibold text-neutral-400 transition hover:bg-white/10 hover:text-white">
                Afficher le plan seul
              </button>
              {selected.kind === "custom" && (
                <button type="button" onClick={() => onDelete(selected)} className="ml-auto inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-500/10 hover:text-red-300">
                  <Trash2 className="h-4 w-4" />
                  Supprimer
                </button>
              )}
            </div>
            </> : (
              <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
                <div>
                  <Library className="mx-auto h-9 w-9 text-neutral-600" />
                  <p className="mt-3 text-sm font-semibold text-neutral-300">Aucun aperçu disponible</p>
                  <p className="mt-1 text-xs text-neutral-500">Choisissez un autre type de document.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {nameAction && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm">
            <form onSubmit={submitName} className="w-full max-w-md rounded-2xl border border-white/10 bg-[#2d2d30] p-5 shadow-2xl">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-orange/15 text-brand-orange">
                  {nameAction === "clone" ? <CopyPlus className="h-5 w-5" /> : nameAction === "pdf" ? <FileUp className="h-5 w-5" /> : <FilePlus2 className="h-5 w-5" />}
                </span>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {nameAction === "clone" ? "Nommer le template cloné" : nameAction === "pdf" ? "Importer le template PDF" : "Créer un nouveau template"}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-400">
                    {nameAction === "clone"
                      ? `Une copie indépendante de « ${selected?.name || "ce template"} » sera créée.`
                      : nameAction === "pdf"
                        ? `Chaque page de « ${pendingPdfFile?.name || "ce PDF"} » deviendra un template personnel avec un fond verrouillé.`
                      : `Le nouveau template utilisera le format de « ${selected?.name || "ce template"} ».`}
                  </p>
                </div>
              </div>
              <label className="mt-5 block text-xs font-semibold text-neutral-300" htmlFor="new-sheet-template-name">
                Nom du template
              </label>
              <input
                id="new-sheet-template-name"
                autoFocus
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                className="mt-2 w-full rounded-xl border border-white/15 bg-black/25 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/20"
                placeholder="Ex. Plan d’évacuation hôtel"
              />
              {pdfImportError && nameAction === "pdf" && (
                <p className="mt-2 text-xs font-medium text-red-400">{pdfImportError}</p>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" disabled={importingPdf} onClick={() => { setNameAction(null); setPendingPdfFile(null); }} className="rounded-lg px-4 py-2 text-xs font-semibold text-neutral-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40">
                  Annuler
                </button>
                <button type="submit" disabled={!templateName.trim() || importingPdf} className="inline-flex items-center gap-2 rounded-lg bg-brand-orange px-4 py-2 text-xs font-bold text-white transition hover:bg-brand-red disabled:cursor-not-allowed disabled:opacity-40">
                  {importingPdf && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {nameAction === "clone" ? "Cloner et ouvrir" : nameAction === "pdf" ? "Importer et ouvrir" : "Créer et ouvrir"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

export default SheetTemplateLibraryModal;
