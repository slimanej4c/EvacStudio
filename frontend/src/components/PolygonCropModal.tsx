"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, Crop, PenTool, RotateCcw, Check, Scissors, Layers } from "lucide-react";
import { CanvasPlanOverlay } from "@/components/PlanCanvas";

export interface PolygonCropModalProps {
  isOpen: boolean;
  onClose: () => void;
  mainBackgroundUrl: string;
  planOverlays: CanvasPlanOverlay[];
  selectedOverlayId?: string | null;
  buildingName?: string;
  /**
   * `origin` is the top-left of the cut, in pixels of the source image: the
   * editor preserves the drawing's visual placement from it.
   */
  onCropMainPlan: (croppedDataUrl: string, origin: Point) => void | Promise<void>;
  onCropSecondaryPlan: (overlayId: string, croppedDataUrl: string, origin: Point) => void | Promise<void>;
}

interface Point {
  x: number;
  y: number;
}

export function PolygonCropModal({
  isOpen,
  onClose,
  mainBackgroundUrl,
  planOverlays,
  selectedOverlayId = null,
  buildingName = "Plan principal",
  onCropMainPlan,
  onCropSecondaryPlan
}: PolygonCropModalProps) {
  const initialTarget = selectedOverlayId && planOverlays.some((overlay) => overlay.tempId === selectedOverlayId)
    ? selectedOverlayId
    : "main";
  const [targetId, setTargetId] = useState<string>(initialTarget);
  const [cropMode, setCropMode] = useState<"rect" | "polygon">("polygon");

  // Polygon points in natural image pixel coordinates
  const [points, setPoints] = useState<Point[]>([]);
  const [isClosed, setIsClosed] = useState<boolean>(false);
  const [mousePos, setMousePos] = useState<Point | null>(null);

  // Rectangular crop state in natural image pixel coordinates
  const [rectCrop, setRectCrop] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [isDraggingRect, setIsDraggingRect] = useState(false);
  const [rectStart, setRectStart] = useState<Point | null>(null);

  const [imageObj, setImageObj] = useState<HTMLImageElement | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load target image
  useEffect(() => {
    if (!isOpen) return;

    let url = mainBackgroundUrl;
    if (targetId !== "main") {
      const found = planOverlays.find((o) => o.tempId === targetId);
      if (found) url = found.url;
    }

    if (!url) return;

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      setImageObj(img);
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      setImageDimensions({ width: w, height: h });

      // Default rect crop to full image
      setRectCrop({ x: 0, y: 0, width: w, height: h });
      setPoints([]);
      setIsClosed(false);
    };
    img.onerror = () => {
      if (!cancelled) setImageObj(null);
    };
    img.src = url;
    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [isOpen, targetId, mainBackgroundUrl, planOverlays]);

  // Draw interactive canvas
  useEffect(() => {
    if (!isOpen || !imageObj || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const containerW = containerRef.current.clientWidth || 800;
    const containerH = containerRef.current.clientHeight || 550;

    const imgW = imageDimensions.width || 800;
    const imgH = imageDimensions.height || 600;

    const scale = Math.min(containerW / imgW, containerH / imgH, 1);
    const displayW = Math.round(imgW * scale);
    const displayH = Math.round(imgH * scale);

    canvas.width = displayW;
    canvas.height = displayH;

    // Draw background plan image
    ctx.clearRect(0, 0, displayW, displayH);
    ctx.drawImage(imageObj, 0, 0, displayW, displayH);

    if (cropMode === "polygon") {
      // Draw dim overlay over image
      ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
      ctx.fillRect(0, 0, displayW, displayH);

      if (points.length > 0) {
        ctx.save();
        ctx.beginPath();
        points.forEach((pt, idx) => {
          const dx = pt.x * scale;
          const dy = pt.y * scale;
          if (idx === 0) ctx.moveTo(dx, dy);
          else ctx.lineTo(dx, dy);
        });

        if (isClosed) {
          ctx.closePath();
        } else if (mousePos) {
          ctx.lineTo(mousePos.x * scale, mousePos.y * scale);
        }

        ctx.clip();
        // Redraw image inside clip region bright and clear
        ctx.drawImage(imageObj, 0, 0, displayW, displayH);
        ctx.restore();

        // Draw polygon boundary stroke
        ctx.beginPath();
        points.forEach((pt, idx) => {
          const dx = pt.x * scale;
          const dy = pt.y * scale;
          if (idx === 0) ctx.moveTo(dx, dy);
          else ctx.lineTo(dx, dy);
        });
        if (isClosed) ctx.closePath();
        else if (mousePos) ctx.lineTo(mousePos.x * scale, mousePos.y * scale);

        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw vertex points
        points.forEach((pt, idx) => {
          const dx = pt.x * scale;
          const dy = pt.y * scale;

          ctx.beginPath();
          ctx.arc(dx, dy, idx === 0 ? 7 : 5, 0, Math.PI * 2);
          ctx.fillStyle = idx === 0 ? "#10b981" : "#0284c7";
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.stroke();
        });
      }
    } else if (cropMode === "rect" && rectCrop) {
      // Dim overlay
      ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
      ctx.fillRect(0, 0, displayW, displayH);

      const rx = rectCrop.x * scale;
      const ry = rectCrop.y * scale;
      const rw = rectCrop.width * scale;
      const rh = rectCrop.height * scale;

      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      ctx.drawImage(imageObj, 0, 0, displayW, displayH);
      ctx.restore();

      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, ry, rw, rh);
    }
  }, [isOpen, imageObj, imageDimensions, points, isClosed, mousePos, cropMode, rectCrop]);

  if (!isOpen) return null;

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !imageDimensions.width) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const scale = canvasRef.current.width / imageDimensions.width;

    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    const imgX = Math.round(canvasX / scale);
    const imgY = Math.round(canvasY / scale);

    if (cropMode === "polygon") {
      if (isClosed) return;

      // If clicking near first point (threshold 14px), close polygon
      if (points.length >= 3) {
        const first = points[0];
        const dist = Math.hypot(first.x - imgX, first.y - imgY);
        if (dist < 18 / scale) {
          setIsClosed(true);
          return;
        }
      }

      setPoints((prev) => [...prev, { x: imgX, y: imgY }]);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !imageDimensions.width) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scale = canvasRef.current.width / imageDimensions.width;

    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    const imgX = Math.round(canvasX / scale);
    const imgY = Math.round(canvasY / scale);

    setMousePos({ x: imgX, y: imgY });

    if (cropMode === "rect" && isDraggingRect && rectStart) {
      const rx = Math.min(rectStart.x, imgX);
      const ry = Math.min(rectStart.y, imgY);
      const rw = Math.abs(imgX - rectStart.x);
      const rh = Math.abs(imgY - rectStart.y);
      setRectCrop({ x: rx, y: ry, width: Math.max(20, rw), height: Math.max(20, rh) });
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (cropMode === "rect" && canvasRef.current && imageDimensions.width) {
      const rect = canvasRef.current.getBoundingClientRect();
      const scale = canvasRef.current.width / imageDimensions.width;
      const imgX = Math.round((e.clientX - rect.left) / scale);
      const imgY = Math.round((e.clientY - rect.top) / scale);

      setIsDraggingRect(true);
      setRectStart({ x: imgX, y: imgY });
      setRectCrop({ x: imgX, y: imgY, width: 10, height: 10 });
    }
  };

  const handleMouseUp = () => {
    if (cropMode === "rect") {
      setIsDraggingRect(false);
    }
  };

  const handleApplyCrop = async () => {
    if (!imageObj || !imageDimensions.width || !imageDimensions.height) return;

    if (cropMode === "polygon") {
      if (points.length < 3) return;

      let minX = imageDimensions.width;
      let minY = imageDimensions.height;
      let maxX = 0;
      let maxY = 0;

      points.forEach((pt) => {
        minX = Math.min(minX, pt.x);
        minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x);
        maxY = Math.max(maxY, pt.y);
      });

      minX = Math.max(0, minX);
      minY = Math.max(0, minY);
      maxX = Math.min(imageDimensions.width, maxX);
      maxY = Math.min(imageDimensions.height, maxY);

      const cropW = Math.max(20, maxX - minX);
      const cropH = Math.max(20, maxY - minY);

      const offCanvas = document.createElement("canvas");
      offCanvas.width = cropW;
      offCanvas.height = cropH;
      const ctx = offCanvas.getContext("2d");
      if (!ctx) return;

      ctx.beginPath();
      points.forEach((pt, idx) => {
        const px = pt.x - minX;
        const py = pt.y - minY;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.clip();

      ctx.drawImage(imageObj, -minX, -minY, imageDimensions.width, imageDimensions.height);

      const croppedUrl = offCanvas.toDataURL("image/png");

      if (targetId === "main") {
        await onCropMainPlan(croppedUrl, { x: minX, y: minY });
      } else {
        await onCropSecondaryPlan(targetId, croppedUrl, { x: minX, y: minY });
      }
      offCanvas.width = 0;
      offCanvas.height = 0;
      onClose();
    } else if (cropMode === "rect" && rectCrop) {
      const rx = Math.max(0, rectCrop.x);
      const ry = Math.max(0, rectCrop.y);
      const rw = Math.min(imageDimensions.width - rx, rectCrop.width);
      const rh = Math.min(imageDimensions.height - ry, rectCrop.height);

      if (rw <= 10 || rh <= 10) return;

      const offCanvas = document.createElement("canvas");
      offCanvas.width = rw;
      offCanvas.height = rh;
      const ctx = offCanvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(imageObj, rx, ry, rw, rh, 0, 0, rw, rh);
      const croppedUrl = offCanvas.toDataURL("image/png");

      if (targetId === "main") {
        await onCropMainPlan(croppedUrl, { x: rx, y: ry });
      } else {
        await onCropSecondaryPlan(targetId, croppedUrl, { x: rx, y: ry });
      }
      offCanvas.width = 0;
      offCanvas.height = 0;
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
      <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-white shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30">
              <Scissors className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">Rognage & Découpe du Plan</h2>
              <p className="text-xs text-slate-400">
                Découpez votre plan avec un tracé libre au crayon/lasso ou une sélection rectangulaire.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar & Target Selection */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/60 px-6 py-3">
          {/* Target Plan Selector */}
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
              <Layers className="h-3.5 w-3.5 text-sky-400" />
              <span>Plan à rogner :</span>
            </span>
            <button
              onClick={() => setTargetId("main")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                targetId === "main"
                  ? "bg-sky-600 text-white shadow-sm"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              Main ({buildingName})
            </button>
            {planOverlays.map((overlay, index) => (
              <button
                key={overlay.tempId}
                onClick={() => setTargetId(overlay.tempId)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  targetId === overlay.tempId
                    ? "bg-sky-600 text-white shadow-sm"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                Plan #{index + 1} ({overlay.label || "Secondaire"})
              </button>
            ))}
          </div>

          {/* Mode Switch: Polygon vs Rect */}
          <div className="flex items-center rounded-xl bg-slate-800 p-1 border border-slate-700">
            <button
              onClick={() => {
                setCropMode("polygon");
                setPoints([]);
                setIsClosed(false);
              }}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                cropMode === "polygon"
                  ? "bg-sky-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <PenTool className="h-3.5 w-3.5" />
              <span>Tracé Crayon / Lasso</span>
            </button>

            <button
              onClick={() => setCropMode("rect")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                cropMode === "rect"
                  ? "bg-sky-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Crop className="h-3.5 w-3.5" />
              <span>Cadre Rectangulaire</span>
            </button>
          </div>

          {/* Polygon Action Controls */}
          {cropMode === "polygon" && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setPoints([]);
                  setIsClosed(false);
                }}
                disabled={points.length === 0}
                className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Effacer tracé</span>
              </button>

              {points.length >= 3 && !isClosed && (
                <button
                  onClick={() => setIsClosed(true)}
                  className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Fermer la forme</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Canvas Display Region */}
        <div ref={containerRef} className="relative flex flex-1 items-center justify-center overflow-hidden p-4 bg-slate-950">
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onMouseMove={handleCanvasMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            className="cursor-crosshair rounded-lg border border-slate-800 shadow-xl"
          />

          {cropMode === "polygon" && points.length === 0 && (
            <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-2 text-xs font-medium text-sky-300 border border-sky-500/30 backdrop-blur-md shadow-lg">
              👉 Cliquez sur le plan pour poser les points de votre forme au crayon. Cliquez sur le 1er point vert pour fermer.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-slate-800 px-6 py-4 bg-slate-900">
          <p className="text-xs text-slate-400">
            {cropMode === "polygon"
              ? `${points.length} point(s) posé(s) ${isClosed ? "(Forme fermée ✅)" : ""}`
              : "Glissez la souris pour définir la zone rectangulaire."}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
            >
              Annuler
            </button>
            <button
              onClick={handleApplyCrop}
              disabled={cropMode === "polygon" ? points.length < 3 : !rectCrop}
              className="flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-sky-600/30 hover:bg-sky-500 disabled:opacity-40"
            >
              <Scissors className="h-4 w-4" />
              <span>Valider le rognage</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
