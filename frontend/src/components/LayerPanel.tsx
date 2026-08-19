"use client";

import React from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Eye,
  EyeOff,
  FileImage,
  GripVertical,
  Image as ImageIcon,
  Lock,
  MapPin,
  Shapes,
  Type,
  Unlock,
} from "lucide-react";

export type EditorLayerKind = "main" | "overlay" | "shape" | "icon" | "text";
export type LayerMoveDirection = "front" | "up" | "down" | "back";

export interface EditorLayerItem {
  id: string;
  kind: EditorLayerKind;
  label: string;
  visible: boolean;
  locked: boolean;
  zIndex: number;
}

interface LayerPanelProps {
  items: EditorLayerItem[];
  selectedId: string | null;
  onSelect: (item: EditorLayerItem) => void;
  onToggleVisibility: (item: EditorLayerItem) => void;
  onToggleLock: (item: EditorLayerItem) => void;
  onMove: (id: string, direction: LayerMoveDirection) => void;
  onReorder: (orderedIds: string[]) => void;
}

const KIND_LABELS: Record<EditorLayerKind, string> = {
  main: "Plan principal",
  overlay: "Plan secondaire",
  shape: "Forme",
  icon: "Pictogramme",
  text: "Texte",
};

function LayerKindIcon({ kind }: { kind: EditorLayerKind }) {
  const className = "h-3.5 w-3.5 shrink-0";
  if (kind === "main") return <FileImage className={`${className} text-sky-400`} />;
  if (kind === "overlay") return <ImageIcon className={`${className} text-indigo-400`} />;
  if (kind === "shape") return <Shapes className={`${className} text-amber-400`} />;
  if (kind === "icon") return <MapPin className={`${className} text-emerald-400`} />;
  return <Type className={`${className} text-violet-400`} />;
}

export default function LayerPanel({
  items,
  selectedId,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onMove,
  onReorder,
}: LayerPanelProps) {
  const [draggedId, setDraggedId] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<{
    id: string;
    position: "before" | "after";
  } | null>(null);
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : null;

  const getDropPosition = (
    event: React.DragEvent<HTMLDivElement>
  ): "before" | "after" => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>, targetId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = draggedId || event.dataTransfer.getData("text/plain");
    const position = getDropPosition(event);
    setDraggedId(null);
    setDropTarget(null);
    if (!sourceId || sourceId === targetId) return;

    const orderedIds = items.map((item) => item.id).filter((id) => id !== sourceId);
    const targetIndex = orderedIds.indexOf(targetId);
    if (targetIndex < 0) return;
    orderedIds.splice(targetIndex + (position === "after" ? 1 : 0), 0, sourceId);
    onReorder(orderedIds);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#252527]">
      <div className="shrink-0 border-b border-black/40 px-3 py-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-300">Calques</p>
        <p className="mt-1 text-[9px] leading-3.5 text-neutral-500">
          Glissez la poignée pour changer l’ordre. Le calque du haut apparaît devant.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {items.map((item) => {
          const isSelected = item.id === selectedId;
          return (
            <div
              key={item.id}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const position = getDropPosition(event);
                setDropTarget((current) =>
                  current?.id === item.id && current.position === position
                    ? current
                    : { id: item.id, position }
                );
              }}
              onDrop={(event) => handleDrop(event, item.id)}
              className={`relative mb-1 flex min-w-0 items-center gap-1 rounded border transition-colors ${
                isSelected
                  ? "border-sky-500/60 bg-sky-500/15"
                  : "border-transparent bg-black/10 hover:border-white/10 hover:bg-white/[0.06]"
              } ${item.visible ? "" : "opacity-55"} ${draggedId === item.id ? "opacity-35" : ""}`}
            >
              {dropTarget?.id === item.id && dropTarget.position === "before" && (
                <span className="pointer-events-none absolute -top-[3px] left-1 right-1 z-10 h-0.5 rounded bg-sky-400" />
              )}
              {dropTarget?.id === item.id && dropTarget.position === "after" && (
                <span className="pointer-events-none absolute -bottom-[3px] left-1 right-1 z-10 h-0.5 rounded bg-sky-400" />
              )}
              <button
                type="button"
                draggable
                onDragStart={(event) => {
                  setDraggedId(item.id);
                  setDropTarget(null);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", item.id);
                }}
                onDragEnd={() => {
                  setDraggedId(null);
                  setDropTarget(null);
                }}
                onClick={() => onSelect(item)}
                title="Faire glisser pour changer l’ordre"
                aria-label={`Déplacer le calque ${item.label}`}
                className="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center text-neutral-600 hover:text-neutral-200 active:cursor-grabbing"
              >
                <GripVertical className="pointer-events-none h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onToggleVisibility(item)}
                title={item.visible ? "Masquer ce calque" : "Afficher ce calque"}
                className="flex h-8 w-7 shrink-0 cursor-pointer items-center justify-center text-neutral-400 hover:text-white"
              >
                {item.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => onSelect(item)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 pr-1 text-left"
                title={`${KIND_LABELS[item.kind]} — ${item.label}`}
              >
                <LayerKindIcon kind={item.kind} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[10px] font-semibold text-neutral-200">{item.label}</span>
                  <span className="block truncate text-[8px] uppercase tracking-wider text-neutral-500">
                    {KIND_LABELS[item.kind]}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onToggleLock(item)}
                title={item.locked ? "Déverrouiller cet objet" : "Verrouiller cet objet pour empêcher son déplacement"}
                aria-label={item.locked ? `Déverrouiller ${item.label}` : `Verrouiller ${item.label}`}
                aria-pressed={item.locked}
                className={`flex h-8 w-7 shrink-0 cursor-pointer items-center justify-center rounded transition-colors ${
                  item.locked
                    ? "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 hover:text-amber-300"
                    : "text-neutral-600 hover:bg-white/10 hover:text-neutral-200"
                }`}
              >
                {item.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
              </button>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-black/40 bg-black/15 p-2">
        <div className="grid grid-cols-4 gap-1">
          <button
            type="button"
            disabled={!selected || selectedIndex === 0}
            onClick={() => selected && onMove(selected.id, "front")}
            title="Mettre tout devant"
            className="flex h-7 cursor-pointer items-center justify-center rounded border border-white/10 text-neutral-400 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
          >
            <ChevronsUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={!selected || selectedIndex === 0}
            onClick={() => selected && onMove(selected.id, "up")}
            title="Avancer d’un niveau"
            className="flex h-7 cursor-pointer items-center justify-center rounded border border-white/10 text-neutral-400 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={!selected || selectedIndex === items.length - 1}
            onClick={() => selected && onMove(selected.id, "down")}
            title="Reculer d’un niveau"
            className="flex h-7 cursor-pointer items-center justify-center rounded border border-white/10 text-neutral-400 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={!selected || selectedIndex === items.length - 1}
            onClick={() => selected && onMove(selected.id, "back")}
            title="Mettre tout derrière"
            className="flex h-7 cursor-pointer items-center justify-center rounded border border-white/10 text-neutral-400 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
          >
            <ChevronsDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
