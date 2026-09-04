"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Download, FileDown, Loader2, RefreshCw, Ruler } from "lucide-react";
import type {
  ExportComplianceReport,
  ExportPaperFormat,
  ExportPaperOption,
  ScaleCalibrationMeasurement,
} from "@/lib/planCompliance";

export type ExportQuality = "very-light" | "light" | "medium" | "high" | "very-high";

interface ExportButtonsProps {
  /** Exports what the studio currently shows, in the chosen file type. */
  onExport: (format: "png" | "jpeg" | "pdf", quality: ExportQuality) => void;
  exporting?: boolean;
  /** Paper size of the PDF, chosen from the same menu. */
  paperFormat: ExportPaperFormat;
  paperOptions: ReadonlyArray<ExportPaperOption>;
  onPaperFormatChange: (key: ExportPaperFormat) => void;
  scaleDenominator: number;
  onScaleDenominatorChange: (value: number) => void;
  documentTypeLabel: string;
  compliance: ExportComplianceReport;
  scaleMeasurement: ScaleCalibrationMeasurement | null;
  canCalibrate: boolean;
  onStartScaleCalibration: () => void;
  onClearScaleCalibration: () => void;
  onAdjustToDeclaredScale: () => void;
  /** Resolution/compression profile used by every final export format. */
  quality: ExportQuality;
  qualityOptions: ReadonlyArray<{
    key: ExportQuality;
    label: string;
    description: string;
  }>;
  onQualityChange: (quality: ExportQuality) => void;
}

