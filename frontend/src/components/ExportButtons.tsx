"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileDown, Loader2 } from "lucide-react";

interface ExportButtonsProps {
  /** Exports what the studio currently shows, in the chosen file type. */
  onExport: (format: "png" | "jpeg" | "pdf") => void;
  exporting?: boolean;
  /** Paper size of the PDF, chosen from the same menu. */
  paperFormat: string;
  paperOptions: ReadonlyArray<{ key: string; label: string }>;
  onPaperFormatChange: (key: string) => void;
}

const MENU_WIDTH = 224;

/**
 * A single way out of the studio: one button, then PDF or PNG. Whatever is on
 * the canvas — a bare plan or a template sheet — is what gets exported.
 *
 * The menu is drawn in a portal, anchored to the button: the top bar is a 44px
 * strip with `overflow-hidden`, so a panel positioned inside it would simply be
 * cut away and never seen.
 */
export default function ExportButtons({
  onExport,
  exporting = false,
  paperFormat,
  paperOptions,
  onPaperFormatChange
}: ExportButtonsProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const placeMenu = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({
      top: rect.bottom + 4,
      // Right-aligned on the button, kept clear of the window's edge.
      right: Math.max(8, window.innerWidth - rect.right)
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

  const choose = (format: "png" | "jpeg" | "pdf") => {
    setOpen(false);
    onExport(format);
  };

  const menu =
    open && !exporting && anchor && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: anchor.top, right: anchor.right, width: MENU_WIDTH, zIndex: 80 }}
            className="overflow-hidden rounded-lg border border-white/10 bg-neutral-900 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Papier
              </span>
              <div className="flex items-center gap-1">
                {paperOptions.map((option) => (
                  <button
                    key={option.key}
                    onClick={() => onPaperFormatChange(option.key)}
                    className={`cursor-pointer rounded px-2 py-0.5 text-[10px] font-bold transition-colors ${
                      paperFormat === option.key
                        ? "bg-sky-500/30 text-sky-200"
                        : "text-neutral-400 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => choose("pdf")}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[11px] font-medium text-neutral-200 transition-colors hover:bg-white/10 hover:text-white"
            >
              <FileDown className="h-3.5 w-3.5 text-sky-400" />
              <span>Document PDF</span>
            </button>
            <button
              onClick={() => choose("png")}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[11px] font-medium text-neutral-200 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Download className="h-3.5 w-3.5 text-sky-400" />
              <span>Image PNG</span>
            </button>
            <button
              onClick={() => choose("jpeg")}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[11px] font-medium text-neutral-200 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Download className="h-3.5 w-3.5 text-amber-400" />
              <span>Image JPEG</span>
            </button>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggle}
        disabled={exporting}
        className="flex cursor-pointer items-center gap-1.5 rounded bg-black/25 px-2.5 py-1.5 text-[11px] font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
        title="Exporter ce que montre le studio (PDF ou PNG)"
      >
        {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
        <span>{exporting ? "Export..." : "Export"}</span>
      </button>
      {menu}
    </>
  );
}
