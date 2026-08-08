"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { X, Crop, Check, RotateCcw, Loader2, Sparkles, Move, Maximize2 } from "lucide-react";

interface CropRect {
  x: number; // 0..1 normalized
  y: number; // 0..1 normalized
  width: number; // 0..1 normalized
  height: number; // 0..1 normalized
}

interface CropModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  onApplyCrop: (crop: CropRect) => Promise<void>;
  loading: boolean;
}

export function CropModal({
  isOpen,
  onClose,
  imageUrl,
  onApplyCrop,
  loading,
}: CropModalProps) {
  const [crop, setCrop] = useState<CropRect>({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragHandle, setDragHandle] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [cropStart, setCropStart] = useState<CropRect>({ x: 0, y: 0, width: 1, height: 1 });

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setCrop({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 });
    }
  }, [isOpen]);

  const handlePointerDown = (handle: string | null, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    setIsDragging(true);
    setDragHandle(handle);
    setDragStart({ x: e.clientX, y: e.clientY });
    setCropStart({ ...crop });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const dx = (e.clientX - dragStart.x) / rect.width;
    const dy = (e.clientY - dragStart.y) / rect.height;

    let newX = cropStart.x;
    let newY = cropStart.y;
    let newW = cropStart.width;
    let newH = cropStart.height;

    if (dragHandle === "move") {
      newX = Math.max(0, Math.min(1 - cropStart.width, cropStart.x + dx));
      newY = Math.max(0, Math.min(1 - cropStart.height, cropStart.y + dy));
    } else if (dragHandle === "nw") {
      const maxX = cropStart.x + cropStart.width - 0.05;
      const maxY = cropStart.y + cropStart.height - 0.05;
      newX = Math.max(0, Math.min(maxX, cropStart.x + dx));
      newY = Math.max(0, Math.min(maxY, cropStart.y + dy));
      newW = cropStart.x + cropStart.width - newX;
      newH = cropStart.y + cropStart.height - newY;
    } else if (dragHandle === "ne") {
      const maxY = cropStart.y + cropStart.height - 0.05;
      newY = Math.max(0, Math.min(maxY, cropStart.y + dy));
      newW = Math.max(0.05, Math.min(1 - cropStart.x, cropStart.width + dx));
      newH = cropStart.y + cropStart.height - newY;
    } else if (dragHandle === "sw") {
      const maxX = cropStart.x + cropStart.width - 0.05;
      newX = Math.max(0, Math.min(maxX, cropStart.x + dx));
      newW = cropStart.x + cropStart.width - newX;
      newH = Math.max(0.05, Math.min(1 - cropStart.y, cropStart.height + dy));
    } else if (dragHandle === "se") {
      newW = Math.max(0.05, Math.min(1 - cropStart.x, cropStart.width + dx));
      newH = Math.max(0.05, Math.min(1 - cropStart.y, cropStart.height + dy));
    } else if (dragHandle === "n") {
      const maxY = cropStart.y + cropStart.height - 0.05;
      newY = Math.max(0, Math.min(maxY, cropStart.y + dy));
      newH = cropStart.y + cropStart.height - newY;
    } else if (dragHandle === "s") {
      newH = Math.max(0.05, Math.min(1 - cropStart.y, cropStart.height + dy));
    } else if (dragHandle === "w") {
      const maxX = cropStart.x + cropStart.width - 0.05;
      newX = Math.max(0, Math.min(maxX, cropStart.x + dx));
      newW = cropStart.x + cropStart.width - newX;
    } else if (dragHandle === "e") {
      newW = Math.max(0.05, Math.min(1 - cropStart.x, cropStart.width + dx));
    }

    setCrop({
      x: Number(newX.toFixed(4)),
      y: Number(newY.toFixed(4)),
      width: Number(newW.toFixed(4)),
      height: Number(newH.toFixed(4)),
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      setDragHandle(null);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="flex max-h-[95vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30">
              <Crop className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Rogner / Croper le plan</h2>
              <p className="text-xs text-slate-400">
                Ajustez le cadre pour conserver uniquement la zone souhaitée du plan d&apos;arrière-plan.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-auto p-6 flex flex-col items-center justify-center">
          {/* Quick Presets Toolbar */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-400">Présélections :</span>
            <button
              type="button"
              onClick={() => setCrop({ x: 0, y: 0, width: 1, height: 1 })}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 hover:bg-slate-700 transition-colors"
            >
              🎯 100% Plan entier
            </button>
            <button
              type="button"
              onClick={() => setCrop({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 })}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 hover:bg-slate-700 transition-colors"
            >
              🔍 80% Cadre central
            </button>
            <button
              type="button"
              onClick={() => setCrop({ x: 0, y: 0, width: 0.5, height: 1 })}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 hover:bg-slate-700 transition-colors"
            >
              📐 Moitié Gauche
            </button>
            <button
              type="button"
              onClick={() => setCrop({ x: 0.5, y: 0, width: 0.5, height: 1 })}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 hover:bg-slate-700 transition-colors"
            >
              📐 Moitié Droite
            </button>
          </div>

          {/* Interactive Image Container */}
          <div
            ref={containerRef}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="relative max-h-[60vh] max-w-full select-none overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-inner"
            style={{ touchAction: "none" }}
          >
            {/* Base Image */}
            <img
              src={imageUrl}
              alt="Plan source à rogner"
              className="max-h-[60vh] w-auto max-w-full object-contain pointer-events-none"
            />

            {/* Dark Mask Outside Selection */}
            <div
              className="absolute inset-0 bg-slate-950/60 pointer-events-none"
              style={{
                clipPath: `polygon(
                  0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
                  ${crop.x * 100}% ${crop.y * 100}%,
                  ${crop.x * 100}% ${(crop.y + crop.height) * 100}%,
                  ${(crop.x + crop.width) * 100}% ${(crop.y + crop.height) * 100}%,
                  ${(crop.x + crop.width) * 100}% ${crop.y * 100}%,
                  ${crop.x * 100}% ${crop.y * 100}%
                )`,
              }}
            />

            {/* Draggable Crop Rectangle */}
            <div
              className="absolute cursor-move border-2 border-sky-400 shadow-[0_0_15px_rgba(56,189,248,0.5)] transition-shadow"
              style={{
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.width * 100}%`,
                height: `${crop.height * 100}%`,
              }}
              onPointerDown={(e) => handlePointerDown("move", e)}
            >
              {/* Grid Lines inside crop rectangle */}
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none border border-sky-400/30">
                <div className="border-r border-b border-sky-400/20" />
                <div className="border-r border-b border-sky-400/20" />
                <div className="border-b border-sky-400/20" />
                <div className="border-r border-b border-sky-400/20" />
                <div className="border-r border-b border-sky-400/20" />
                <div className="border-b border-sky-400/20" />
                <div className="border-r border-sky-400/20" />
                <div className="border-r border-sky-400/20" />
                <div />
              </div>

              {/* Corner & Side Drag Handles */}
              <div
                onPointerDown={(e) => handlePointerDown("nw", e)}
                className="absolute -left-2 -top-2 h-4 w-4 rounded-full border-2 border-white bg-sky-500 shadow cursor-nwse-resize"
              />
              <div
                onPointerDown={(e) => handlePointerDown("ne", e)}
                className="absolute -right-2 -top-2 h-4 w-4 rounded-full border-2 border-white bg-sky-500 shadow cursor-nesw-resize"
              />
              <div
                onPointerDown={(e) => handlePointerDown("sw", e)}
                className="absolute -left-2 -bottom-2 h-4 w-4 rounded-full border-2 border-white bg-sky-500 shadow cursor-nesw-resize"
              />
              <div
                onPointerDown={(e) => handlePointerDown("se", e)}
                className="absolute -right-2 -bottom-2 h-4 w-4 rounded-full border-2 border-white bg-sky-500 shadow cursor-nwse-resize"
              />
              <div
                onPointerDown={(e) => handlePointerDown("n", e)}
                className="absolute left-1/2 -top-2 -translate-x-1/2 h-3.5 w-6 rounded border border-white bg-sky-500 shadow cursor-ns-resize"
              />
              <div
                onPointerDown={(e) => handlePointerDown("s", e)}
                className="absolute left-1/2 -bottom-2 -translate-x-1/2 h-3.5 w-6 rounded border border-white bg-sky-500 shadow cursor-ns-resize"
              />
              <div
                onPointerDown={(e) => handlePointerDown("w", e)}
                className="absolute -left-2 top-1/2 -translate-y-1/2 h-6 w-3.5 rounded border border-white bg-sky-500 shadow cursor-ew-resize"
              />
              <div
                onPointerDown={(e) => handlePointerDown("e", e)}
                className="absolute -right-2 top-1/2 -translate-y-1/2 h-6 w-3.5 rounded border border-white bg-sky-500 shadow cursor-ew-resize"
              />

              {/* Live Info Tag */}
              <div className="absolute top-2 left-2 rounded bg-slate-900/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-sky-300 backdrop-blur-sm pointer-events-none">
                {Math.round(crop.width * 100)}% × {Math.round(crop.height * 100)}%
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-800 px-6 py-4 bg-slate-900/50">
          <div className="text-xs text-slate-400">
            Déplacez les poignées pour ajuster la zone conservée.
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-700 hover:text-white disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void onApplyCrop(crop)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-sky-500/25 transition-all hover:bg-sky-400 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Crop className="h-4 w-4" />
              )}
              Appliquer le rognage
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