const MENU_WIDTH = 340;

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
  onPaperFormatChange,
  scaleDenominator,
  onScaleDenominatorChange,
  documentTypeLabel,
  compliance,
  scaleMeasurement,
  canCalibrate,
  onStartScaleCalibration,
  onClearScaleCalibration,
  onAdjustToDeclaredScale,
  quality,
  qualityOptions,
  onQualityChange
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
    onExport(format, quality);
  };

  const selectedQuality = qualityOptions.find((option) => option.key === quality);
  const complianceTone = compliance.status === "compliant"
    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
    : compliance.status === "attention"
      ? "border-amber-400/20 bg-amber-500/10 text-amber-100"
      : "border-red-400/20 bg-red-500/10 text-red-100";

  const menu =
    open && !exporting && anchor && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: anchor.top, right: anchor.right, width: MENU_WIDTH, zIndex: 80 }}
            className="overflow-hidden rounded-lg border border-white/10 bg-neutral-900 shadow-2xl"
          >
            <div className="border-b border-white/10 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  Format d’impression
                </span>
                <div className="flex items-center gap-1">
                {paperOptions.map((option) => (
                  <button
                    type="button"
                    key={option.key}
                    onClick={() => onPaperFormatChange(option.key)}
                    title={option.description}
                    className={`rounded px-2 py-0.5 text-[10px] font-bold transition-colors ${
                      paperFormat === option.key
                        ? "bg-sky-500/30 text-sky-200"
                        : "cursor-pointer text-neutral-400 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
                </div>
              </div>
              <p className="mt-1.5 text-[10px] leading-4 text-neutral-400">{documentTypeLabel}</p>
            </div>

            <div className="border-b border-white/10 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="studio-print-scale"
                  className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500"
                >
                  Échelle déclarée
                </label>
                <div className="flex items-center gap-1 text-xs font-semibold text-neutral-300">
                  <span>1 :</span>
                  <input
                    id="studio-print-scale"
                    type="number"
                    min={1}
                    max={1000}
                    value={scaleDenominator}
                    onChange={(event) => onScaleDenominatorChange(Math.max(1, Number(event.target.value) || 1))}
                    className="w-20 rounded border border-white/10 bg-neutral-800 px-2 py-1 text-right text-xs text-white outline-none focus:border-sky-500"
                  />
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                {[100, 250, 350].map((value) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => onScaleDenominatorChange(value)}
                    title={value > compliance.maximumScaleDenominator ? "Choix possible, avec une remarque de conformité pour ce format." : undefined}
                    className={`rounded px-2 py-1 text-[10px] font-semibold transition ${
                      scaleDenominator === value
                        ? "bg-sky-500/25 text-sky-200"
                        : "bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    1:{value}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] leading-4 text-neutral-500">
                1:250 recommandé ; 1:100 ou une échelle plus lisible reste possible. Tolérance du format : ±{compliance.paperDimensionTolerancePercent} %.
              </p>
              {scaleMeasurement ? (
                <div className="mt-2 rounded-lg border border-sky-400/20 bg-sky-500/10 p-2 text-[10px] text-sky-100">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">Mesurée : 1:{scaleMeasurement.measuredScaleDenominator.toFixed(1)}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onStartScaleCalibration();
                      }}
                      className="font-semibold text-sky-300 hover:text-white"
                    >
                      Recalibrer
                    </button>
                  </div>
                  <p className="mt-1 leading-4 text-sky-200/75">
                    {scaleMeasurement.realDistanceM.toLocaleString("fr-FR")} m réels = {scaleMeasurement.printedDistanceMm.toFixed(2)} mm imprimés. Écart avec 1:{scaleDenominator} : {scaleMeasurement.declaredScaleDeviationPercent.toFixed(1)} %.
                  </p>
                  <button
                    type="button"
                    onClick={onAdjustToDeclaredScale}
                    disabled={
                      !canCalibrate
                      || scaleMeasurement.declaredScaleDeviationPercent < 0.05
                    }
                    title={`Agrandir ou réduire le plan pour obtenir réellement 1:${scaleDenominator}.`}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-sky-300/25 bg-sky-400/15 px-2 py-1.5 font-bold text-sky-100 transition hover:bg-sky-400/25 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {scaleMeasurement.declaredScaleDeviationPercent < 0.05
                      ? "Plan déjà ajusté"
                      : `Ajuster automatiquement à 1:${scaleDenominator}`}
                  </button>
                  <button
                    type="button"
                    onClick={onClearScaleCalibration}
                    className="mt-1.5 text-neutral-400 hover:text-red-300"
                  >
                    Supprimer la calibration
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!canCalibrate}
                  onClick={() => {
                    setOpen(false);
                    onStartScaleCalibration();
                  }}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-sky-400/20 bg-sky-500/10 px-2 py-1.5 text-[10px] font-bold text-sky-200 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-35"
                  title={canCalibrate ? "Tracer deux points de distance connue sur le plan" : "Choisissez d’abord un template de feuille"}
                >
                  <Ruler className="h-3.5 w-3.5" />
                  Vérifier par deux points
                </button>
              )}
            </div>

            <div className={`m-2.5 rounded-lg border p-2.5 ${complianceTone}`}>
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide">
                {compliance.status === "compliant"
                  ? <CheckCircle2 className="h-3.5 w-3.5" />
                  : <AlertTriangle className="h-3.5 w-3.5" />}
                {compliance.status === "compliant"
                  ? "Format et échelle conformes"
                  : compliance.status === "attention"
                    ? "Point à vérifier"
                    : "Écart de conformité — export autorisé"}
              </div>
              {compliance.issues.map((issue) => (
                <p key={issue.code} className="mt-1 text-[10px] leading-4">{issue.message}</p>
              ))}
              {compliance.status !== "compliant" && (
                <p className="mt-1.5 border-t border-current/15 pt-1.5 text-[10px] leading-4 opacity-80">
                  Cette remarque est informative : vous pouvez choisir ce format et exporter le document.
                </p>
              )}
            </div>

            <div className="border-b border-white/10 px-3 py-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <label
                  htmlFor="studio-export-quality"
                  className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500"
                >
                  Qualité du fichier
                </label>
                <select
                  id="studio-export-quality"
                  value={quality}
                  onChange={(event) => onQualityChange(event.target.value as ExportQuality)}
                  className="cursor-pointer rounded border border-white/10 bg-neutral-800 px-2 py-1 text-[11px] font-semibold text-neutral-100 outline-none focus:border-sky-500"
                >
                  {qualityOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[10px] leading-4 text-neutral-400">
                {selectedQuality?.description}
              </p>
            </div>

            <button
              type="button"
              onClick={() => choose("pdf")}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[11px] font-medium text-neutral-200 transition-colors hover:bg-white/10 hover:text-white"
            >
              <FileDown className="h-3.5 w-3.5 text-sky-400" />
              <span>Document PDF</span>
            </button>
            <button
              type="button"
              onClick={() => choose("png")}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[11px] font-medium text-neutral-200 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Download className="h-3.5 w-3.5 text-sky-400" />
              <span>Image PNG</span>
            </button>
            <button
              type="button"
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
        type="button"
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
