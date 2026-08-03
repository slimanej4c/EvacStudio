"use client";

import React, { useState, useEffect, useRef, useCallback, useImperativeHandle } from "react";
import { Stage, Layer, Image as KonvaImage, Transformer, Group, Rect, Text } from "react-konva";
import { IconType, SAFETY_ICONS, SafetyIconDefinition, getIconImageSource } from "@/utils/safetyIcons";

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
}

export type EraserShape = "square" | "circle";

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
}

export interface PlanCanvasHandle {
  /** The background with the eraser strokes baked in, for saving or exporting. */
  getEditedBackground: () => HTMLCanvasElement | null;
}

// Share of the workspace the plan occupies when fitted, leaving a margin around it.
const FIT_VIEWPORT_RATIO = 0.75;

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
    });

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, [icons, imageSize]);

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

    // Fit the whole sheet, not just the plan: icons placed outside must stay in view.
    const scale =
      Math.min(width / contentBounds.width, height / contentBounds.height) * FIT_VIEWPORT_RATIO;
    const clampedScale = Math.max(0.1, Math.min(5, scale));

    setZoom(clampedScale);
    setStagePos({
      x: (width - contentBounds.width * clampedScale) / 2 - contentBounds.x * clampedScale,
      y: (height - contentBounds.height * clampedScale) / 2 - contentBounds.y * clampedScale
    });

    // This position is already correct for the new size — tell the centre-keeping
    // effect not to shift it again when it observes the resize.
    previousStageSizeRef.current = { width, height };
  }, [contentBounds, setZoom]);

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

      if (selectedIconId) {
        const selectedNode = stage.findOne("." + selectedIconId);
        if (selectedNode) {
          transformerRef.current.nodes([selectedNode]);
          transformerRef.current.getLayer().batchDraw();
          return;
        }
      }
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer().batchDraw();
    }
  }, [selectedIconId, icons]);

  // Keyboard shortcut to delete selected icon
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIconId) {
        // Prevent deleting if typing in label input
        if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") {
          return;
        }
        onIconsChange(icons.filter((icon) => icon.tempId !== selectedIconId));
        onSelectIcon(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedIconId, icons, onIconsChange, onSelectIcon]);

  const handleStageMouseDown = (e: any) => {
    if (mode === "erase") {
      beginEraseStroke(e.target.getStage());
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

    // Clicked on stage background -> deselect
    if (e.target === e.target.getStage() || e.target.name() === "bgImage") {
      onSelectIcon(null);
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
        }}
        onTouchMove={(e: any) => {
          if (mode === "erase") extendEraseStroke(e.target.getStage());
        }}
        onMouseUp={finishEraseStroke}
        onTouchEnd={finishEraseStroke}
        onMouseLeave={finishEraseStroke}
        onDragEnd={handleStageDrag}
        onWheel={handleWheel}
        style={{
          cursor:
            mode === "erase"
              ? "cell"
              : placementIconType
                ? "crosshair"
                : mode === "pan"
                  ? "grab"
                  : "default"
        }}
      >
        <Layer ref={layerRef}>
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
            );
          })}

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
