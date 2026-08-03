"use client";

import React from "react";
import { Download, FileDown } from "lucide-react";

interface ExportButtonsProps {
  onOpenExport: (format: "png" | "pdf") => void;
}

export default function ExportButtons({ onOpenExport }: ExportButtonsProps) {
  return (
    <div className="flex items-center gap-0.5 rounded bg-black/25 p-0.5">
      <button
        onClick={() => onOpenExport("png")}
        className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
        title="Exporter en PNG"
      >
        <Download className="h-3.5 w-3.5" />
        <span>PNG</span>
      </button>

      <button
        onClick={() => onOpenExport("pdf")}
        className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
        title="Exporter en PDF"
      >
        <FileDown className="h-3.5 w-3.5" />
        <span>PDF</span>
      </button>
    </div>
  );
}
