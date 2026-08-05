"use client";

import React, { useState, useEffect, useRef, useCallback, useImperativeHandle } from "react";
import { Stage, Layer, Image as KonvaImage, Transformer, Group, Rect, Text, Line, Ellipse, Circle } from "react-konva";
import { IconType, SAFETY_ICONS, SafetyIconDefinition, getIconImageSource, isDirectionalIcon, isYouAreHereIcon } from "@/utils/safetyIcons";

export interface CanvasIcon {
  id?: number;
  tempId: string; // client-side unique id
  icon_type: IconType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label: string;
  /** True position of the equipment when the pictogram was moved aside. */
  anchor_x?: number | null;
  anchor_y?: number | null;
}

export type EraserShape = "square" | "circle";

export type ShapeKind = "line" | "rect" | "circle";

export interface CanvasShape {
  id?: number;
  tempId: string;
  shape_type: ShapeKind;
  /** Top-left of the bounding box; for a line, the start point. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  stroke_width: number;
  color: string;
}

/** Web-safe fonts offered for plan text annotations. */
export const FONT_OPTIONS = [
  "Arial",
  "Helvetica",
  "Times New Roman",
  "Georgia",
  "Courier New",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
] as const;

export interface CanvasText {
  id?: number;
  tempId: string;
  text: string;
  x: number;
  y: number;
  font_size: number;
  font_family: string;
  color: string;
  bold: boolean;
  italic: boolean;
  /** Optional background color behind the text; null/undefined means transparent. */
  background_color?: string | null;
  rotation: number;
}

interface PlanCanvasProps {
  backgroundUrl: string;
  backgroundType: "image" | "pdf";
  icons: CanvasIcon[];
  onIconsChange: (icons: CanvasIcon[]) => void;
  selectedIconId: string | null;
  onSelectIcon: (id: string | null) => void;
  zoom: number;
  setZoom: (zoom: number) => void;
  mode: "select" | "pan" | "erase";
  placementIconType?: IconType | null;
  placementIconSize?: { width: number; height: number };
  onPlaceIcon?: (type: IconType, x: number, y: number) => void;
  iconDefinitions?: Record<string, SafetyIconDefinition>;
  /** Incremented by the parent to request a "fit plan to view" pass. */
  fitSignal?: number;
  /** Eraser diameter, in plan units. */
  eraserSize?: number;
  /** Eraser brush shape. */
  eraserShape?: EraserShape;
  /** Incremented by the parent to undo the last eraser stroke. */
  undoEraseSignal?: number;
  /** Incremented by the parent to drop every eraser stroke. */
  resetEraseSignal?: number;
  /** Fires after each stroke with the number of strokes currently applied. */
  onEraseStrokesChange?: (count: number) => void;
  shapes?: CanvasShape[];
  onShapesChange?: (shapes: CanvasShape[]) => void;
  selectedShapeId?: string | null;
  onSelectShape?: (id: string | null) => void;
  /** When set, dragging on the plan draws a new shape of this kind. */
  shapeTool?: ShapeKind | null;
  shapeStrokeWidth?: number;
  shapeColor?: string;
  /**
   * Turns the whole sheet — plan, shapes, leader lines and pictogram positions —
   * to match the reader's viewing direction. Equipment pictograms are kept
   * upright inside it; directional ones follow the plan.
   */
  planRotation?: number;
  /** Free text annotations placed on the plan. */
  texts?: CanvasText[];
  onTextsChange?: (texts: CanvasText[]) => void;
  selectedTextId?: string | null;
  onSelectText?: (id: string | null) => void;
  /** When true, the next click on the plan places a new text. */
  placementText?: boolean;
  onPlaceText?: (x: number, y: number) => void;
}

export interface PlanCanvasHandle {
  /** The background with the eraser strokes baked in, for saving or exporting. */
  getEditedBackground: () => HTMLCanvasElement | null;
}

// Share of the workspace the plan occupies when fitted, leaving a margin around it.
const FIT_VIEWPORT_RATIO = 0.75;

/**
 * Where a leader line must stop: on the pictogram's box edge, on the anchor's
 * side. Running it to the centre would draw a stroke straight across the symbol.
 */
function leaderEndpoint(icon: CanvasIcon, anchorX: number, anchorY: number) {
  const centreX = icon.x + icon.width / 2;
  const centreY = icon.y + icon.height / 2;
  const dx = centreX - anchorX;
  const dy = centreY - anchorY;
  if (dx === 0 && dy === 0) return { x: centreX, y: centreY };

  // Slab clipping: the entry point into the box along the anchor -> centre ray.
  let entry = 0;
  if (dx !== 0) {
    entry = Math.max(
      entry,
      Math.min((icon.x - anchorX) / dx, (icon.x + icon.width - anchorX) / dx)
    );
  }
  if (dy !== 0) {
    entry = Math.max(
      entry,
      Math.min((icon.y - anchorY) / dy, (icon.y + icon.height - anchorY) / dy)
    );
  }

  const clamped = Math.min(Math.max(entry, 0), 1);
  return { x: anchorX + dx * clamped, y: anchorY + dy * clamped };
}

/**
 * How a pictogram's artwork behaves when the sheet is turned. Three cases:
 *
 * - the orientation marker: its rotation is an *input* — it is what sets the
 *   sheet angle — so it must not turn the drawing as well, or the angle applies
 *   twice. On an oriented sheet the reader faces the top, so it always points up;
 * - directional symbols: their meaning is a direction in the building, so they
 *   follow the plan;
 * - everything else marks equipment at a spot and must stay upright and readable.
 */
function iconOrientationClass(
  type: IconType,
  definitions: Record<string, SafetyIconDefinition>
) {
  if (isYouAreHereIcon(type, definitions)) return "iconOrientationMarker";
  return isDirectionalIcon(type, definitions) ? "iconDirectional" : "iconUpright";
}

function iconArtworkRotation(
  icon: CanvasIcon,
  definitions: Record<string, SafetyIconDefinition>,
  planRotation: number
) {
  switch (iconOrientationClass(icon.icon_type, definitions)) {
    case "iconOrientationMarker":
      return -(planRotation + icon.rotation);
    case "iconDirectional":
      return 0;
    default:
      return -planRotation;
  }
}

// Global PDF.js loading helper (client-side only)
let pdfjsLib: any = null;
const PDF_RENDER_SCALE = 6;

if (typeof window !== "undefined") {
  // Dynamically load pdfjs-dist on client side
  pdfjsLib = require("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
}

function PlanCanvas({
  backgroundUrl,
  backgroundType,
  icons,
  onIconsChange,
  selectedIconId,
  onSelectIcon,
  zoom,
  setZoom,
  mode,
  placementIconType = null,
  placementIconSize = { width: 40, height: 40 },
  onPlaceIcon,
  iconDefinitions = SAFETY_ICONS,
  fitSignal = 0,
  eraserSize = 24,
  eraserShape = "square",
  undoEraseSignal = 0,
  resetEraseSignal = 0,
  onEraseStrokesChange,
  shapes = [],
  onShapesChange,
  selectedShapeId = null,
  onSelectShape,
  shapeTool = null,
  shapeStrokeWidth = 3,
  shapeColor = "#000000",
  planRotation = 0,
  texts = [],
  onTextsChange,
  selectedTextId = null,
  onSelectText,
  placementText = false,
  onPlaceText,
  canvasRef
}: PlanCanvasProps & { canvasRef?: React.Ref<PlanCanvasHandle> }) {
  const stageRef = useRef<any>(null);
  const transformerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [imageSize, setImageSize] = useState({ width: 800, height: 600 });
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [iconImages, setIconImages] = useState<Record<string, HTMLImageElement>>({});
  // The stage is sized from its container, never from the window: the workspace
  // must fill the available area exactly so the page itself never scrolls.
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  // ── Eraser ──────────────────────────────────────────────────────────────
  // The background is raster, so erasing means painting white onto a working
  // copy of it. Strokes are kept so they can be undone by replaying them over a
  // fresh copy of the original image.
  const layerRef = useRef<any>(null);
  const [editedBackground, setEditedBackground] = useState<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<{ points: number[]; size: number; shape: EraserShape }[]>([]);
  const activeStrokeRef = useRef<{ points: number[]; size: number; shape: EraserShape } | null>(null);
  // Held in a ref so the callback identity never re-runs the effects below.
  const onEraseStrokesChangeRef = useRef(onEraseStrokesChange);
  useEffect(() => {
    onEraseStrokesChangeRef.current = onEraseStrokesChange;
  });

  useImperativeHandle(
    canvasRef,
    () => ({ getEditedBackground: () => editedBackground }),
    [editedBackground]
  );

  // A fresh working copy whenever the source background changes.
  useEffect(() => {
    if (!bgImage) {
      strokesRef.current = [];
      setEditedBackground(null);
      onEraseStrokesChangeRef.current?.(0);
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = bgImage.naturalWidth || bgImage.width;
    canvas.height = bgImage.naturalHeight || bgImage.height;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
    strokesRef.current = [];
    setEditedBackground(canvas);
    onEraseStrokesChangeRef.current?.(0);
  }, [bgImage]);

  // ── Shape drawing ───────────────────────────────────────────────────────
  // The draft lives in a ref, mirrored into state only for rendering: mouse
  // events can be delivered in a single task, in which case React has not
  // re-rendered yet and reading the state on mouseup would give a stale draft.
  const [draftShape, setDraftShape] = useState<CanvasShape | null>(null);
  const draftShapeRef = useRef<CanvasShape | null>(null);
  const draftOriginRef = useRef<{ x: number; y: number } | null>(null);

  const setDraft = (shape: CanvasShape | null) => {
    draftShapeRef.current = shape;
    setDraftShape(shape);
  };

  const makeShapeTempId = () =>
    `shape-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const beginShape = (stage: any) => {
    if (!shapeTool) return;
    const point = stage.getAbsoluteTransform().copy().invert().point(stage.getPointerPosition());
    if (!point) return;

    draftOriginRef.current = { x: point.x, y: point.y };
    setDraft({
      tempId: makeShapeTempId(),
      shape_type: shapeTool,
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
      rotation: 0,
      stroke_width: shapeStrokeWidth,
      color: shapeColor
    });
  };

  const extendShape = (stage: any) => {
    const origin = draftOriginRef.current;
    const current = draftShapeRef.current;
    if (!origin || !current || !shapeTool) return;

    const point = stage.getAbsoluteTransform().copy().invert().point(stage.getPointerPosition());
    if (!point) return;

    if (current.shape_type === "line") {
      // A line keeps its true endpoints, so any angle is possible.
      setDraft({ ...current, width: point.x - origin.x, height: point.y - origin.y });
      return;
    }

    setDraft({
      ...current,
      x: Math.min(origin.x, point.x),
      y: Math.min(origin.y, point.y),
      width: Math.abs(point.x - origin.x),
      height: Math.abs(point.y - origin.y)
    });
  };

  const finishShape = () => {
    const origin = draftOriginRef.current;
    const draft = draftShapeRef.current;
    draftOriginRef.current = null;
    if (!origin || !draft) return;

    const isLine = draft.shape_type === "line";
    const meaningful = isLine
      ? Math.hypot(draft.width, draft.height) >= 4
      : draft.width >= 4 && draft.height >= 4;

    if (meaningful) {
      onShapesChange?.([...shapes, draft]);
      onSelectShape?.(draft.tempId);
    }
    setDraft(null);
  };

  const updateShape = (tempId: string, patch: Partial<CanvasShape>) => {
    onShapesChange?.(
      shapes.map((shape) => (shape.tempId === tempId ? { ...shape, ...patch } : shape))
    );
  };

  // The white sheet is not the plan image: it is the plan *plus* anything placed
  // outside it. An assembly point often sits well away from the building, so the
  // sheet has to grow to hold it — and the export follows this rectangle.
  const SHEET_MARGIN = 28;
  const contentBounds = React.useMemo(() => {
    let minX = 0;
    let minY = 0;
    let maxX = imageSize.width;
    let maxY = imageSize.height;

    icons.forEach((icon) => {
      minX = Math.min(minX, icon.x - SHEET_MARGIN);
      minY = Math.min(minY, icon.y - SHEET_MARGIN);
      maxX = Math.max(maxX, icon.x + icon.width + SHEET_MARGIN);
      // Labels are drawn just under the icon, so leave a little more room below.
      maxY = Math.max(maxY, icon.y + icon.height + SHEET_MARGIN + (icon.label ? 18 : 0));

      if (icon.anchor_x != null && icon.anchor_y != null) {
        minX = Math.min(minX, icon.anchor_x - SHEET_MARGIN);
        minY = Math.min(minY, icon.anchor_y - SHEET_MARGIN);
        maxX = Math.max(maxX, icon.anchor_x + SHEET_MARGIN);
        maxY = Math.max(maxY, icon.anchor_y + SHEET_MARGIN);
      }
    });

    shapes.forEach((shape) => {
      // A line's width/height are signed offsets, so normalise before comparing.
      const left = Math.min(shape.x, shape.x + shape.width);
      const top = Math.min(shape.y, shape.y + shape.height);
      const right = Math.max(shape.x, shape.x + shape.width);
      const bottom = Math.max(shape.y, shape.y + shape.height);
      const pad = SHEET_MARGIN + shape.stroke_width;

      minX = Math.min(minX, left - pad);
      minY = Math.min(minY, top - pad);
      maxX = Math.max(maxX, right + pad);
      maxY = Math.max(maxY, bottom + pad);
    });

    texts.forEach((t) => {
      // Approximate the text box so the sheet grows to contain it.
      const w = Math.max(20, (t.text || "").length * t.font_size * 0.55);
      const h = Math.max(t.font_size * 1.3, (t.text || "").split("\n").length * t.font_size * 1.3);
      minX = Math.min(minX, t.x - SHEET_MARGIN);
      minY = Math.min(minY, t.y - SHEET_MARGIN);
      maxX = Math.max(maxX, t.x + w + SHEET_MARGIN);
      maxY = Math.max(maxY, t.y + h + SHEET_MARGIN);
    });

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, [icons, shapes, texts, imageSize]);

  /** Plan units -> pixels of the working canvas (a PDF is rasterised much larger). */
  const canvasScale = editedBackground && imageSize.width
    ? editedBackground.width / imageSize.width
    : 1;

  const paintStroke = (
    context: CanvasRenderingContext2D,
    stroke: { points: number[]; size: number; shape: EraserShape },
    scale: number,
    fromIndex = 0
  ) => {
    if (stroke.points.length < 2) return;

    context.save();
    context.strokeStyle = "#ffffff";
    context.fillStyle = "#ffffff";
    context.lineCap = stroke.shape === "circle" ? "round" : "square";
    context.lineJoin = stroke.shape === "circle" ? "round" : "miter";
    context.lineWidth = Math.max(1, stroke.size * scale);

    if (stroke.points.length === 2) {
      // A single click erases one brush stamp.
      const size = Math.max(1, stroke.size * scale);
      const x = stroke.points[0] * scale;
      const y = stroke.points[1] * scale;
      if (stroke.shape === "circle") {
        context.beginPath();
        context.arc(x, y, Math.max(0.5, size / 2), 0, Math.PI * 2);
        context.fill();
      } else {
        context.fillRect(x - size / 2, y - size / 2, size, size);
      }
      context.restore();
      return;
    }

    context.beginPath();
    const start = Math.max(0, fromIndex);
    context.moveTo(stroke.points[start] * scale, stroke.points[start + 1] * scale);
    for (let index = start + 2; index < stroke.points.length; index += 2) {
      context.lineTo(stroke.points[index] * scale, stroke.points[index + 1] * scale);
    }
    context.stroke();
    context.restore();
  };

  const redrawEditedBackground = () => {
    if (!editedBackground || !bgImage) return;
    const context = editedBackground.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, editedBackground.width, editedBackground.height);
    context.drawImage(bgImage, 0, 0, editedBackground.width, editedBackground.height);
    strokesRef.current.forEach((stroke) => paintStroke(context, stroke, canvasScale));
    layerRef.current?.batchDraw();
  };

  const pointerInPlanCoords = (stage: any) => {
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return null;
    return stage.getAbsoluteTransform().copy().invert().point(pointer);
  };

  const beginEraseStroke = (stage: any) => {
    const point = pointerInPlanCoords(stage);
    if (!point || !editedBackground) return;

    activeStrokeRef.current = { points: [point.x, point.y], size: eraserSize, shape: eraserShape };
    const context = editedBackground.getContext("2d");
    if (context) paintStroke(context, activeStrokeRef.current, canvasScale);
    layerRef.current?.batchDraw();
  };

  const extendEraseStroke = (stage: any) => {
    const stroke = activeStrokeRef.current;
    if (!stroke || !editedBackground) return;

    const point = pointerInPlanCoords(stage);
    if (!point) return;

    const previousLength = stroke.points.length;
    stroke.points.push(point.x, point.y);

    const context = editedBackground.getContext("2d");
    if (context) paintStroke(context, stroke, canvasScale, Math.max(0, previousLength - 2));
    layerRef.current?.batchDraw();
  };

  const finishEraseStroke = () => {
    if (!activeStrokeRef.current) return;
    strokesRef.current = [...strokesRef.current, activeStrokeRef.current];
    activeStrokeRef.current = null;
    onEraseStrokesChangeRef.current?.(strokesRef.current.length);
  };

  const previousUndoSignalRef = useRef(undoEraseSignal);
  useEffect(() => {
    if (undoEraseSignal === previousUndoSignalRef.current) return;
    previousUndoSignalRef.current = undoEraseSignal;
    if (!strokesRef.current.length) return;

    strokesRef.current = strokesRef.current.slice(0, -1);
    redrawEditedBackground();
    onEraseStrokesChangeRef.current?.(strokesRef.current.length);
  });

  const previousResetSignalRef = useRef(resetEraseSignal);
  useEffect(() => {
    if (resetEraseSignal === previousResetSignalRef.current) return;
    previousResetSignalRef.current = resetEraseSignal;
    if (!strokesRef.current.length) return;

    strokesRef.current = [];
    redrawEditedBackground();
    onEraseStrokesChangeRef.current?.(0);
  });

  const measureRef = useRef<() => void>(() => {});

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.max(0, Math.floor(rect.width));
      const height = Math.max(0, Math.floor(rect.height));
      setStageSize((current) =>
        current.width === width && current.height === height ? current : { width, height }
      );
    };

    measureRef.current = measure;
    measure();

    // ResizeObserver is the primary signal, but some environments never deliver
    // its initial callback — without a fallback the stage would stay 0x0 and the
    // plan would simply not render. Measure again after paint and on resize.
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(element);
    }
    window.addEventListener("resize", measure);
    const frame = window.requestAnimationFrame(measure);
    const timer = window.setTimeout(measure, 300);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  // Last size the stage position was reconciled against, shared by the fit and the
  // centre-keeping effect below so they never both act on the same resize.
  const previousStageSizeRef = useRef({ width: 0, height: 0 });

  // Measures the container live rather than reading the size held in state: a fit
  // is often requested in the same pass that changes the layout, and the state
  // would still hold the previous size.
  const fitPlanToView = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    if (!width || !height) return;
    if (!contentBounds.width || !contentBounds.height) return;

    // Fit the whole sheet, not just the plan: icons placed outside must stay in
    // view. Turned, the sheet needs its rotated bounding box or it spills over.
    const radians = (planRotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const rotatedWidth = contentBounds.width * cos + contentBounds.height * sin;
    const rotatedHeight = contentBounds.width * sin + contentBounds.height * cos;

    const scale = Math.min(width / rotatedWidth, height / rotatedHeight) * FIT_VIEWPORT_RATIO;
    const clampedScale = Math.max(0.1, Math.min(5, scale));

    // The scene pivots on the sheet's centre, so that point stays put: park it
    // in the middle of the workspace.
    const centreX = contentBounds.x + contentBounds.width / 2;
    const centreY = contentBounds.y + contentBounds.height / 2;

    setZoom(clampedScale);
    setStagePos({
      x: width / 2 - centreX * clampedScale,
      y: height / 2 - centreY * clampedScale
    });

    // This position is already correct for the new size — tell the centre-keeping
    // effect not to shift it again when it observes the resize.
    previousStageSizeRef.current = { width, height };
  }, [contentBounds, planRotation, setZoom]);

  // Re-measure after every render. A dock collapsing or the workspace-width
  // setting changing resizes this container without firing any resize event,
  // and ResizeObserver is not guaranteed to deliver. measure() is a single
  // getBoundingClientRect and only sets state when the size actually changed,
  // so this cannot loop.
  useEffect(() => {
    measureRef.current();
  });

  // When the workspace resizes (a dock collapsing, the window changing), keep
  // whatever the user was looking at centred instead of anchoring to the corner.
  useEffect(() => {
    const previous = previousStageSizeRef.current;
    previousStageSizeRef.current = stageSize;

    if (!previous.width || !previous.height) return;
    if (!stageSize.width || !stageSize.height) return;

    const deltaX = (stageSize.width - previous.width) / 2;
    const deltaY = (stageSize.height - previous.height) / 2;
    if (!deltaX && !deltaY) return;

    setStagePos((position) => ({ x: position.x + deltaX, y: position.y + deltaY }));
  }, [stageSize]);

  // Fit once per background, as soon as both the plan and the stage are measured.
  const autoFittedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bgImage || !stageSize.width || !stageSize.height) return;
    if (autoFittedForRef.current === backgroundUrl) return;
    autoFittedForRef.current = backgroundUrl;
    fitPlanToView();
  }, [bgImage, stageSize, backgroundUrl, fitPlanToView]);

  // Explicit fit requested from the status bar.
  const previousFitSignalRef = useRef(fitSignal);
  useEffect(() => {
    if (fitSignal === previousFitSignalRef.current) return;
    previousFitSignalRef.current = fitSignal;
    fitPlanToView();
  }, [fitSignal, fitPlanToView]);

  // PDF converter
  useEffect(() => {
    if (!backgroundUrl) return;

    if (backgroundType === "pdf" && pdfjsLib) {
      const renderPdf = async () => {
        try {
          const loadingTask = pdfjsLib.getDocument(backgroundUrl);
          const pdf = await loadingTask.promise;
          const page = await pdf.getPage(1);
          
          const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          const renderContext = {
            canvasContext: context,
            viewport: viewport,
          };
          await page.render(renderContext).promise;

          const img = new window.Image();
          img.src = canvas.toDataURL();
          img.onload = () => {
            setBgImage(img);
            setImageSize({ width: img.width / PDF_RENDER_SCALE, height: img.height / PDF_RENDER_SCALE });
          };
        } catch (err) {
          console.error("Error loading PDF background:", err);
        }
      };
      renderPdf();
    } else {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        setBgImage(img);
        setImageSize({ width: img.width, height: img.height });
      };
      img.src = backgroundUrl;
    }
  }, [backgroundUrl, backgroundType]);

  // Cache/Preload safety icons images
  useEffect(() => {
    const loadedImages: Record<string, HTMLImageElement> = {};
    const types = Object.keys(iconDefinitions) as IconType[];
    
    let loadedCount = 0;
    if (types.length === 0) {
      setIconImages({});
      return;
    }

    types.forEach((type) => {
      const src = getIconImageSource(type, iconDefinitions);
      if (!src) {
        loadedCount++;
        if (loadedCount === types.length) {
          setIconImages({ ...loadedImages });
        }
        return;
      }

      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = img.onerror = () => {
        loadedImages[type] = img;
        loadedCount++;
        if (loadedCount === types.length) {
          setIconImages({ ...loadedImages });
        }
      };
      img.src = src;
    });
  }, [iconDefinitions]);

  // Update Transformer nodes when selection changes
  useEffect(() => {
    if (transformerRef.current) {
      const stage = stageRef.current;
      if (!stage) return;

      // Icons, shapes and texts share the Transformer: whichever is selected gets it.
      const activeId = selectedIconId || selectedShapeId || selectedTextId;
      if (activeId) {
        const selectedNode = stage.findOne("." + activeId);
        if (selectedNode) {
          transformerRef.current.nodes([selectedNode]);
          transformerRef.current.getLayer().batchDraw();
          return;
        }
      }
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer().batchDraw();
    }
  }, [selectedIconId, selectedShapeId, selectedTextId, icons, shapes, texts]);

  // Keyboard shortcut to delete the selected icon or shape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      // Prevent deleting if typing in label input
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") {
        return;
      }

      if (selectedIconId) {
        onIconsChange(icons.filter((icon) => icon.tempId !== selectedIconId));
        onSelectIcon(null);
      } else if (selectedShapeId) {
        onShapesChange?.(shapes.filter((shape) => shape.tempId !== selectedShapeId));
        onSelectShape?.(null);
      } else if (selectedTextId) {
        onTextsChange?.(texts.filter((t) => t.tempId !== selectedTextId));
        onSelectText?.(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedIconId, selectedShapeId, selectedTextId, icons, shapes, texts, onIconsChange, onSelectIcon, onShapesChange, onSelectShape, onTextsChange, onSelectText]);

  const handleStageMouseDown = (e: any) => {
    if (mode === "erase") {
      beginEraseStroke(e.target.getStage());
      return;
    }

    if (shapeTool) {
      beginShape(e.target.getStage());
      return;
    }

    if (placementIconType && onPlaceIcon) {
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!stage || !pointer) return;

      const planPoint = stage.getAbsoluteTransform().copy().invert().point(pointer);
      const iconWidth = Math.max(15, placementIconSize.width);
      const iconHeight = Math.max(15, placementIconSize.height);

      // Deliberately unclamped: an assembly point often belongs outside the
      // building outline, and the sheet grows to include whatever is placed there.
      onPlaceIcon(
        placementIconType,
        planPoint.x - iconWidth / 2,
        planPoint.y - iconHeight / 2
      );
      return;
    }

    if (placementText && onPlaceText) {
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!stage || !pointer) return;

      const planPoint = stage.getAbsoluteTransform().copy().invert().point(pointer);
      onPlaceText(planPoint.x, planPoint.y);
      return;
    }

    // Clicked on stage background -> deselect
    if (e.target === e.target.getStage() || e.target.name() === "bgImage") {
      onSelectIcon(null);
      onSelectShape?.(null);
      onSelectText?.(null);
      return;
    }
  };

  const handleStageDrag = (e: any) => {
    if (mode === "pan") {
      setStagePos({
        x: e.target.x(),
        y: e.target.y()
      });
    }
  };

  const handleWheel = (e: any) => {
    const event = e.evt as WheelEvent;
    event.preventDefault();

    const stage = stageRef.current;
    if (!stage) return;

    // macOS synthesises `ctrlKey` on a trackpad pinch, so that is our zoom signal.
    // Cmd/Ctrl + scroll zooms too. A real mouse wheel sends a single large, whole
    // step with no horizontal component — anything else is a two-finger scroll,
    // which must pan the plan instead of zooming it.
    const isPinchGesture = event.ctrlKey;
    const isModifierZoom = event.metaKey;
    const isMouseWheel =
      event.deltaX === 0 && Math.abs(event.deltaY) >= 40 && Number.isInteger(event.deltaY);

    if (isPinchGesture || isModifierZoom || isMouseWheel) {
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const oldScale = stage.scaleX();
      const pointerInPlan = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      };

      // Exponential response keeps pinch and wheel feeling consistent.
      const sensitivity = isPinchGesture ? 0.01 : 0.002;
      const nextScale = oldScale * Math.exp(-event.deltaY * sensitivity);
      const clampedScale = Math.max(0.1, Math.min(5, nextScale));

      setZoom(clampedScale);
      setStagePos({
        x: pointer.x - pointerInPlan.x * clampedScale,
        y: pointer.y - pointerInPlan.y * clampedScale,
      });
      return;
    }

    // Two-finger scroll: pan. Shift turns a vertical scroll into a horizontal one.
    const deltaX = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
    const deltaY = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;

    setStagePos((position) => ({
      x: position.x - deltaX,
      y: position.y - deltaY,
    }));
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-[#1b1b1d]"
      style={{
        backgroundImage:
          "linear-gradient(45deg,#202023 25%,transparent 25%,transparent 75%,#202023 75%)," +
          "linear-gradient(45deg,#202023 25%,transparent 25%,transparent 75%,#202023 75%)",
        backgroundSize: "16px 16px",
        backgroundPosition: "0 0, 8px 8px"
      }}
    >
      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        scaleX={zoom}
        scaleY={zoom}
        x={stagePos.x}
        y={stagePos.y}
        draggable={mode === "pan"}
        onMouseDown={handleStageMouseDown}
        onTouchStart={handleStageMouseDown}
        onMouseMove={(e: any) => {
          if (mode === "erase") extendEraseStroke(e.target.getStage());
          else if (shapeTool) extendShape(e.target.getStage());
        }}
        onTouchMove={(e: any) => {
          if (mode === "erase") extendEraseStroke(e.target.getStage());
          else if (shapeTool) extendShape(e.target.getStage());
        }}
        onMouseUp={() => {
          finishEraseStroke();
          finishShape();
        }}
        onTouchEnd={() => {
          finishEraseStroke();
          finishShape();
        }}
        onMouseLeave={() => {
          finishEraseStroke();
          finishShape();
        }}
        onDragEnd={handleStageDrag}
        onWheel={handleWheel}
        style={{
          cursor:
            mode === "erase"
              ? "cell"
              : placementIconType || placementText
                ? "crosshair"
                : mode === "pan"
                  ? "grab"
                  : "default"
        }}
      >
        <Layer ref={layerRef}>
          {/* Everything that belongs to the sheet turns together, pivoting on the
              sheet's centre: the plan, the shapes, the leader lines and the
              pictogram positions keep their exact relationship. */}
          <Group
            name="planScene"
            x={contentBounds.x + contentBounds.width / 2}
            y={contentBounds.y + contentBounds.height / 2}
            offsetX={contentBounds.x + contentBounds.width / 2}
            offsetY={contentBounds.y + contentBounds.height / 2}
            rotation={planRotation}
          >
          {/* Sheet backing: the plan plus anything placed outside it. Also the
              rectangle the export captures — see getStageDataUrl. */}
          {bgImage && (
            <Rect
              x={contentBounds.x}
              y={contentBounds.y}
              width={contentBounds.width}
              height={contentBounds.height}
              fill="#ffffff"
              shadowColor="#000000"
              shadowBlur={24 / Math.max(zoom, 0.1)}
              shadowOpacity={0.55}
              shadowOffsetY={6 / Math.max(zoom, 0.1)}
              listening={false}
              name="planSheet"
            />
          )}

          {/* Background plan — the eraser's working copy once one exists */}
          {bgImage && (
            <KonvaImage
              image={editedBackground || bgImage}
              width={imageSize.width}
              height={imageSize.height}
              name="bgImage"
            />
          )}

          {/* Drawn shapes — under the pictograms so icons stay readable */}
          {[...shapes, ...(draftShape ? [draftShape] : [])].map((shape) => {
            const isDraft = draftShape?.tempId === shape.tempId;
            const common = {
              id: shape.tempId,
              name: shape.tempId,
              stroke: shape.color,
              strokeWidth: shape.stroke_width,
              rotation: shape.rotation,
              draggable: mode === "select" && !shapeTool && !isDraft,
              onClick: () => onSelectShape?.(shape.tempId),
              onTap: () => onSelectShape?.(shape.tempId),
              // A thin line is hard to grab, so widen its hit area.
              hitStrokeWidth: Math.max(12, shape.stroke_width + 8),
              onDragEnd: (e: any) =>
                updateShape(shape.tempId, { x: e.target.x(), y: e.target.y() }),
              onTransformEnd: (e: any) => {
                const node = e.target;
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                node.scaleX(1);
                node.scaleY(1);
                updateShape(shape.tempId, {
                  x: node.x(),
                  y: node.y(),
                  width: Math.max(1, shape.width * scaleX),
                  height: shape.shape_type === "line"
                    ? shape.height * scaleY
                    : Math.max(1, shape.height * scaleY),
                  rotation: node.rotation()
                });
              }
            };

            if (shape.shape_type === "line") {
              return (
                <Line
                  key={shape.tempId}
                  {...common}
                  x={shape.x}
                  y={shape.y}
                  points={[0, 0, shape.width, shape.height]}
                  lineCap="round"
                />
              );
            }

            if (shape.shape_type === "circle") {
              return (
                <Ellipse
                  key={shape.tempId}
                  {...common}
                  x={shape.x + shape.width / 2}
                  y={shape.y + shape.height / 2}
                  radiusX={Math.max(1, shape.width / 2)}
                  radiusY={Math.max(1, shape.height / 2)}
                  onDragEnd={(e: any) =>
                    updateShape(shape.tempId, {
                      x: e.target.x() - shape.width / 2,
                      y: e.target.y() - shape.height / 2
                    })
                  }
                />
              );
            }

            return (
              <Rect
                key={shape.tempId}
                {...common}
                x={shape.x}
                y={shape.y}
                width={Math.max(1, shape.width)}
                height={Math.max(1, shape.height)}
              />
            );
          })}

          {/* Leader lines. Pure geometry linking two real positions, so unlike the
              pictograms these turn with the plan — they sit outside the
              ".iconUpright" groups that hold the artwork straight. */}
          {icons.map((icon) => {
            if (icon.anchor_x == null || icon.anchor_y == null) return null;

            const end = leaderEndpoint(icon, icon.anchor_x, icon.anchor_y);
            const dotRadius = Math.max(3, Math.min(7, icon.width * 0.1));

            return (
              <Group key={`leader-${icon.tempId}`}>
                <Line
                  points={[icon.anchor_x, icon.anchor_y, end.x, end.y]}
                  stroke="#111827"
                  strokeWidth={1.5}
                  listening={false}
                />
                <Circle
                  x={icon.anchor_x}
                  y={icon.anchor_y}
                  radius={dotRadius}
                  fill="#111827"
                  stroke="#ffffff"
                  strokeWidth={1}
                  hitStrokeWidth={14}
                  draggable={mode === "select" && !shapeTool}
                  onClick={() => onSelectIcon(icon.tempId)}
                  onTap={() => onSelectIcon(icon.tempId)}
                  onDragEnd={(e: any) => {
                    onIconsChange(
                      icons.map((item) =>
                        item.tempId === icon.tempId
                          ? { ...item, anchor_x: e.target.x(), anchor_y: e.target.y() }
                          : item
                      )
                    );
                  }}
                />
              </Group>
            );
          })}

          {/* Render Safety Icons */}
          {icons.map((icon) => {
            const iconImage = iconImages[icon.icon_type];
            return (
              <Group
                key={icon.tempId}
                id={icon.tempId}
                name={icon.tempId}
                x={icon.x}
                y={icon.y}
                width={icon.width}
                height={icon.height}
                rotation={icon.rotation}
                draggable={mode === "select"}
                onClick={() => onSelectIcon(icon.tempId)}
                onTap={() => onSelectIcon(icon.tempId)}
                onDragEnd={(e) => {
                  const updated = icons.map((item) => {
                    if (item.tempId === icon.tempId) {
                      return {
                        ...item,
                        x: e.target.x(),
                        y: e.target.y()
                      };
                    }
                    return item;
                  });
                  onIconsChange(updated);
                }}
                onTransformEnd={(e) => {
                  // transformer changes scale properties. We update width, height and rotation.
                  const node = e.target;
                  const scaleX = node.scaleX();
                  const scaleY = node.scaleY();

                  // Reset scale to avoid accumulating multiplier issues
                  node.scaleX(1);
                  node.scaleY(1);

                  const updated = icons.map((item) => {
                    if (item.tempId === icon.tempId) {
                      return {
                        ...item,
                        x: node.x(),
                        y: node.y(),
                        width: Math.max(15, node.width() * scaleX),
                        height: Math.max(15, node.height() * scaleY),
                        rotation: node.rotation()
                      };
                    }
                    return item;
                  });
                  onIconsChange(updated);
                }}
              >
                {/* Inner group carrying the artwork, pivoting on the icon's centre.
                    The export rotates this one to cancel the plan's orientation for
                    pictograms that must stay upright — see getStageDataUrl. The
                    outer group keeps its own transform so drag and resize are
                    untouched. */}
                <Group
                  name={`iconContent ${iconOrientationClass(icon.icon_type, iconDefinitions)}`}
                  x={icon.width / 2}
                  y={icon.height / 2}
                  offsetX={icon.width / 2}
                  offsetY={icon.height / 2}
                  rotation={iconArtworkRotation(icon, iconDefinitions, planRotation)}
                >
                  {/* SVG Render */}
                  {iconImage ? (
                    <KonvaImage
                      image={iconImage}
                      width={icon.width}
                      height={icon.height}
                    />
                  ) : (
                    <Rect
                      width={icon.width}
                      height={icon.height}
                      fill={iconDefinitions[icon.icon_type]?.color || "#ffffff"}
                      cornerRadius={4}
                    />
                  )}
                  {/* Custom label indicator */}
                  {icon.label && (
                    <Text
                      text={icon.label}
                      y={icon.height + 4}
                      x={0}
                      width={icon.width}
                      align="center"
                      fontSize={11}
                      fill="#ffffff"
                      fontStyle="bold"
                      shadowColor="#000000"
                      shadowBlur={4}
                    />
                  )}
                </Group>
              </Group>
            );
          })}

          {/* Render free text annotations */}
          {texts.map((t) => {
            const fontStyle = `${t.italic ? "italic" : ""} ${t.bold ? "bold" : "normal"}`.trim() || "normal";
            // Measure width/height indirectly via Konva: we render a transparent
            // measure node and rely on the visible Text for layout. To keep the
            // background rect and selection tight, approximate from font metrics.
            const approxWidth = Math.max(20, t.text.length * t.font_size * 0.55);
            const approxHeight = Math.max(t.font_size * 1.3, (t.text.split("\n").length) * t.font_size * 1.3);
            const padX = 6;
            const padY = 4;
            return (
              <Group
                key={t.tempId}
                id={t.tempId}
                name={t.tempId}
                x={t.x}
                y={t.y}
                rotation={t.rotation}
                draggable={mode === "select"}
                onClick={() => onSelectText?.(t.tempId)}
                onTap={() => onSelectText?.(t.tempId)}
                onDragEnd={(e) => {
                  const updated = texts.map((item) =>
                    item.tempId === t.tempId
                      ? { ...item, x: e.target.x(), y: e.target.y() }
                      : item
                  );
                  onTextsChange?.(updated);
                }}
                onTransformEnd={(e) => {
                  const node = e.target;
                  const scaleX = node.scaleX();
                  node.scaleX(1);
                  node.scaleY(1);
                  const updated = texts.map((item) =>
                    item.tempId === t.tempId
                      ? {
                          ...item,
                          x: node.x(),
                          y: node.y(),
                          rotation: node.rotation(),
                          // Uniform scale → grow the font size proportionally.
                          font_size: Math.max(6, item.font_size * scaleX),
                        }
                      : item
                  );
                  onTextsChange?.(updated);
                }}
              >
                {/* Inner group carrying the text artwork, pivoting on the text's
                    centre so it stays upright when the sheet is turned — mirroring
                    how upright equipment pictograms are kept readable. The outer
                    group keeps its own transform so drag and resize are untouched. */}
                <Group
                  x={approxWidth / 2}
                  y={approxHeight / 2}
                  offsetX={approxWidth / 2}
                  offsetY={approxHeight / 2}
                  rotation={-planRotation}
                >
                  {t.background_color ? (
                    <Rect
                      x={-padX}
                      y={-padY}
                      width={approxWidth + padX * 2}
                      height={approxHeight + padY * 2}
                      fill={t.background_color}
                      cornerRadius={2}
                    />
                  ) : null}
                  <Text
                    text={t.text || "Texte"}
                    fontSize={t.font_size}
                    fontFamily={t.font_family}
                    fill={t.color}
                    fontStyle={fontStyle}
                    lineHeight={1.3}
                  />
                </Group>
              </Group>
            );
          })}
          </Group>

          {/* Selection Transformer handles resizing & rotation */}
          {mode === "select" && (
            <Transformer
              ref={transformerRef}
              boundBoxFunc={(oldBox, newBox) => {
                // limit minimum size
                if (Math.abs(newBox.width) < 15 || Math.abs(newBox.height) < 15) {
                  return oldBox;
                }
                return newBox;
              }}
              enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
              rotateAnchorOffset={20}
              borderStroke="#3b82f6"
              anchorStroke="#3b82f6"
              anchorFill="#ffffff"
              anchorSize={8}
            />
          )}
        </Layer>
      </Stage>

      {placementIconType && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 select-none rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-[11px] font-medium text-emerald-300 backdrop-blur-sm">
          Cliquez sur le plan pour placer l&apos;équipement &middot; Échap pour annuler
        </div>
      )}

      {mode === "erase" && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 select-none rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-[11px] font-medium text-amber-300 backdrop-blur-sm">
          Gomme active &middot; glissez sur le plan pour effacer
        </div>
      )}
    </div>
  );
}

export default PlanCanvas;
