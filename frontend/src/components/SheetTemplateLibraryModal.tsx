"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CopyPlus, FilePlus2, Library, Trash2, X } from "lucide-react";
import type { SheetBlock, SheetTemplateKey } from "@/lib/sheetTemplates";

export interface SheetTemplateLibraryItem {
  id: string;
  template: SheetTemplateKey;
  name: string;
  description: string;
  width: number;
  height: number;
  blocks: SheetBlock[];
  kind: "builtin" | "custom";
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
  onDelete: (item: SheetTemplateLibraryItem) => void;
}

const visibleFill = (value?: string) => {
  if (!value || value === "none" || value === "transparent") return "#ffffff";
  return value;
};

const pictogramColor = (block: SheetBlock) => {
  if (block.color) return block.color;
  const key = `${block.iconType || ""} ${block.label || ""}`.toLowerCase();
  if (/extinct|incend|fire|ria|alarme/.test(key)) return "#e63329";
  if (/sortie|evac|issue|rassemblement|vous etes ici/.test(key)) return "#00a651";
  return "#2563eb";
};

function SheetTemplatePreview({ item, large = false }: { item: SheetTemplateLibraryItem; large?: boolean }) {
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
            return <rect key={key} x={block.x} y={block.y} width={block.width} height={block.height} fill="#f5f0e8" />;
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
  onDelete,
}: SheetTemplateLibraryModalProps) {
  const [selectedId, setSelectedId] = useState("");
  const [nameAction, setNameAction] = useState<"create" | "clone" | null>(null);
  const [templateName, setTemplateName] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelectedId((current) =>
      activeItemId && items.some((item) => item.id === activeItemId)
        ? activeItemId
        : items.some((item) => item.id === current)
          ? current
          : items[0]?.id || ""
    );
  }, [open, activeItemId, items]);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || items[0] || null,
    [items, selectedId]
  );

  const askForName = (action: "create" | "clone") => {
    setNameAction(action);
    setTemplateName(action === "clone" ? `Copie de ${selected?.name || "template"}` : "Nouveau template");
  };

  const submitName = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = templateName.trim();
    if (!selected || !name || !nameAction) return;
    if (nameAction === "clone") onClone(selected, name);
    else onCreate(selected, name);
    setNameAction(null);
  };

  if (!open || !selected) return null;

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

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(380px,0.9fr)_minmax(480px,1.3fr)]">
          <div className="min-h-0 overflow-y-auto border-r border-white/10 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => askForName("create")} className="inline-flex items-center gap-2 rounded-lg bg-brand-orange px-3 py-2 text-xs font-bold text-white transition hover:bg-brand-red">
                <FilePlus2 className="h-4 w-4" />
                Nouveau template
              </button>
              <button type="button" onClick={() => askForName("clone")} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:bg-white/10">
                <CopyPlus className="h-4 w-4" />
                Cloner le modèle choisi
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((item) => {
                const active = item.id === selected.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`overflow-hidden rounded-xl border text-left transition ${active ? "border-brand-orange bg-brand-orange/10 ring-2 ring-brand-orange/20" : "border-white/10 bg-black/20 hover:border-white/25 hover:bg-white/5"}`}
                  >
                    <div className="h-36 bg-[#d8d8dc]">
                      <SheetTemplatePreview item={item} />
                    </div>
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-xs font-bold text-neutral-100">{item.name}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide ${item.kind === "builtin" ? "bg-emerald-500/15 text-emerald-300" : "bg-violet-500/15 text-violet-300"}`}>
                          {item.kind === "builtin" ? "Par défaut" : "Personnel"}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex min-h-0 flex-col bg-[#1b1b1d]">
            <div className="shrink-0 border-b border-white/10 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-orange">Aperçu sélectionné</p>
                  <h3 className="mt-1 text-lg font-bold text-white">{selected.name}</h3>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-neutral-400">{selected.description}</p>
                </div>
                <span className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-neutral-400">
                  {selected.width < selected.height ? "Portrait" : "Paysage"}
                </span>
              </div>
            </div>
            <div className="min-h-0 flex-1 bg-[#bfc0c4]">
              <SheetTemplatePreview item={selected} large />
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-white/10 bg-[#242426] px-5 py-3.5">
              <button type="button" onClick={() => onUse(selected)} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500">
                Utiliser ce template
              </button>
              <button type="button" onClick={() => askForName("clone")} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:bg-white/10">
                <CopyPlus className="h-4 w-4" />
                Cloner et modifier
              </button>
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
          </div>
        </div>

        {nameAction && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm">
            <form onSubmit={submitName} className="w-full max-w-md rounded-2xl border border-white/10 bg-[#2d2d30] p-5 shadow-2xl">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-orange/15 text-brand-orange">
                  {nameAction === "clone" ? <CopyPlus className="h-5 w-5" /> : <FilePlus2 className="h-5 w-5" />}
                </span>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {nameAction === "clone" ? "Nommer le template cloné" : "Créer un nouveau template"}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-400">
                    {nameAction === "clone"
                      ? `Une copie indépendante de « ${selected.name} » sera créée.`
                      : `Le nouveau template utilisera le format de « ${selected.name} ».`}
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
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => setNameAction(null)} className="rounded-lg px-4 py-2 text-xs font-semibold text-neutral-400 transition hover:bg-white/10 hover:text-white">
                  Annuler
                </button>
                <button type="submit" disabled={!templateName.trim()} className="rounded-lg bg-brand-orange px-4 py-2 text-xs font-bold text-white transition hover:bg-brand-red disabled:cursor-not-allowed disabled:opacity-40">
                  {nameAction === "clone" ? "Cloner et ouvrir" : "Créer et ouvrir"}
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
