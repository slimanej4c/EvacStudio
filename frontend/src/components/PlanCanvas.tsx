"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo, useImperativeHandle } from "react";
import type Konva from "konva";
import { Stage, Layer, Image as KonvaImage, Transformer, Group, Rect, Text, Line, Ellipse, Circle, Path } from "react-konva";
import { SheetBlock, findPlanBlock } from "@/lib/sheetTemplates";
import SheetBlockNode, { SheetLegendEntry } from "@/components/SheetBlockNode";
import { IconType, SAFETY_ICONS, SafetyIconDefinition, buildStretchableIconSource, getIconLeaderColor, isDirectionalIcon, isYouAreHereIcon, normalizePictogramColorOverride } from "@/utils/safetyIcons";
import { WatermarkConfig } from "@/lib/watermark";
import { buildCurvePathData } from "@/lib/curvePath";
import { hasVisibleShapeFill, shapeHitStrokeWidth } from "@/lib/shapeFill";
import {
  normalizeCanvasIconDimension,
  normalizeCanvasIconSizeToAspectRatio,
  normalizeCanvasLeaderWidth,
  normalizeCanvasLeaderDotSize,
  normalizeTransformedCanvasIconDimension,
} from "@/lib/canvasIconDimensions";
import { imageCrossOrigin } from "@/lib/api";
import { loadPdfJs } from "@/lib/pdfjs";
import { shouldMainPlanReceivePointerEvents } from "@/lib/canvasPlanInteraction";

export interface CanvasLeaderPoint {
  id: string;
  x: number;
  y: number;
}

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
  /** Every real position connected to this one pictogram. */
  leader_points?: CanvasLeaderPoint[];
  /** Leader-line stroke width (editable per icon). */
  leader_width?: number;
  /** Radius / size of the anchor dot at the start of the leader line (defaults to 1.0 px). */
  leader_dot_size?: number;
  /** Leader-line color (editable per icon, defaults to icon color). */
  leader_color?: string | null;
  /** When true, the pictogram is drawn inside a square frame. */
  framed?: boolean;
  /** When true, the pictogram artwork is mirrored horizontally. */
  flip_x?: boolean;
  /** When true, the pictogram artwork is mirrored vertically. */
  flip_y?: boolean;
  /** False lets width and height be resized independently. Defaults to true. */
  lock_aspect_ratio?: boolean;
  /** '#rrggbb' repaint of the pictogram's ground; blank keeps the original. */
  color?: string;
  locked?: boolean;
  visible?: boolean;
  z_index?: number;
  /** Stable association with a plan; empty means the object is independent. */
  group_id?: string;
  /** Independent group created from an area/multi-selection. */
  object_group_id?: string;
}

export function canvasIconLeaderPoints(icon: Pick<CanvasIcon, "tempId" | "leader_points" | "anchor_x" | "anchor_y">): CanvasLeaderPoint[] {
  if (Array.isArray(icon.leader_points) && icon.leader_points.length > 0) {
    return icon.leader_points;
  }
  if (icon.anchor_x != null && icon.anchor_y != null) {
    return [{ id: `legacy-${icon.tempId}`, x: icon.anchor_x, y: icon.anchor_y }];
  }
  return [];
}

export type EraserShape = "square" | "circle";
export type EraserTarget = "background" | "lines";

export type ShapeKind = "line" | "rect" | "circle" | "zone" | "polyline" | "polygon_zone" | "free_polygon_zone" | "curve_polygon_zone";

export type ShapePoint = { x: number; y: number };

const POINT_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function pointLabel(index: number): string {
  if (index < POINT_LABELS.length) return POINT_LABELS[index];
  return `${POINT_LABELS[index % POINT_LABELS.length]}${Math.floor(index / POINT_LABELS.length)}`;
}

export function boundsFromPoints(points: ShapePoint[]) {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function measureCanvasText(text: string, fontSize: number, fontFamily = "Arial", fontStyle = "normal") {
  const lines = (text || "Texte").split("\n");
  const fallbackWidth = Math.max(20, ...lines.map((line) => line.length * fontSize * 0.68));
  const fallbackHeight = Math.max(fontSize * 1.35, lines.length * fontSize * 1.35);

  if (typeof document === "undefined") {
    return { width: fallbackWidth, height: fallbackHeight };
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return { width: fallbackWidth, height: fallbackHeight };

  context.font = `${fontStyle} ${fontSize}px ${fontFamily || "Arial"}`;
  const measuredWidth = Math.max(20, ...lines.map((line) => context.measureText(line || " ").width));
  return {
    width: Math.ceil(measuredWidth + fontSize * 0.45),
    height: Math.ceil(Math.max(fontSize * 1.35, lines.length * fontSize * 1.35))
  };
}


export function isPolygonShape(kind?: string | null): boolean {
  return kind === "polyline" || kind === "polygon_zone" || kind === "free_polygon_zone" || kind === "curve_polygon_zone";
}

export function isPolygonTool(tool?: string | null): boolean {
  return tool === "polyline" || tool === "polygon_zone" || tool === "free_polygon_zone" || tool === "curve_polygon_zone";
}

export function pointsToFlat(points: ShapePoint[]) {
  return points.flatMap((point) => [point.x, point.y]);
}

function shouldMultiplyFill(color?: string | null): boolean {
  if (!color) return false;
  const normalized = color.trim().toLowerCase();
  return normalized !== "#fff" && normalized !== "#ffffff" && normalized !== "white";
}

/** Snap a segment endpoint to the nearest horizontal or vertical axis. */
export function snapPolylinePointToOrthogonal(origin: ShapePoint, point: ShapePoint): ShapePoint {
  const deltaX = point.x - origin.x;
  const deltaY = point.y - origin.y;
  return Math.abs(deltaX) >= Math.abs(deltaY)
    ? { x: point.x, y: origin.y }
    : { x: origin.x, y: point.y };
}

export interface SmartAlignmentResult {
  point: ShapePoint;
  /** Matching anchor that creates a vertical guide (same x). */
  verticalReference?: ShapePoint;
  /** Matching anchor that creates a horizontal guide (same y). */
  horizontalReference?: ShapePoint;
}

/**
 * Illustrator-style smart alignment for point-by-point drawing. X and Y are
 * resolved independently, so the cursor can align with one anchor vertically
 * and another one horizontally. The tolerance is expressed in drawing units;
 * callers convert the fixed screen tolerance through the current zoom.
 */
export function snapPointToAlignmentGuides(
  point: ShapePoint,
  references: ShapePoint[],
  tolerance: number
): SmartAlignmentResult {
  let verticalReference: ShapePoint | undefined;
  let horizontalReference: ShapePoint | undefined;
  let closestX = Math.max(0, tolerance) + Number.EPSILON;
  let closestY = Math.max(0, tolerance) + Number.EPSILON;

  references.forEach((reference) => {
    const distanceX = Math.abs(reference.x - point.x);
    const distanceY = Math.abs(reference.y - point.y);
    if (distanceX < closestX) {
      closestX = distanceX;
      verticalReference = reference;
    }
    if (distanceY < closestY) {
      closestY = distanceY;
      horizontalReference = reference;
    }
  });

  return {
    point: {
      x: verticalReference?.x ?? point.x,
      y: horizontalReference?.y ?? point.y,
    },
    verticalReference,
    horizontalReference,
  };
}

function rotateShapeOffset(origin: ShapePoint, offset: ShapePoint, rotation: number): ShapePoint {
  if (!rotation) return { x: origin.x + offset.x, y: origin.y + offset.y };
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: origin.x + offset.x * cos - offset.y * sin,
    y: origin.y + offset.x * sin + offset.y * cos,
  };
}

function editorLayerNodeName(id: string): string {
  return `editorLayer-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function sheetLayerNodeName(id: string): string {
  return `sheetLayer-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

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
  /** Optional background/fill color for shapes & zones. */
  fill_color?: string | null;
  /** Optional background opacity (0 to 1). */
  fill_opacity?: number;
  /** Optional global curve tension (0 to 1). */
  tension?: number;
  /** Optional control points for curved segments: segmentIndex -> controlPoint */
  control_points?: Record<number, ShapePoint>;
  /** Absolute plan coordinates for polygon_zone shapes. */
  points?: ShapePoint[];
  /** Whether a point-by-point path connects its last point back to its first. */
  closed?: boolean;
  /** Segment start indexes forced to a straight line with Shift while drawing. */
  straight_segments?: number[];
  locked?: boolean;
  visible?: boolean;
  z_index?: number;
  group_id?: string;
  object_group_id?: string;
  /** Hidden two-point reference used to verify the real printed scale. */
  is_scale_calibration?: boolean;
  calibration_real_distance_m?: number | null;
}

/** Remove one editable vertex while keeping a valid open or closed path. */
export function shapeWithoutPoint(shape: CanvasShape, pointIndex: number): CanvasShape | null {
  const originalPoints = shape.points || [];
  const minimumPoints = shape.shape_type === "polyline" ? 2 : 3;
  if (pointIndex < 0 || pointIndex >= originalPoints.length || originalPoints.length <= minimumPoints) {
    return null;
  }

  const originalIndexes = originalPoints.map((_, index) => index).filter((index) => index !== pointIndex);
  const points = originalIndexes.map((index) => ({ ...originalPoints[index] }));
  let controlPoints = shape.control_points;
  let straightSegments = shape.straight_segments;

  // Curve handles belong to a segment start index. Preserve handles on
  // untouched segments and discard only the two segments joined by deletion.
  if (shape.shape_type === "curve_polygon_zone") {
    const remapped: Record<number, ShapePoint> = {};
    const remappedStraightSegments: number[] = [];
    const originalStraightSegments = new Set(shape.straight_segments || []);
    const closed = shape.closed ?? true;
    const segmentCount = closed ? originalIndexes.length : originalIndexes.length - 1;
    originalIndexes.slice(0, segmentCount).forEach((oldStartIndex, newSegmentIndex) => {
      const oldEndIndex = closed
        ? originalIndexes[(newSegmentIndex + 1) % originalIndexes.length]
        : originalIndexes[newSegmentIndex + 1];
      const segmentWasUntouched = closed
        ? oldEndIndex === (oldStartIndex + 1) % originalPoints.length
        : oldEndIndex === oldStartIndex + 1;
      const oldControlPoint = shape.control_points?.[oldStartIndex];
      if (segmentWasUntouched && oldControlPoint) {
        remapped[newSegmentIndex] = { ...oldControlPoint };
      }
      if (segmentWasUntouched && originalStraightSegments.has(oldStartIndex)) {
        remappedStraightSegments.push(newSegmentIndex);
      }
    });
    controlPoints = remapped;
    straightSegments = remappedStraightSegments;
  }

  return {
    ...shape,
    points,
    ...boundsFromPoints(points),
    control_points: controlPoints,
    straight_segments: straightSegments,
  };
}

export interface CutPolylineResult {
  changed: boolean;
  fragments: ShapePoint[][];
}

function distanceFromPointToSegment(point: ShapePoint, start: ShapePoint, end: ShapePoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
  ));
  return Math.hypot(
    point.x - (start.x + ratio * dx),
    point.y - (start.y + ratio * dy)
  );
}

function pointTouchesEraser(point: ShapePoint, eraserStroke: ShapePoint[], radius: number): boolean {
  if (!eraserStroke.length) return false;
  if (eraserStroke.length === 1) {
    return Math.hypot(point.x - eraserStroke[0].x, point.y - eraserStroke[0].y) <= radius;
  }
  return eraserStroke.slice(1).some((end, index) =>
    distanceFromPointToSegment(point, eraserStroke[index], end) <= radius
  );
}

function eraserBoundary(
  safePoint: ShapePoint,
  erasedPoint: ShapePoint,
  eraserStroke: ShapePoint[],
  radius: number
): ShapePoint {
  let safe = { ...safePoint };
  let erased = { ...erasedPoint };
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const middle = { x: (safe.x + erased.x) / 2, y: (safe.y + erased.y) / 2 };
    if (pointTouchesEraser(middle, eraserStroke, radius)) erased = middle;
    else safe = middle;
  }
  return { x: (safe.x + erased.x) / 2, y: (safe.y + erased.y) / 2 };
}

function simplifyStraightRun(points: ShapePoint[]): ShapePoint[] {
  if (points.length <= 2) return points;
  const simplified: ShapePoint[] = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplified[simplified.length - 1];
    const current = points[index];
    const next = points[index + 1];
    if (distanceFromPointToSegment(current, previous, next) > 0.05) simplified.push(current);
  }
  simplified.push(points[points.length - 1]);
  return simplified;
}

/** Cut an open path wherever a round eraser stroke crosses it. */
export function cutPolylineByEraser(
  points: ShapePoint[],
  eraserStroke: ShapePoint[],
  radius: number
): CutPolylineResult {
  if (points.length < 2 || !eraserStroke.length || radius <= 0) {
    return { changed: false, fragments: [points.map((point) => ({ ...point }))] };
  }

  const fragments: ShapePoint[][] = [];
  let currentFragment: ShapePoint[] = [];
  let previousSample: ShapePoint | null = null;
  let previousErased = false;
  let changed = false;
  const sampleSpacing = Math.max(0.75, radius / 3);
  const appendDistinct = (target: ShapePoint[], point: ShapePoint) => {
    const last = target[target.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 0.01) target.push(point);
  };
  const finishFragment = () => {
    const simplified = simplifyStraightRun(currentFragment);
    const length = simplified.slice(1).reduce((total, point, index) =>
      total + Math.hypot(point.x - simplified[index].x, point.y - simplified[index].y), 0
    );
    if (simplified.length >= 2 && length > 0.5) fragments.push(simplified);
    currentFragment = [];
  };

  points.slice(1).forEach((segmentEnd, segmentIndex) => {
    const segmentStart = points[segmentIndex];
    const segmentLength = Math.hypot(segmentEnd.x - segmentStart.x, segmentEnd.y - segmentStart.y);
    const steps = Math.max(1, Math.ceil(segmentLength / sampleSpacing));
    for (let step = segmentIndex === 0 ? 0 : 1; step <= steps; step += 1) {
      const ratio = step / steps;
      const sample = {
        x: segmentStart.x + (segmentEnd.x - segmentStart.x) * ratio,
        y: segmentStart.y + (segmentEnd.y - segmentStart.y) * ratio,
      };
      const erased = pointTouchesEraser(sample, eraserStroke, radius);
      if (erased) changed = true;

      if (!previousSample) {
        if (!erased) currentFragment = [{ ...sample }];
      } else if (erased === previousErased) {
        if (!erased) appendDistinct(currentFragment, { ...sample });
      } else if (previousErased) {
        const boundary = eraserBoundary(sample, previousSample, eraserStroke, radius);
        currentFragment = [boundary];
        appendDistinct(currentFragment, { ...sample });
      } else {
        const boundary = eraserBoundary(previousSample, sample, eraserStroke, radius);
        appendDistinct(currentFragment, boundary);
        finishFragment();
      }

      previousSample = sample;
      previousErased = erased;
    }
  });
  if (currentFragment.length) finishFragment();

  return changed
    ? { changed: true, fragments }
    : { changed: false, fragments: [points.map((point) => ({ ...point }))] };
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
  align?: "left" | "center" | "right";
  color: string;
  bold: boolean;
  italic: boolean;
  /** Optional background color behind the text; null/undefined means transparent. */
  background_color?: string | null;
  rotation: number;
  locked?: boolean;
  visible?: boolean;
  z_index?: number;
  group_id?: string;
  object_group_id?: string;
}

/** The id the main plan answers to when it is selected like any other plan. */
export const MAIN_PLAN_ID = "main_plan";
export const BAT_BLOCK_ID = "bat_approval_block";

export interface CanvasPlanTransform {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasPlanOverlay {
  tempId: string;
  /** Primary key once the overlay has been saved; absent while it is local. */
  serverId?: number;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label?: string;
  locked?: boolean;
  visible?: boolean;
  z_index?: number;
  group_id?: string;
  /** The pixels changed locally and must replace the stored file on save. */
  imageChanged?: boolean;
  /** Whether the currently displayed pixels are the imported original. */
  isOriginal?: boolean;
  /** True once the server has preserved an original copy for restoration. */
  canRevertOriginal?: boolean;
}

export interface CanvasMultiSelection {
  iconIds: string[];
  shapeIds: string[];
  textIds: string[];
}

interface PlanCanvasProps {
  backgroundUrl: string;
  backgroundType: "image" | "pdf";
  icons: CanvasIcon[];
  onIconsChange: (icons: CanvasIcon[]) => void;
  selectedIconId: string | null;
  onSelectIcon: (id: string | null, meta?: { shiftKey?: boolean; ctrlKey?: boolean }) => void;
  zoom: number;
  setZoom: (zoom: number) => void;
  mode: "select" | "pan" | "erase";
  placementIconType?: IconType | null;
  placementIconSize?: { width: number; height: number };
  onPlaceIcon?: (
    type: IconType,
    x: number,
    y: number,
    size?: { width: number; height: number }
  ) => void;
  iconDefinitions?: Record<string, SafetyIconDefinition>;
  /** Incremented by the parent to request a "fit plan to view" pass. */
  fitSignal?: number;
  /** Eraser diameter, in plan units. */
  eraserSize?: number;
  /** Eraser brush shape. */
  eraserShape?: EraserShape;
  /** Whether the eraser edits the raster plan or cuts openings in vector lines. */
  eraserTarget?: EraserTarget;
  /**
   * Number of eraser strokes the parent wants applied. Set by undo/redo so the
   * eraser follows the same timeline as icons, shapes and texts instead of
   * keeping a private stack that broke the chronological order.
   */
  /** Stroke count the global history wants, with a nonce so an identical count still applies. */
  eraseStrokeTarget?: { count: number; nonce: number } | null;
  /** Incremented by the parent to undo the last eraser stroke. */
  undoEraseSignal?: number;
  /** Incremented by the parent to drop every eraser stroke. */
  resetEraseSignal?: number;
  /** Fires after each stroke with the number of strokes currently applied. */
  onEraseStrokesChange?: (count: number) => void;
  /** Notifies parent when dragging handles (such as polygon vertices) starts or ends */
  onDragStateChange?: (dragging: boolean) => void;
  shapes?: CanvasShape[];
  onShapesChange?: (shapes: CanvasShape[]) => void;
  selectedShapeId?: string | null;
  onSelectShape?: (id: string | null, meta?: { shiftKey?: boolean; ctrlKey?: boolean }) => void;
  /** When set, dragging on the plan draws a new shape of this kind. */
  shapeTool?: ShapeKind | null;
  onFinishShapeTool?: () => void;
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
  onSelectText?: (id: string | null, meta?: { shiftKey?: boolean; ctrlKey?: boolean }) => void;
  /** When true, the next click on the plan places a new text. */
  placementText?: boolean;
  onPlaceText?: (x: number, y: number) => void;


  // ── Sheet mode ────────────────────────────────────────────────────────────
  /**
   * When set, the studio stops showing the bare plan and shows the printed
   * sheet instead: the plan is drawn inside its window and the template's
   * blocks — banner, notices, legend, logos — are laid around it, each one
   * draggable and resizable with the mouse.
   */
  sheet?: {
    width: number;
    height: number;
    blocks: SheetBlock[];
  } | null;
  /** False makes the template itself read-only while plan annotations stay editable. */
  sheetEditingEnabled?: boolean;
  /** Per-block exception for plan-owned overlays on a protected default template. */
  isSheetBlockEditable?: (block: SheetBlock) => boolean;
  onSheetBlocksChange?: (blocks: SheetBlock[]) => void;
  selectedBlockId?: string | null;
  /** All template blocks selected by a mouse marquee or an object group. */
  selectedBlockIds?: string[];
  onSelectBlock?: (id: string | null, meta?: { shiftKey?: boolean; ctrlKey?: boolean }) => void;
  onSelectBlocks?: (ids: string[]) => void;
  /** Logos available to the sheet's `image` blocks. */
  sheetImages?: Partial<Record<string, HTMLImageElement | null>>;
  /** Rows of the legend block, built from the pictograms actually placed. */
  sheetLegendEntries?: SheetLegendEntry[];
  /** Pictogram artwork for `picto` blocks, keyed by icon type. */
  sheetPictoImages?: Partial<Record<string, HTMLImageElement | null>>;
  /**
   * Placing a pictogram outside the plan's window drops it on the sheet itself,
   * so a symbol can sit in a heading or beside a notice. Coordinates are in
   * sheet units.
   */
  onPlaceSheetIcon?: (
    type: IconType,
    x: number,
    y: number,
    size?: { width: number; height: number }
  ) => void;
  /** Places a free text block directly on the sheet, outside the plan window. */
  onPlaceSheetText?: (x: number, y: number) => void;
  /** Stores a completed drawing as an editable sheet block. */
  onPlaceSheetShape?: (shape: CanvasShape) => void;
  /**
   * When on, dragging the plan reframes it inside its window instead of moving
   * the window across the sheet. Holding Alt does the same for one gesture.
   */
  planReframeMode?: boolean;
  /** How the plan sits inside its window: zoom in %, then a nudge in sheet units. */
  planPlacement?: { scale: number; offsetX: number; offsetY: number };
  onPlanPlacementChange?: (placement: { scale: number; offsetX: number; offsetY: number }) => void;
  /** Floating secondary plan overlays on the canvas. */
  planOverlays?: CanvasPlanOverlay[];
  onPlanOverlaysChange?: (overlays: CanvasPlanOverlay[]) => void;
  selectedOverlayId?: string | null;
  onSelectOverlay?: (id: string | null) => void;
  /** Whether to lock aspect ratio during plan resizing. */
  keepPlanRatio?: boolean;
  mainPlanTransform: CanvasPlanTransform;
  onMainPlanTransformChange: (transform: CanvasPlanTransform) => void;
  mainPlanLocked?: boolean;
  mainPlanVisible?: boolean;
  mainPlanZIndex?: number;
  mainPlanGroupId?: string;
  /** False preserves the legacy behaviour where every annotation follows. */
  mainPlanGroupingEnabled?: boolean;
  /** One-shot rectangle selection tool for icons, shapes and text. */
  areaSelectionMode?: boolean;
  multiSelection?: CanvasMultiSelection;
  onMultiSelectionChange?: (selection: CanvasMultiSelection) => void;
  onAreaSelectionComplete?: (count: number) => void;
  watermark: WatermarkConfig;
  onWatermarkChange: (config: WatermarkConfig) => void;
  canvasMargin?: number;
  onPlanDeformedChange?: (deformed: boolean) => void;
  selectedBatBlock?: boolean;
  onSelectBatBlock?: (selected: boolean) => void;
}

export interface PlanCanvasHandle {
  /** Live Konva stage used by the editor and by the unified export path. */
  getStage: () => Konva.Stage | null;
  /** The background with the eraser strokes baked in, for saving or exporting. */
  getEditedBackground: () => HTMLCanvasElement | null;
  /** Get the current background image width and height in pixels. */
  getBackgroundDimensions: () => { width: number; height: number };
  /** Raster source currently shown, including PDF rendering/eraser edits. */
  getBackgroundDataUrl: () => string | null;
  /** Remove one point from an unfinished path before using global history. */
  undoActiveDrawing: () => boolean;
  /** Preserve an unfinished visible path as an editable open drawing. */
  commitActiveDrawing: () => boolean;
  /** Explicitly discard the current unfinished drawing. */
  cancelActiveDrawing: () => void;
  /** Re-open a committed polygon/curve shape into the active drawing draft on undo. */
  restorePolygonDraft: (shape: CanvasShape) => boolean;
  /** Restore the natural 1:1 aspect ratio of the main plan if deformed. */
  restoreMainPlanRatio: () => boolean;
  /** Check if the main plan currently differs from its intrinsic aspect ratio. */
  isMainPlanDeformed: () => boolean;
  /** Convert a distance in plan-scene units to the final sheet's design units. */
  getPlanDistanceInSheetUnits: (planDistance: number) => number | null;
  /** Current plan-window corners expressed in the same source space as a traced silhouette. */
  getVisiblePlanPolygon: () => ShapePoint[] | null;
}

// Share of the workspace the plan occupies when fitted, leaving a margin around it.
const FIT_VIEWPORT_RATIO = 0.75;

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

/**
 * Where a leader line must stop. The artwork can have two rotations at once:
 * its own rotation and the compensation that keeps it readable when the plan
 * turns. In particular, “Vous êtes ici” drives the plan rotation itself. Using
 * the stored, axis-aligned x/y box therefore left its line behind as soon as the
 * plan turned.
 *
 * Work in the artwork's real oriented rectangle, then enter it far enough to
 * bridge transparent SVG/PNG margins. The artwork is painted over the line, so
 * this small overlap makes the join seamless.
 */
function leaderEndpoint(
  icon: CanvasIcon,
  anchorX: number,
  anchorY: number,
  definitions: Record<string, SafetyIconDefinition>,
  planRotation: number
) {
  const halfWidth = icon.width / 2;
  const halfHeight = icon.height / 2;
  const outerRadians = ((icon.rotation || 0) * Math.PI) / 180;

  // Konva rotates the outer icon group around its x/y origin. Consequently its
  // displayed centre is the rotated half-size vector, not simply x+w/2,y+h/2.
  const centreX = icon.x + halfWidth * Math.cos(outerRadians) - halfHeight * Math.sin(outerRadians);
  const centreY = icon.y + halfWidth * Math.sin(outerRadians) + halfHeight * Math.cos(outerRadians);

  // Combined orientation of the actual artwork inside planScene. planScene's
  // own rotation is shared by both the line and icon and cancels out here.
  const artworkDegrees = (icon.rotation || 0) + iconArtworkRotation(icon, definitions, planRotation);
  const artworkRadians = (artworkDegrees * Math.PI) / 180;
  const cos = Math.cos(artworkRadians);
  const sin = Math.sin(artworkRadians);

  // Rotate the anchor into a rectangle centred at (0,0).
  const worldDx = anchorX - centreX;
  const worldDy = anchorY - centreY;
  const localAnchorX = worldDx * cos + worldDy * sin;
  const localAnchorY = -worldDx * sin + worldDy * cos;
  const distance = Math.hypot(localAnchorX, localAnchorY);
  if (distance < 0.001) return { x: centreX, y: centreY };

  // If the anchor is already inside the pictogram, hide the end below its
  // centre. Otherwise intersect the anchor -> centre ray with the rotated box.
  if (Math.abs(localAnchorX) <= halfWidth && Math.abs(localAnchorY) <= halfHeight) {
    return { x: centreX, y: centreY };
  }
  const scaleAtVerticalEdge = Math.abs(localAnchorX) > 0.001
    ? halfWidth / Math.abs(localAnchorX)
    : Number.POSITIVE_INFINITY;
  const scaleAtHorizontalEdge = Math.abs(localAnchorY) > 0.001
    ? halfHeight / Math.abs(localAnchorY)
    : Number.POSITIVE_INFINITY;
  const boundaryScale = Math.min(scaleAtVerticalEdge, scaleAtHorizontalEdge);
  const boundaryDistance = distance * boundaryScale;
  const smallestSide = Math.min(icon.width, icon.height);
  const desiredOverlap = Math.max(4, smallestSide * 0.18, normalizeCanvasLeaderWidth(icon.leader_width) * 1.5);
  const overlap = Math.min(boundaryDistance, desiredOverlap, smallestSide * 0.3);
  const endpointScale = Math.max(0, boundaryDistance - overlap) / distance;
  const localEndpointX = localAnchorX * endpointScale;
  const localEndpointY = localAnchorY * endpointScale;

  return {
    x: centreX + localEndpointX * cos - localEndpointY * sin,
    y: centreY + localEndpointX * sin + localEndpointY * cos,
  };
}

function rotatedBoxBounds(box: { x: number; y: number; width: number; height: number; rotation: number }) {
  const radians = (box.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners = [
    { x: 0, y: 0 },
    { x: box.width, y: 0 },
    { x: box.width, y: box.height },
    { x: 0, y: box.height },
  ].map((point) => ({
    x: box.x + point.x * cos - point.y * sin,
    y: box.y + point.x * sin + point.y * cos,
  }));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

const PDF_RENDER_SCALE = 6;

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
  eraserTarget = "background",
  eraseStrokeTarget = null,
  undoEraseSignal = 0,
  resetEraseSignal = 0,
  onEraseStrokesChange,
  onDragStateChange,
  shapes = [],
  onShapesChange,
  selectedShapeId = null,
  onSelectShape,
  shapeTool = null,
  onFinishShapeTool,
  shapeStrokeWidth = 1,
  shapeColor = "#000000",
  planRotation = 0,
  texts = [],
  onTextsChange,
  selectedTextId = null,
  onSelectText,
  placementText = false,
  onPlaceText,
  sheet = null,
  sheetEditingEnabled = true,
  isSheetBlockEditable,
  onSheetBlocksChange,
  selectedBlockId = null,
  selectedBlockIds = [],
  onSelectBlock,
  onSelectBlocks,
  sheetImages = {},
  sheetLegendEntries = [],
  sheetPictoImages = {},
  onPlaceSheetIcon,
  onPlaceSheetText,
  onPlaceSheetShape,
  planReframeMode = false,
  planPlacement = { scale: 100, offsetX: 0, offsetY: 0 },
  onPlanPlacementChange,
  planOverlays = [],
  onPlanOverlaysChange,
  selectedOverlayId = null,
  onSelectOverlay,
  keepPlanRatio = true,
  mainPlanTransform: storedMainPlanTransform,
  onMainPlanTransformChange,
  mainPlanLocked = false,
  mainPlanVisible = true,
  mainPlanZIndex = 0,
  mainPlanGroupId = "",
  mainPlanGroupingEnabled = false,
  areaSelectionMode = false,
  multiSelection = { iconIds: [], shapeIds: [], textIds: [] },
  onMultiSelectionChange,
  onAreaSelectionComplete,
  watermark,
  onWatermarkChange,
  canvasMargin = 28,
  onPlanDeformedChange,
  selectedBatBlock = false,
  onSelectBatBlock,
  canvasRef
}: PlanCanvasProps & { canvasRef?: React.Ref<PlanCanvasHandle> }) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [overlayImages, setOverlayImages] = useState<Record<string, HTMLImageElement>>({});
  const [batLogoImages, setBatLogoImages] = useState<{
    client: HTMLImageElement | null;
    creator: HTMLImageElement | null;
  }>({ client: null, creator: null });
  // What each entry of overlayImages was loaded from, so a re-render does not
  // reload artwork that has not changed. Kept in a ref: reading the state here
  // would capture a stale map every time the effect re-runs.
  const overlaySourcesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const decodeLogo = (source: string) =>
      new Promise<HTMLImageElement | null>((resolve) => {
        if (!source) {
          resolve(null);
          return;
        }
        const image = new window.Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = source;
      });

    void Promise.all([
      decodeLogo(watermark.client_logo),
      decodeLogo(watermark.creator_logo),
    ]).then(([client, creator]) => {
      if (!cancelled) setBatLogoImages({ client, creator });
    });

    return () => {
      cancelled = true;
    };
  }, [watermark.client_logo, watermark.creator_logo]);

  useEffect(() => {
    if (!planOverlays || planOverlays.length === 0) {
      overlaySourcesRef.current = {};
      setOverlayImages((previous) => (Object.keys(previous).length ? {} : previous));
      return;
    }

    const live = new Set(planOverlays.map((overlay) => overlay.tempId));

    planOverlays.forEach((overlay) => {
      if (!overlay.url || overlaySourcesRef.current[overlay.tempId] === overlay.url) return;
      overlaySourcesRef.current[overlay.tempId] = overlay.url;
      const img = new Image();
      img.crossOrigin = imageCrossOrigin(overlay.url);
      // A cleaned or cropped plan is a multi-megabyte data URL and takes a
      // moment to decode. The load is deliberately not cancelled when the list
      // changes meanwhile — dropping it would leave the plan showing its old
      // artwork for good, since its source is already recorded as loaded.
      // What matters is only that it is still the artwork this plan wants.
      img.onload = () => {
        if (overlaySourcesRef.current[overlay.tempId] !== overlay.url) return;
        setOverlayImages((prev) => ({ ...prev, [overlay.tempId]: img }));
      };
      img.onerror = () => {
        if (overlaySourcesRef.current[overlay.tempId] === overlay.url) {
          // Let a later render try again rather than freeze on a failed load.
          delete overlaySourcesRef.current[overlay.tempId];
        }
      };
      img.src = overlay.url;
    });

    // Drop the artwork of overlays that were removed.
    Object.keys(overlaySourcesRef.current).forEach((tempId) => {
      if (!live.has(tempId)) delete overlaySourcesRef.current[tempId];
    });
    setOverlayImages((prev) => {
      const stale = Object.keys(prev).filter((tempId) => !live.has(tempId));
      if (!stale.length) return prev;
      const next = { ...prev };
      stale.forEach((tempId) => delete next[tempId]);
      return next;
    });
  }, [planOverlays]);
  const [imageSize, setImageSize] = useState({ width: 800, height: 600 });
  // Width/height equal to zero is the persisted marker for "natural size".
  // As soon as the user manipulates the plan, the resolved dimensions are sent
  // back to the page and become part of the project save/history.
  const mainPlanTransform: CanvasPlanTransform = {
    x: storedMainPlanTransform.x,
    y: storedMainPlanTransform.y,
    width: storedMainPlanTransform.width > 0 ? storedMainPlanTransform.width : imageSize.width,
    height: storedMainPlanTransform.height > 0 ? storedMainPlanTransform.height : imageSize.height,
  };
  const setMainPlanTransform = (
    update: CanvasPlanTransform | ((previous: CanvasPlanTransform) => CanvasPlanTransform)
  ) => {
    onMainPlanTransformChange(
      typeof update === "function" ? update(mainPlanTransform) : update
    );
  };

  const isPlanCurrentlyDeformed = useMemo(() => {
    if (!bgImage) return false;
    const naturalW = bgImage.naturalWidth || bgImage.width;
    const naturalH = bgImage.naturalHeight || bgImage.height;
    if (!naturalW || !naturalH || !mainPlanTransform.width || !mainPlanTransform.height) return false;
    const naturalRatio = naturalW / naturalH;
    const currentRatio = mainPlanTransform.width / mainPlanTransform.height;
    return Math.abs(currentRatio / naturalRatio - 1) > 0.015;
  }, [bgImage, mainPlanTransform.width, mainPlanTransform.height]);

  useEffect(() => {
    onPlanDeformedChange?.(isPlanCurrentlyDeformed);
  }, [isPlanCurrentlyDeformed, onPlanDeformedChange]);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [iconImages, setIconImages] = useState<Record<string, HTMLImageElement>>({});
  // Recoloured pictograms, keyed 'type|#rrggbb'. Separate from the preloaded
  // library above: only the combinations a plan actually uses are built, and an
  // uploaded SVG has to be fetched before it can be repainted.
  const [recoloredIconImages, setRecoloredIconImages] = useState<Record<string, HTMLImageElement>>({});
  // Pictograms on the printed sheet and on the plan use the same SVG artwork.
  // The editor page also preloads the sheet subset, but that cache
  // can still be empty just after a paste (notably for uploaded pictograms).
  // Reuse this canvas-wide cache as the reliable fallback so the copied block
  // never degrades to an almost transparent placeholder rectangle.
  const resolvedSheetPictoImages = React.useMemo(
    () => ({ ...sheetPictoImages, ...iconImages }),
    [iconImages, sheetPictoImages]
  );
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
  const activeVectorEraseStrokeRef = useRef<ShapePoint[] | null>(null);
  const [draftPolygonPoints, setDraftPolygonPoints] = useState<ShapePoint[]>([]);
  const draftPolygonPointsRef = useRef<ShapePoint[]>([]);
  const draftStraightSegmentsRef = useRef<number[]>([]);
  const restoringDraftRef = useRef<boolean>(false);
  const [polygonCursor, setPolygonCursor] = useState<ShapePoint | null>(null);
  const [smartAlignment, setSmartAlignment] = useState<
    (SmartAlignmentResult & { space: "plan" | "sheet" }) | null
  >(null);
  const shiftPressedRef = useRef(false);
  const [shiftPressed, setShiftPressed] = useState(false);
  const removeLastPolygonPoint = useCallback(() => {
    if (!draftPolygonPointsRef.current.length) return false;
    const nextPoints = draftPolygonPointsRef.current.slice(0, -1);
    draftPolygonPointsRef.current = nextPoints;
    draftStraightSegmentsRef.current = draftStraightSegmentsRef.current.filter(
      (segmentIndex) => segmentIndex < nextPoints.length - 1
    );
    setDraftPolygonPoints(nextPoints);
    setSmartAlignment(null);
    return true;
  }, []);
  // Held in a ref so the callback identity never re-runs the effects below.
  const onEraseStrokesChangeRef = useRef(onEraseStrokesChange);
  useEffect(() => {
    onEraseStrokesChangeRef.current = onEraseStrokesChange;
  });

  useEffect(() => {
    const handleShiftDown = (event: KeyboardEvent) => {
      if (event.key !== "Shift") return;
      shiftPressedRef.current = true;
      setShiftPressed(true);
    };
    const handleShiftUp = (event: KeyboardEvent) => {
      if (event.key !== "Shift") return;
      shiftPressedRef.current = false;
      setShiftPressed(false);
    };
    const resetShift = () => {
      shiftPressedRef.current = false;
      setShiftPressed(false);
    };
    window.addEventListener("keydown", handleShiftDown);
    window.addEventListener("keyup", handleShiftUp);
    window.addEventListener("blur", resetShift);
    return () => {
      window.removeEventListener("keydown", handleShiftDown);
      window.removeEventListener("keyup", handleShiftUp);
      window.removeEventListener("blur", resetShift);
    };
  }, []);

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
  const [draftShapeSpace, setDraftShapeSpace] = useState<"plan" | "sheet">("plan");
  const draftShapeSpaceRef = useRef<"plan" | "sheet">("plan");
  const draftPolygonSpaceRef = useRef<"plan" | "sheet">("plan");
  const [vectorEraserCursor, setVectorEraserCursor] = useState<ShapePoint | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const marqueeRectRef = useRef<typeof marqueeRect>(null);
  const marqueeOriginRef = useRef<ShapePoint | null>(null);

  const setMarquee = (rect: typeof marqueeRect) => {
    marqueeRectRef.current = rect;
    setMarqueeRect(rect);
  };

  const translateContent = (
    dx: number,
    dy: number,
    selection?: CanvasMultiSelection,
    objectGroupId?: string
  ) => {
    if (!dx && !dy) return;
    const iconIds = new Set(selection?.iconIds || []);
    const shapeIds = new Set(selection?.shapeIds || []);
    const textIds = new Set(selection?.textIds || []);
    const selectedById = Boolean(selection);

    onIconsChange(
      icons.map((icon) => {
        const matches = selectedById
          ? iconIds.has(icon.tempId)
          : Boolean(objectGroupId && icon.object_group_id === objectGroupId);
        if (!matches || icon.locked) return icon;
        return {
          ...icon,
          x: icon.x + dx,
          y: icon.y + dy,
          leader_points: canvasIconLeaderPoints(icon).map((point) => ({
            ...point,
            x: point.x + dx,
            y: point.y + dy,
          })),
          anchor_x: icon.anchor_x != null ? icon.anchor_x + dx : icon.anchor_x,
          anchor_y: icon.anchor_y != null ? icon.anchor_y + dy : icon.anchor_y,
        };
      })
    );
    onShapesChange?.(
      shapes.map((shape) => {
        const matches = selectedById
          ? shapeIds.has(shape.tempId)
          : Boolean(objectGroupId && shape.object_group_id === objectGroupId);
        if (!matches || shape.locked) return shape;
        return {
          ...shape,
          x: shape.x + dx,
          y: shape.y + dy,
          points: shape.points?.map((point) => ({ x: point.x + dx, y: point.y + dy })) ?? shape.points,
          control_points: shape.control_points
            ? Object.fromEntries(
                Object.entries(shape.control_points).map(([key, point]) => [
                  Number(key),
                  { x: point.x + dx, y: point.y + dy },
                ])
              )
            : shape.control_points,
        };
      })
    );
    onTextsChange?.(
      texts.map((text) => {
        const matches = selectedById
          ? textIds.has(text.tempId)
          : Boolean(objectGroupId && text.object_group_id === objectGroupId);
        return matches && !text.locked ? { ...text, x: text.x + dx, y: text.y + dy } : text;
      })
    );
  };

  const moveObjectGroup = (objectGroupId: string | undefined, dx: number, dy: number) => {
    if (!objectGroupId) return false;
    translateContent(dx, dy, undefined, objectGroupId);
    return true;
  };

  const setDraft = (shape: CanvasShape | null) => {
    draftShapeRef.current = shape;
    setDraftShape(shape);
  };

  const makeShapeTempId = () =>
    `shape-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const nextLayerZIndex = () => Math.max(
    mainPlanZIndex,
    ...planOverlays.map((overlay) => overlay.z_index ?? 100),
    ...shapes.map((shape) => shape.z_index ?? 200),
    ...icons.map((icon) => icon.z_index ?? 300),
    ...texts.map((text) => text.z_index ?? 400),
  ) + 10;

  /**
   * The first point decides where a drawing lives. Once drawing has started we
   * keep using that coordinate space, so a path can cross the plan frame
   * without jumping between plan and sheet coordinates.
   */
  const pointerForNewDrawing = (stage: any): { point: ShapePoint; space: "plan" | "sheet" } | null => {
    if (sheet) {
      const sheetPoint = pointerInSheetCoords(stage);
      if (sheetPoint && !isInsidePlanWindow(sheetPoint)) {
        return sheetEditingEnabled && onPlaceSheetShape
          ? { point: sheetPoint, space: "sheet" }
          : null;
      }
    }
    const planPoint = sheet
      ? (pointerInSceneCoords(stage) ?? pointerInPlanCoords(stage))
      : pointerInPlanCoords(stage);
    return planPoint ? { point: planPoint, space: "plan" } : null;
  };

  const pointerForDrawingSpace = (stage: any, space: "plan" | "sheet") =>
    space === "sheet"
      ? pointerInSheetCoords(stage)
      : (sheet ? (pointerInSceneCoords(stage) ?? pointerInPlanCoords(stage)) : pointerInPlanCoords(stage));

  const beginShape = (stage: any) => {
    if (!shapeTool || isPolygonTool(shapeTool)) return;
    const drawing = pointerForNewDrawing(stage);
    if (!drawing) return;
    const { point, space } = drawing;

    draftShapeSpaceRef.current = space;
    setDraftShapeSpace(space);
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
      color: shapeColor,
      ...(shapeTool === "zone" ? { fill_color: shapeColor, fill_opacity: 0.28 } : {}),
      visible: true,
      z_index: nextLayerZIndex(),
    });
  };

  const extendShape = (stage: any) => {
    const origin = draftOriginRef.current;
    const current = draftShapeRef.current;
    if (!origin || !current || !shapeTool) return;

    const point = pointerForDrawingSpace(stage, draftShapeSpaceRef.current);
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
    const minSize = isLine ? 2 : 4;
    if (Math.abs(draft.width) < minSize && Math.abs(draft.height) < minSize) {
      setDraft(null);
      return;
    }

    if (draftShapeSpaceRef.current === "sheet" && onPlaceSheetShape) {
      onPlaceSheetShape(draft);
    } else {
      onShapesChange?.([...shapes, draft]);
      onSelectShape?.(draft.tempId);
    }
    setDraft(null);
    draftShapeSpaceRef.current = "plan";
    setDraftShapeSpace("plan");
    onFinishShapeTool?.();
  };

  const resetPolygonDraft = () => {
    draftPolygonPointsRef.current = [];
    draftStraightSegmentsRef.current = [];
    setDraftPolygonPoints([]);
    setPolygonCursor(null);
    setSmartAlignment(null);
    draftPolygonSpaceRef.current = "plan";
    setDraftShapeSpace("plan");
  };

  const storePolygonDraft = (options: { closeCurve?: boolean; forceOpen?: boolean } = {}) => {
    const isOpenPolyline = shapeTool === "polyline";
    const closed = options.forceOpen
      ? false
      : !isOpenPolyline && (shapeTool !== "curve_polygon_zone" || options.closeCurve);
    const points = draftPolygonPointsRef.current;
    const minimumPoints = options.forceOpen ? 2 : isOpenPolyline ? 2 : 3;
    if (!isPolygonTool(shapeTool) || points.length < minimumPoints) return false;

    const bounds = boundsFromPoints(points);
    const draft: CanvasShape = {
      tempId: makeShapeTempId(),
      shape_type: (shapeTool || "polygon_zone") as ShapeKind,
      points: points.map((point) => ({ ...point })),
      ...bounds,
      rotation: 0,
      stroke_width: shapeStrokeWidth,
      color: shapeColor,
      closed,
      straight_segments: shapeTool === "curve_polygon_zone"
        ? [...draftStraightSegmentsRef.current]
        : [],
      visible: true,
      z_index: nextLayerZIndex(),
      ...(!closed
        ? { fill_color: null, fill_opacity: 0, tension: 0 }
        : { fill_color: shapeColor, fill_opacity: 0.35 })
    };

    if (shapeTool === "curve_polygon_zone") draft.tension = 0;

    if (draftPolygonSpaceRef.current === "sheet" && onPlaceSheetShape) {
      onPlaceSheetShape(draft);
    } else {
      onShapesChange?.([...shapes, draft]);
      onSelectShape?.(draft.tempId);
    }
    resetPolygonDraft();
    return true;
  };

  const finishPolygonDraft = (closeCurve: boolean = false) => {
    storePolygonDraft({ closeCurve });
    // Point-by-point tools stay armed after a path is completed so the next
    // click immediately starts another path. The toolbar button still exits it.
  };

  const commitActiveDrawing = () => storePolygonDraft({ forceOpen: true });

  const restorePolygonDraft = (shape: CanvasShape) => {
    if (!shape.points || shape.points.length === 0) return false;
    restoringDraftRef.current = true;
    const clonedPoints = shape.points.map((point) => ({ ...point }));
    draftPolygonPointsRef.current = clonedPoints;
    draftStraightSegmentsRef.current = shape.straight_segments ? [...shape.straight_segments] : [];
    draftPolygonSpaceRef.current = "plan";
    setDraftShapeSpace("plan");
    setDraftPolygonPoints(clonedPoints);
    setPolygonCursor(null);
    setSmartAlignment(null);
    return true;
  };

  useImperativeHandle(
    canvasRef,
    () => ({
      getStage: () => stageRef.current,
      getEditedBackground: () => editedBackground,
      getBackgroundDimensions: () => ({
        width: bgImage?.naturalWidth || bgImage?.width || 0,
        height: bgImage?.naturalHeight || bgImage?.height || 0,
      }),
      getBackgroundDataUrl: () => {
        if (editedBackground) return editedBackground.toDataURL("image/png");
        if (!bgImage) return null;
        if (bgImage.src.startsWith("data:image/")) return bgImage.src;
        const canvas = document.createElement("canvas");
        canvas.width = bgImage.naturalWidth || bgImage.width;
        canvas.height = bgImage.naturalHeight || bgImage.height;
        const context = canvas.getContext("2d");
        if (!context) return null;
        context.drawImage(bgImage, 0, 0);
        try {
          const dataUrl = canvas.toDataURL("image/png");
          canvas.width = 0;
          canvas.height = 0;
          return dataUrl;
        } catch {
          canvas.width = 0;
          canvas.height = 0;
          return null;
        }
      },
      undoActiveDrawing: removeLastPolygonPoint,
      commitActiveDrawing,
      cancelActiveDrawing: () => {
        draftOriginRef.current = null;
        setDraft(null);
        resetPolygonDraft();
      },
      restorePolygonDraft,
      restoreMainPlanRatio: () => {
        if (!bgImage) return false;
        const naturalW = bgImage.naturalWidth || bgImage.width;
        const naturalH = bgImage.naturalHeight || bgImage.height;
        if (!naturalW || !naturalH || !mainPlanTransform.width || !mainPlanTransform.height) return false;

        const naturalRatio = naturalW / naturalH;
        const currentRatio = mainPlanTransform.width / mainPlanTransform.height;
        if (Math.abs(currentRatio / naturalRatio - 1) < 0.005) return false;

        const targetHeight = Math.max(50, Math.round(mainPlanTransform.width / naturalRatio));
        const scaleY = targetHeight / mainPlanTransform.height;

        setMainPlanTransform((prev) => ({
          ...prev,
          height: targetHeight
        }));

        moveMainPlanContent({
          dx: 0,
          dy: 0,
          scaleX: 1,
          scaleY,
          originX: mainPlanTransform.x,
          originY: mainPlanTransform.y
        });
        return true;
      },
      isMainPlanDeformed: () => isPlanCurrentlyDeformed,
      getPlanDistanceInSheetUnits: (planDistance: number) => {
        const placement = stageRef.current?.findOne(".planPlacement");
        if (!placement || !Number.isFinite(planDistance) || planDistance <= 0) return null;
        return planDistance * Math.abs(placement.scaleX());
      },
      getVisiblePlanPolygon: () => {
        const stage = stageRef.current;
        const layer = layerRef.current || stage?.findOne("Layer");
        const scene = stage?.findOne(".planScene");
        const placement = stage?.findOne(".planPlacement");
        const block = sheet ? findPlanBlock(sheet.blocks) : null;
        if (!stage || !layer || !block || block.visible === false) return null;
        const targetNode = scene || placement;
        if (!targetNode) return null;
        const layerTransform = layer.getAbsoluteTransform();
        const inverseTransform = targetNode.getAbsoluteTransform().copy().invert();
        return [
          { x: block.x, y: block.y },
          { x: block.x + block.width, y: block.y },
          { x: block.x + block.width, y: block.y + block.height },
          { x: block.x, y: block.y + block.height },
        ].map((corner) => inverseTransform.point(layerTransform.point(corner)));
      },
    }),
    [editedBackground, bgImage, removeLastPolygonPoint, commitActiveDrawing, sheet, mainPlanTransform, isPlanCurrentlyDeformed]
  );

  const constrainPolygonPoint = (point: ShapePoint, shiftPressed: boolean): ShapePoint => {
    const currentPoints = draftPolygonPointsRef.current;
    const previousPoint = currentPoints[currentPoints.length - 1];
    const supportsOrthogonalConstraint = shapeTool === "polyline" || shapeTool === "curve_polygon_zone";
    const straightRequested = shiftPressed || shiftPressedRef.current;
    if (!supportsOrthogonalConstraint || !straightRequested || !previousPoint) return point;
    return snapPolylinePointToOrthogonal(previousPoint, point);
  };

  /** Anchors that a pen point may align to in the active drawing space. */
  const polygonAlignmentReferences = (space: "plan" | "sheet"): ShapePoint[] => {
    const draftReferences = draftPolygonPointsRef.current.map((point) => ({ ...point }));

    if (space === "sheet") {
      const sheetReferences = (sheet?.blocks ?? []).flatMap((block): ShapePoint[] => {
        if (block.kind !== "shape" || block.visible === false) return [];
        const origin = { x: block.x, y: block.y };
        if (block.shapePoints?.length) {
          return block.shapePoints.map((point) => rotateShapeOffset(
            origin,
            { x: point.x * block.width, y: point.y * block.height },
            block.rotation
          ));
        }
        if (block.shapeType === "line") {
          return [
            origin,
            rotateShapeOffset(origin, { x: block.width, y: block.height }, block.rotation),
          ];
        }
        return [];
      });
      return [...draftReferences, ...sheetReferences];
    }

    const planReferences = shapes.flatMap((shape): ShapePoint[] => {
      if (shape.visible === false) return [];
      if (shape.points?.length) return shape.points.map((point) => ({ ...point }));
      if (shape.shape_type === "line") {
        const origin = { x: shape.x, y: shape.y };
        return [
          origin,
          rotateShapeOffset(origin, { x: shape.width, y: shape.height }, shape.rotation),
        ];
      }
      return [];
    });
    return [...draftReferences, ...planReferences];
  };

  const resolvePolygonPoint = (
    rawPoint: ShapePoint,
    shiftPressed: boolean,
    space: "plan" | "sheet"
  ): ShapePoint => {
    // Shift first chooses the strict 0°/90° direction. Smart guides then align
    // the free axis to an existing anchor without undoing that constraint.
    const constrainedPoint = constrainPolygonPoint(rawPoint, shiftPressed);
    const nestedPlanScale = space === "plan" && sheet ? planTransform.scale : 1;
    const tolerance = 8 / Math.max(zoom * nestedPlanScale, 0.05);
    const match = snapPointToAlignmentGuides(
      constrainedPoint,
      polygonAlignmentReferences(space),
      tolerance
    );
    setSmartAlignment(
      match.verticalReference || match.horizontalReference
        ? { ...match, space }
        : null
    );
    return match.point;
  };

  const addPolygonPoint = (stage: any, shiftPressed: boolean = false) => {
    const currentPoints = draftPolygonPointsRef.current;
    const drawing = currentPoints.length === 0
      ? pointerForNewDrawing(stage)
      : null;
    if (drawing) {
      draftPolygonSpaceRef.current = drawing.space;
      setDraftShapeSpace(drawing.space);
    }
    const rawPoint = drawing?.point ?? pointerForDrawingSpace(stage, draftPolygonSpaceRef.current);
    if (!rawPoint) return;
    const isShiftClick = Boolean(shiftPressed || shiftPressedRef.current);
    const point = resolvePolygonPoint(rawPoint, shiftPressed, drawing?.space ?? draftPolygonSpaceRef.current);
    const minimumFinishPoints = shapeTool === "polyline" ? 2 : 3;

    // 1. Closing the polygon loop by clicking on the first point
    if (shapeTool !== "polyline" && currentPoints.length >= 3) {
      const first = currentPoints[0];
      const distanceToFirst = Math.hypot(rawPoint.x - first.x, rawPoint.y - first.y);
      if (distanceToFirst < 15 / zoom) {
        if (shapeTool === "curve_polygon_zone" && isShiftClick) {
          draftStraightSegmentsRef.current = Array.from(new Set([
            ...draftStraightSegmentsRef.current,
            currentPoints.length - 1,
          ]));
        }
        finishPolygonDraft(true);
        return;
      }
    }

    // 2. Shift + Click gesture: user specifically requested Shift + Click to finish the drawing
    if (isShiftClick && currentPoints.length >= minimumFinishPoints) {
      const last = currentPoints[currentPoints.length - 1];
      const distanceToLast = Math.hypot(rawPoint.x - last.x, rawPoint.y - last.y);
      if (distanceToLast >= 5 / zoom) {
        const nextPoints = [...currentPoints, { x: point.x, y: point.y }];
        draftPolygonPointsRef.current = nextPoints;
        setDraftPolygonPoints(nextPoints);
      }
      finishPolygonDraft(false);
      return;
    }

    // 3. Ignore accidental duplicate click at the exact same location (prevents unwanted points on fast double clicks)
    if (currentPoints.length > 0) {
      const last = currentPoints[currentPoints.length - 1];
      const distanceToLast = Math.hypot(rawPoint.x - last.x, rawPoint.y - last.y);
      if (distanceToLast < 4 / zoom) {
        return;
      }
    }

    if (shapeTool === "curve_polygon_zone" && isShiftClick && currentPoints.length > 0) {
      draftStraightSegmentsRef.current = Array.from(new Set([
        ...draftStraightSegmentsRef.current,
        currentPoints.length - 1,
      ]));
    }
    const nextPoints = [...currentPoints, { x: point.x, y: point.y }];
    draftPolygonPointsRef.current = nextPoints;
    setDraftPolygonPoints(nextPoints);
  };

  const updatePolygonCursor = (stage: any, shiftPressed: boolean = false) => {
    const drawing = draftPolygonPointsRef.current.length
      ? null
      : pointerForNewDrawing(stage);
    const space = drawing?.space ?? draftPolygonSpaceRef.current;
    const rawPoint = drawing?.point ?? pointerForDrawingSpace(stage, space);
    if (!rawPoint) return;
    setPolygonCursor(resolvePolygonPoint(rawPoint, shiftPressed, space));
  };

  const movePolygonPoints = (tempId: string, deltaX: number, deltaY: number) => {
    const shape = shapes.find((item) => item.tempId === tempId);
    if (!shape?.points?.length) return;
    if (moveObjectGroup(shape.object_group_id, deltaX, deltaY)) return;

    const movedPoints = shape.points.map((point) => ({
      x: point.x + deltaX,
      y: point.y + deltaY
    }));

    let movedControlPoints: Record<number, ShapePoint> | undefined = undefined;
    if (shape.control_points) {
      movedControlPoints = {};
      Object.entries(shape.control_points).forEach(([key, cp]) => {
        movedControlPoints![Number(key)] = {
          x: cp.x + deltaX,
          y: cp.y + deltaY
        };
      });
    }

    updateShape(tempId, {
      points: movedPoints,
      control_points: movedControlPoints,
      ...boundsFromPoints(movedPoints)
    });
  };

  const updatePolygonVertex = (tempId: string, index: number, x: number, y: number) => {
    const shape = shapes.find((item) => item.tempId === tempId);
    if (!shape?.points?.length) return;

    const nextPoints = shape.points.map((point, pointIndex) =>
      pointIndex === index ? { x, y } : point
    );

    updateShape(tempId, {
      points: nextPoints,
      ...boundsFromPoints(nextPoints)
    });
  };

  const deletePolygonVertex = (tempId: string, index: number) => {
    const shape = shapes.find((item) => item.tempId === tempId);
    if (!shape || shape.locked) return;
    const updatedShape = shapeWithoutPoint(shape, index);
    if (!updatedShape) return;
    onShapesChange?.(shapes.map((item) => item.tempId === tempId ? updatedShape : item));
  };

  const updatePolygonControlPoint = (tempId: string, segmentIndex: number, x: number | null, y: number | null) => {
    const shape = shapes.find((item) => item.tempId === tempId);
    if (!shape) return;

    const nextControlPoints = { ...(shape.control_points || {}) };
    if (x === null || y === null) {
      delete nextControlPoints[segmentIndex];
    } else {
      nextControlPoints[segmentIndex] = { x, y };
    }

    updateShape(tempId, {
      control_points: nextControlPoints,
      straight_segments: x === null || y === null
        ? shape.straight_segments
        : (shape.straight_segments || []).filter((index) => index !== segmentIndex),
    });
  };

  const renderPolygonCurveHandles = (shape: CanvasShape, isSelected: boolean) => {
    if (!isSelected || !shape.points?.length || shape.points.length < 2 || shape.shape_type !== "curve_polygon_zone") return null;

    const inverseZoom = 1 / Math.max(zoom, 0.05);
    const handleRadius = 5 * inverseZoom;
    const points = shape.points;
    const count = points.length;
    const closed = shape.closed ?? true;
    const segmentCount = closed ? count : count - 1;

    return points.slice(0, segmentCount).map((p1, index) => {
      const p2 = closed ? points[(index + 1) % count] : points[index + 1];
      const cp = shape.control_points?.[index];

      const hx = cp ? cp.x : (p1.x + p2.x) / 2;
      const hy = cp ? cp.y : (p1.y + p2.y) / 2;

      return (
        <Group key={`${shape.tempId}-curve-handle-${index}`}>
          {cp && (
            <Line
              points={[p1.x, p1.y, cp.x, cp.y, p2.x, p2.y]}
              stroke="#f59e0b"
              strokeWidth={1}
              strokeScaleEnabled={false}
              dash={[3 * inverseZoom, 3 * inverseZoom]}
              listening={false}
            />
          )}
          <Circle
            x={hx}
            y={hy}
            radius={handleRadius}
            fill={cp ? "#f59e0b" : "#38bdf8"}
            stroke="#ffffff"
            strokeWidth={1.5}
            strokeScaleEnabled={false}
            shadowColor="#000000"
            shadowBlur={3 * inverseZoom}
            shadowOpacity={0.3}
            draggable={mode === "select" && !shapeTool && !shape.locked}
            onMouseEnter={(e: any) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "pointer";
            }}
            onMouseLeave={(e: any) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "default";
            }}
            onMouseDown={(e: any) => {
              e.cancelBubble = true;
            }}
            onTouchStart={(e: any) => {
              e.cancelBubble = true;
            }}
            onDblClick={(e: any) => {
              e.cancelBubble = true;
              if (shape.locked) return;
              updatePolygonControlPoint(shape.tempId, index, null, null);
            }}
            onDragStart={(e: any) => {
              onDragStateChange?.(true);
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "grabbing";
            }}
            onDragMove={(e: any) => {
              updatePolygonControlPoint(shape.tempId, index, e.target.x(), e.target.y());
            }}
            onDragEnd={(e: any) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "pointer";
              updatePolygonControlPoint(shape.tempId, index, e.target.x(), e.target.y());
              onDragStateChange?.(false);
            }}
          />
        </Group>
      );
    });
  };

  const renderPolygonVertexHandles = (shape: CanvasShape, isSelected: boolean) => {
    if (!isSelected || !shape.points?.length || (shape.shape_type !== "polyline" && shape.shape_type !== "free_polygon_zone" && shape.shape_type !== "curve_polygon_zone")) return null;

    const inverseZoom = 1 / Math.max(zoom, 0.05);
    const handleRadius = 5.5 * inverseZoom;

    return shape.points.map((point, index) => (
      <Group key={`${shape.tempId}-vertex-${index}`}>
        <Circle
          x={point.x}
          y={point.y}
          radius={handleRadius}
          fill="#ffffff"
          stroke={shape.color}
          strokeWidth={2}
          strokeScaleEnabled={false}
          shadowColor="#000000"
          shadowBlur={4 * inverseZoom}
          shadowOpacity={0.3}
          draggable={mode === "select" && !shapeTool && !shape.locked}
          onMouseEnter={(e: any) => {
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = "grab";
          }}
          onMouseLeave={(e: any) => {
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = "default";
          }}
          onMouseDown={(e: any) => {
            e.cancelBubble = true;
          }}
          onTouchStart={(e: any) => {
            e.cancelBubble = true;
          }}
          onDblClick={(e: any) => {
            e.cancelBubble = true;
            deletePolygonVertex(shape.tempId, index);
          }}
          onDragStart={(e: any) => {
            onDragStateChange?.(true);
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = "grabbing";
          }}
          onDragMove={(e: any) => {
            updatePolygonVertex(shape.tempId, index, e.target.x(), e.target.y());
          }}
          onDragEnd={(e: any) => {
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = "grab";
            updatePolygonVertex(shape.tempId, index, e.target.x(), e.target.y());
            onDragStateChange?.(false);
          }}
        />
      </Group>
    ));
  };

  const renderPolygonZone = (
    shape: CanvasShape,
    options: {
      isDraft?: boolean;
      isSelected?: boolean;
      previewPoint?: ShapePoint | null;
    } = {}
  ) => {
    const points = options.isDraft
      ? draftPolygonPoints
      : shape.points || [];

    if (points.length === 0) return null;

    const flatPoints = pointsToFlat(points);
    const previewPoints =
      options.isDraft && options.previewPoint
        ? [...flatPoints, options.previewPoint.x, options.previewPoint.y]
        : flatPoints;

    const isOpenPath = shape.shape_type === "polyline" || shape.closed === false;
    const closed = !isOpenPath && !options.isDraft && points.length >= 3;
    const canFill = closed;
    const fillColor = shape.fill_color || undefined;
    const baseOpacity = shape.fill_opacity !== undefined ? shape.fill_opacity : 0.35;
    const fillOpacity = (shape.fill_color === null || shape.fill_color === undefined) ? 0 : baseOpacity;
    const hasStroke = shape.stroke_width > 0;

    const usesCurvePath = !options.isDraft && shape.shape_type === "curve_polygon_zone";
    const svgPathData = usesCurvePath
      ? buildCurvePathData(points, {
          closed,
          // A curve-zone segment only bends after its cyan handle is moved.
          tension: 0,
          controlPoints: shape.control_points,
          straightSegments: shape.straight_segments,
        })
      : "";

    return (
      <Group
        key={options.isDraft ? "draft-polygon-zone" : shape.tempId}
        name={options.isDraft ? "editorUiOverlay" : editorLayerNodeName(shape.tempId)}
      >
        {canFill && fillColor && fillOpacity > 0 && (
          usesCurvePath ? (
            <Path
              data={svgPathData}
              fill={fillColor}
              opacity={fillOpacity}
              globalCompositeOperation={shouldMultiplyFill(fillColor) ? "multiply" : undefined}
              listening={false}
            />
          ) : (
            <Line
              points={flatPoints}
              closed
              tension={shape.tension || 0}
              fill={fillColor}
              opacity={fillOpacity}
              globalCompositeOperation={shouldMultiplyFill(fillColor) ? "multiply" : undefined}
              listening={false}
            />
          )
        )}
        {usesCurvePath ? (
          <Path
            id={options.isDraft ? undefined : shape.tempId}
            name={options.isDraft ? "draft-polygon-zone" : shape.tempId}
            data={svgPathData}
            stroke={hasStroke ? shape.color : undefined}
            strokeWidth={shape.stroke_width}
            strokeScaleEnabled={false}
            lineJoin="round"
            lineCap="round"
            hitStrokeWidth={shapeHitStrokeWidth(shape.stroke_width, zoom)}
            listening={!areaSelectionMode && (!sheet || !shape.locked)}
            draggable={!areaSelectionMode && !sheet && !options.isDraft && mode === "select" && !shapeTool && options.isSelected && !shape.locked}
            onClick={(e) => {
              if (options.isDraft || (sheet && shape.locked)) return;
              const isMulti = Boolean(e?.evt?.shiftKey || e?.evt?.ctrlKey || e?.evt?.metaKey);
              onSelectShape?.(shape.tempId, { shiftKey: isMulti });
            }}
            onTap={() => !options.isDraft && !(sheet && shape.locked) && onSelectShape?.(shape.tempId)}
            onDragEnd={(e: any) => {
              if (options.isDraft) return;
              const node = e.target;
              const dx = node.x();
              const dy = node.y();
              node.position({ x: 0, y: 0 });
              if (moveObjectGroup(shape.object_group_id, dx, dy)) return;
              const multiCount = multiSelection.iconIds.length + multiSelection.shapeIds.length + multiSelection.textIds.length;
              if (multiCount > 1 && multiSelection.shapeIds.includes(shape.tempId)) {
                translateContent(dx, dy, multiSelection);
                return;
              }
              movePolygonPoints(shape.tempId, dx, dy);
            }}
          />
        ) : (
          <Line
            id={options.isDraft ? undefined : shape.tempId}
            name={options.isDraft ? "draft-polygon-zone" : shape.tempId}
            points={previewPoints}
            closed={closed}
            tension={shape.tension || 0}
            stroke={hasStroke ? shape.color : undefined}
            strokeWidth={shape.stroke_width}
            strokeScaleEnabled={false}
            dash={options.isDraft
              ? [6 / Math.max(zoom, 0.05), 4 / Math.max(zoom, 0.05)]
              : undefined}
            lineJoin="round"
            lineCap="round"
            hitStrokeWidth={shapeHitStrokeWidth(shape.stroke_width, zoom)}
            listening={!areaSelectionMode && (!sheet || !shape.locked)}
            draggable={!areaSelectionMode && !sheet && !options.isDraft && mode === "select" && !shapeTool && options.isSelected && !shape.locked}
            onClick={(e) => {
              if (options.isDraft || (sheet && shape.locked)) return;
              const isMulti = Boolean(e?.evt?.shiftKey || e?.evt?.ctrlKey || e?.evt?.metaKey);
              onSelectShape?.(shape.tempId, { shiftKey: isMulti });
            }}
            onTap={() => !options.isDraft && !(sheet && shape.locked) && onSelectShape?.(shape.tempId)}
            onDragEnd={(e: any) => {
              if (options.isDraft) return;
              const node = e.target;
              const dx = node.x();
              const dy = node.y();
              node.position({ x: 0, y: 0 });
              if (moveObjectGroup(shape.object_group_id, dx, dy)) return;
              const multiCount = multiSelection.iconIds.length + multiSelection.shapeIds.length + multiSelection.textIds.length;
              if (multiCount > 1 && multiSelection.shapeIds.includes(shape.tempId)) {
                translateContent(dx, dy, multiSelection);
                return;
              }
              movePolygonPoints(shape.tempId, dx, dy);
            }}
          />
        )}
        {(options.isDraft || options.isSelected) && points.map((point, index) => (
          <Group key={`${shape.tempId}-vertex-label-${index}`}>
            {options.isDraft && (
              <Circle
                x={point.x}
                y={point.y}
                radius={6}
                fill="#ffffff"
                stroke={shape.color}
                strokeWidth={2}
                scaleX={1 / Math.max(zoom, 0.05)}
                scaleY={1 / Math.max(zoom, 0.05)}
                strokeScaleEnabled={false}
                listening={false}
              />
            )}
            <Text
              x={point.x + 8 / Math.max(zoom, 0.05)}
              y={point.y - 15 / Math.max(zoom, 0.05)}
              text={pointLabel(index)}
              fontSize={11 / Math.max(zoom, 0.05)}
              fontStyle="bold"
              fill={shape.color}
              listening={false}
            />
          </Group>
        ))}
        {!options.isDraft && renderPolygonVertexHandles(shape, Boolean(options.isSelected))}
        {!options.isDraft && renderPolygonCurveHandles(shape, Boolean(options.isSelected))}
      </Group>
    );
  };

  const updateShape = (tempId: string, patch: Partial<CanvasShape>) => {
    onShapesChange?.(
      shapes.map((shape) => (shape.tempId === tempId ? { ...shape, ...patch } : shape))
    );
  };

  const selectMainPlan = () => {
    if (sheet) return;
    onSelectBatBlock?.(false);
    onSelectIcon(null);
    onSelectShape?.(null);
    onSelectText?.(null);
    onSelectBlock?.(null);
    onSelectOverlay?.(MAIN_PLAN_ID);
  };

  const selectPlanOverlay = (tempId: string) => {
    if (sheet) return;
    onSelectBatBlock?.(false);
    onSelectIcon(null);
    onSelectShape?.(null);
    onSelectText?.(null);
    onSelectBlock?.(null);
    onSelectOverlay?.(tempId);
  };

  /**
   * Carries everything drawn on the plan along when the plan itself is moved or
   * resized. A pictogram, a zone or a label marks a real spot in the building:
   * leaving them where they were would silently move every piece of equipment.
   */
  const moveMainPlanContent = ({
    dx,
    dy,
    scaleX,
    scaleY,
    originX,
    originY
  }: {
    dx: number;
    dy: number;
    scaleX: number;
    scaleY: number;
    originX: number;
    originY: number;
  }) => {
    if (!dx && !dy && scaleX === 1 && scaleY === 1) return;

    const mapX = (x: number) => originX + dx + (x - originX) * scaleX;
    const mapY = (y: number) => originY + dy + (y - originY) * scaleY;
    // Pictograms, labels and strokes must not be squashed, so their own size
    // follows the average of the two axes rather than each one.
    const sizeScale = (scaleX + scaleY) / 2;
    const belongsToMainPlan = (groupId?: string) =>
      !mainPlanGroupingEnabled || Boolean(mainPlanGroupId && groupId === mainPlanGroupId);

    if (icons.length) {
      onIconsChange(
        icons.map((icon) => belongsToMainPlan(icon.group_id) ? ({
            ...icon,
            x: mapX(icon.x),
            y: mapY(icon.y),
            width: icon.width * sizeScale,
            height: icon.height * sizeScale,
            leader_points: canvasIconLeaderPoints(icon).map((point) => ({
              ...point,
              x: mapX(point.x),
              y: mapY(point.y),
            })),
            anchor_x: icon.anchor_x != null ? mapX(icon.anchor_x) : icon.anchor_x,
            anchor_y: icon.anchor_y != null ? mapY(icon.anchor_y) : icon.anchor_y
          }) : icon)
      );
    }

    if (shapes.length && onShapesChange) {
      onShapesChange(
        shapes.map((shape) => (shape.is_scale_calibration || belongsToMainPlan(shape.group_id)) ? ({
            ...shape,
            x: mapX(shape.x),
            y: mapY(shape.y),
            width: shape.width * scaleX,
            height: shape.height * scaleY,
            stroke_width: shape.stroke_width * sizeScale,
            points: shape.points?.map((point) => ({ x: mapX(point.x), y: mapY(point.y) })) ?? shape.points,
            control_points: shape.control_points
              ? Object.fromEntries(
                  Object.entries(shape.control_points).map(([key, point]) => [
                    Number(key),
                    { x: mapX(point.x), y: mapY(point.y) }
                  ])
                )
              : shape.control_points
          }) : shape)
      );
    }

    if (texts.length && onTextsChange) {
      onTextsChange(
        texts.map((text) => belongsToMainPlan(text.group_id) ? ({
            ...text,
            x: mapX(text.x),
            y: mapY(text.y),
            font_size: text.font_size * sizeScale
          }) : text)
      );
    }
  };

  /**
   * Applies a secondary plan's move/resize/rotation to the annotations attached
   * to it. Positions follow the plan's local coordinate system while a
   * pictogram's own rotation is deliberately preserved: in particular, the
   * “Vous êtes ici” angle remains the source of the reading orientation.
   */
  const moveOverlayGroupedContent = (
    previous: CanvasPlanOverlay,
    next: CanvasPlanOverlay
  ) => {
    if (!previous.group_id) return;

    const scaleX = next.width / Math.max(1, previous.width);
    const scaleY = next.height / Math.max(1, previous.height);
    const sizeScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2;
    const previousRadians = (-previous.rotation * Math.PI) / 180;
    const nextRadians = (next.rotation * Math.PI) / 180;
    const rotationDelta = next.rotation - previous.rotation;
    const transformPoint = (point: ShapePoint): ShapePoint => {
      const translatedX = point.x - previous.x;
      const translatedY = point.y - previous.y;
      const localX = translatedX * Math.cos(previousRadians) - translatedY * Math.sin(previousRadians);
      const localY = translatedX * Math.sin(previousRadians) + translatedY * Math.cos(previousRadians);
      const scaledX = localX * scaleX;
      const scaledY = localY * scaleY;
      return {
        x: next.x + scaledX * Math.cos(nextRadians) - scaledY * Math.sin(nextRadians),
        y: next.y + scaledX * Math.sin(nextRadians) + scaledY * Math.cos(nextRadians),
      };
    };
    const belongs = (groupId?: string) => groupId === previous.group_id;

    if (icons.length) {
      onIconsChange(
        icons.map((icon) => {
          if (!belongs(icon.group_id)) return icon;
          const center = transformPoint({ x: icon.x + icon.width / 2, y: icon.y + icon.height / 2 });
          const width = icon.width * sizeScale;
          const height = icon.height * sizeScale;
          const anchor = icon.anchor_x != null && icon.anchor_y != null
            ? transformPoint({ x: icon.anchor_x, y: icon.anchor_y })
            : null;
          const leaderPoints = canvasIconLeaderPoints(icon).map((point) => ({
            ...point,
            ...transformPoint(point),
          }));
          return {
            ...icon,
            x: center.x - width / 2,
            y: center.y - height / 2,
            width,
            height,
            leader_points: leaderPoints,
            anchor_x: anchor?.x ?? icon.anchor_x,
            anchor_y: anchor?.y ?? icon.anchor_y,
          };
        })
      );
    }

    if (shapes.length && onShapesChange) {
      onShapesChange(
        shapes.map((shape) => {
          if (!belongs(shape.group_id)) return shape;
          const transformedPoints = shape.points?.map(transformPoint);
          if (isPolygonShape(shape.shape_type) && transformedPoints?.length) {
            return {
              ...shape,
              ...boundsFromPoints(transformedPoints),
              stroke_width: shape.stroke_width * sizeScale,
              points: transformedPoints,
              control_points: shape.control_points
                ? Object.fromEntries(
                    Object.entries(shape.control_points).map(([key, point]) => [Number(key), transformPoint(point)])
                  )
                : shape.control_points,
            };
          }
          if (shape.shape_type === "circle") {
            const center = transformPoint({
              x: shape.x + shape.width / 2,
              y: shape.y + shape.height / 2,
            });
            const width = shape.width * Math.abs(scaleX);
            const height = shape.height * Math.abs(scaleY);
            return {
              ...shape,
              x: center.x - width / 2,
              y: center.y - height / 2,
              width,
              height,
              rotation: shape.rotation + rotationDelta,
              stroke_width: shape.stroke_width * sizeScale,
            };
          }
          const origin = transformPoint({ x: shape.x, y: shape.y });
          return {
            ...shape,
            x: origin.x,
            y: origin.y,
            width: shape.width * scaleX,
            height: shape.height * scaleY,
            rotation: shape.rotation + rotationDelta,
            stroke_width: shape.stroke_width * sizeScale,
            points: transformedPoints ?? shape.points,
            control_points: shape.control_points
              ? Object.fromEntries(
                  Object.entries(shape.control_points).map(([key, point]) => [Number(key), transformPoint(point)])
                )
              : shape.control_points,
          };
        })
      );
    }

    if (texts.length && onTextsChange) {
      onTextsChange(
        texts.map((text) => {
          if (!belongs(text.group_id)) return text;
          const position = transformPoint({ x: text.x, y: text.y });
          return {
            ...text,
            x: position.x,
            y: position.y,
            font_size: text.font_size * sizeScale,
            rotation: text.rotation + rotationDelta,
          };
        })
      );
    }
  };

  // The white sheet is not the plan image: it is the plan *plus* anything placed
  // outside it. An assembly point often sits well away from the building, so the
  // sheet has to grow to hold it — and the export follows this rectangle.
  const SHEET_MARGIN = Math.max(28, canvasMargin);
  const extraPadding = Math.max(0, SHEET_MARGIN - 28);
  const contentBounds = React.useMemo(() => {
    // The plan may have been moved or resized on the canvas, so the sheet
    // follows where it actually sits, not where its image would be at rest.
    let minX = mainPlanTransform.x - extraPadding;
    let minY = mainPlanTransform.y - extraPadding;
    let maxX = mainPlanTransform.x + mainPlanTransform.width + extraPadding;
    let maxY = mainPlanTransform.y + mainPlanTransform.height + extraPadding;

    icons.filter((icon) => icon.visible !== false).forEach((icon) => {
      minX = Math.min(minX, icon.x - SHEET_MARGIN);
      minY = Math.min(minY, icon.y - SHEET_MARGIN);
      maxX = Math.max(maxX, icon.x + icon.width + SHEET_MARGIN);
      // Labels are drawn just under the icon, so leave a little more room below.
      maxY = Math.max(maxY, icon.y + icon.height + SHEET_MARGIN + (icon.label ? 18 : 0));

      canvasIconLeaderPoints(icon).forEach((point) => {
        minX = Math.min(minX, point.x - SHEET_MARGIN);
        minY = Math.min(minY, point.y - SHEET_MARGIN);
        maxX = Math.max(maxX, point.x + SHEET_MARGIN);
        maxY = Math.max(maxY, point.y + SHEET_MARGIN);
      });
    });

    shapes.filter((shape) => shape.visible !== false).forEach((shape) => {
      const pad = SHEET_MARGIN + shape.stroke_width;

      if (isPolygonShape(shape.shape_type) && shape.points?.length) {
        shape.points.forEach((point) => {
          minX = Math.min(minX, point.x - pad);
          minY = Math.min(minY, point.y - pad);
          maxX = Math.max(maxX, point.x + pad);
          maxY = Math.max(maxY, point.y + pad);
        });
        return;
      }

      // A line's width/height are signed offsets, so normalise before comparing.
      const left = Math.min(shape.x, shape.x + shape.width);
      const top = Math.min(shape.y, shape.y + shape.height);
      const right = Math.max(shape.x, shape.x + shape.width);
      const bottom = Math.max(shape.y, shape.y + shape.height);

      minX = Math.min(minX, left - pad);
      minY = Math.min(minY, top - pad);
      maxX = Math.max(maxX, right + pad);
      maxY = Math.max(maxY, bottom + pad);
    });

    texts.filter((text) => text.visible !== false).forEach((t) => {
      const fontStyle = `${t.italic ? "italic" : ""} ${t.bold ? "bold" : "normal"}`.trim() || "normal";
      const { width: w, height: h } = measureCanvasText(t.text, t.font_size, t.font_family, fontStyle);
      minX = Math.min(minX, t.x - SHEET_MARGIN);
      minY = Math.min(minY, t.y - SHEET_MARGIN);
      maxX = Math.max(maxX, t.x + w + SHEET_MARGIN);
      maxY = Math.max(maxY, t.y + h + SHEET_MARGIN);
    });

    planOverlays.filter((overlay) => overlay.visible !== false).forEach((overlay) => {
      const bounds = rotatedBoxBounds(overlay);
      minX = Math.min(minX, bounds.left - SHEET_MARGIN);
      minY = Math.min(minY, bounds.top - SHEET_MARGIN);
      maxX = Math.max(maxX, bounds.right + SHEET_MARGIN);
      maxY = Math.max(maxY, bounds.bottom + SHEET_MARGIN);
    });

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, [icons, shapes, texts, planOverlays, mainPlanTransform, SHEET_MARGIN, extraPadding]);

  const selectedContentBounds = React.useMemo(() => {
    const iconIds = new Set(multiSelection.iconIds);
    const shapeIds = new Set(multiSelection.shapeIds);
    const textIds = new Set(multiSelection.textIds);
    const boxes: Array<{ left: number; top: number; right: number; bottom: number }> = [];

    icons.filter((icon) => iconIds.has(icon.tempId)).forEach((icon) => {
      boxes.push({ left: icon.x, top: icon.y, right: icon.x + icon.width, bottom: icon.y + icon.height });
    });
    shapes.filter((shape) => shapeIds.has(shape.tempId)).forEach((shape) => {
      const bounds = isPolygonShape(shape.shape_type) && shape.points?.length
        ? boundsFromPoints(shape.points)
        : {
            x: Math.min(shape.x, shape.x + shape.width),
            y: Math.min(shape.y, shape.y + shape.height),
            width: Math.abs(shape.width),
            height: Math.abs(shape.height),
          };
      boxes.push({
        left: bounds.x,
        top: bounds.y,
        right: bounds.x + bounds.width,
        bottom: bounds.y + bounds.height,
      });
    });
    texts.filter((text) => textIds.has(text.tempId)).forEach((text) => {
      const fontStyle = `${text.italic ? "italic" : ""} ${text.bold ? "bold" : "normal"}`.trim() || "normal";
      const { width, height } = measureCanvasText(text.text, text.font_size, text.font_family, fontStyle);
      boxes.push({ left: text.x, top: text.y, right: text.x + width, bottom: text.y + height });
    });

    if (!boxes.length) return null;
    const left = Math.min(...boxes.map((box) => box.left));
    const top = Math.min(...boxes.map((box) => box.top));
    const right = Math.max(...boxes.map((box) => box.right));
    const bottom = Math.max(...boxes.map((box) => box.bottom));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }, [icons, shapes, texts, multiSelection.iconIds, multiSelection.shapeIds, multiSelection.textIds]);

  // ── Sheet mode geometry ───────────────────────────────────────────────────
  const planBlock = React.useMemo(() => (sheet ? findPlanBlock(sheet.blocks) : null), [sheet]);
  const sheetBackgroundBlock = React.useMemo(
    () => sheet?.blocks.find((block) => block.kind === "background" && block.visible) ?? null,
    [sheet]
  );

  /**
   * Where the plan sits on the sheet. The plan is fitted inside its window —
   * turned, so it is the rotated bounding box that has to fit — then the user's
   * zoom and nudge are applied on top.
   */
  const planTransform = React.useMemo(() => {
    if (!planBlock || !contentBounds.width || !contentBounds.height) {
      return { x: 0, y: 0, scale: 1 };
    }

    const radians = (planRotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const rotatedWidth = contentBounds.width * cos + contentBounds.height * sin;
    const rotatedHeight = contentBounds.width * sin + contentBounds.height * cos;

    const fit = Math.min(planBlock.width / rotatedWidth, planBlock.height / rotatedHeight);
    const scale = fit * (Math.max(10, planPlacement.scale) / 100);

    const centreX = contentBounds.x + contentBounds.width / 2;
    const centreY = contentBounds.y + contentBounds.height / 2;

    return {
      x: planBlock.x + planBlock.width / 2 - centreX * scale + planPlacement.offsetX,
      y: planBlock.y + planBlock.height / 2 - centreY * scale + planPlacement.offsetY,
      scale
    };
  }, [planBlock, contentBounds, planRotation, planPlacement]);

  const updateSheetBlock = useCallback(
    (id: string, patch: Partial<SheetBlock>) => {
      if (!sheet || !onSheetBlocksChange) return;
      const source = sheet.blocks.find((block) => block.id === id);
      const selectedIds = new Set(selectedBlockIds);
      const moveSelection = Boolean(
        source &&
        ((selectedIds.size > 1 && selectedIds.has(id)) || source.objectGroupId) &&
        (typeof patch.x === "number" || typeof patch.y === "number")
      );
      const dx = source && typeof patch.x === "number" ? patch.x - source.x : 0;
      const dy = source && typeof patch.y === "number" ? patch.y - source.y : 0;
      onSheetBlocksChange(
        sheet.blocks.map((block) => {
          if (block.id === id) return { ...block, ...patch };
          const travelsWithSource = selectedIds.has(block.id) || Boolean(
            source?.objectGroupId && block.objectGroupId === source.objectGroupId
          );
          if (moveSelection && travelsWithSource && !block.locked) {
            return { ...block, x: block.x + dx, y: block.y + dy };
          }
          return block;
        })
      );
    },
    [sheet, onSheetBlocksChange, selectedBlockIds]
  );

  const translateSheetSelection = useCallback((dx: number, dy: number) => {
    if (!sheet || !onSheetBlocksChange || (!dx && !dy)) return;
    const selectedIds = new Set(selectedBlockIds);
    onSheetBlocksChange(sheet.blocks.map((block) =>
      selectedIds.has(block.id) && !block.locked
        ? { ...block, x: block.x + dx, y: block.y + dy }
        : block
    ));
  }, [sheet, onSheetBlocksChange, selectedBlockIds]);

  const planBlockSelected = Boolean(planBlock && selectedBlockId === planBlock.id);
  const selectedCanvasPictogram = React.useMemo(
    () => selectedIconId
      ? icons.find((icon) => icon.tempId === selectedIconId) ?? null
      : null,
    [icons, selectedIconId]
  );
  const selectedSheetPictogram = React.useMemo(
    () => selectedBlockIds.length <= 1 && selectedBlockId
      ? sheet?.blocks.find((block) => block.id === selectedBlockId && block.kind === "picto") ?? null
      : null,
    [selectedBlockId, selectedBlockIds.length, sheet]
  );
  const selectedSituationFrame = Boolean(
    selectedBlockId
    && sheet?.blocks.some(
      (block) => block.id === selectedBlockId && block.situationRole === "frame",
    )
  );
  const selectedPictogramRatioLocked = selectedCanvasPictogram
    ? selectedCanvasPictogram.lock_aspect_ratio !== false
    : Boolean(selectedSheetPictogram && selectedSheetPictogram.lockAspectRatio !== false);

  const selectedSheetBounds = React.useMemo(() => {
    if (!sheet || selectedBlockIds.length < 2) return null;
    const selectedIds = new Set(selectedBlockIds);
    const blocks = sheet.blocks.filter((block) => block.visible && selectedIds.has(block.id));
    if (blocks.length < 2) return null;
    const left = Math.min(...blocks.map((block) => block.x));
    const top = Math.min(...blocks.map((block) => block.y));
    const right = Math.max(...blocks.map((block) => block.x + block.width));
    const bottom = Math.max(...blocks.map((block) => block.y + block.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }, [sheet, selectedBlockIds]);

  /** Pointer in sheet units. Blocks sit straight on the layer, so this is the
   *  stage transform — no plan placement involved. */
  const pointerInSheetCoords = (stage: any) => {
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return null;
    return stage.getAbsoluteTransform().copy().invert().point(pointer);
  };

  const isInsidePlanWindow = (point: { x: number; y: number }) =>
    Boolean(
      planBlock &&
        planBlock.visible &&
        point.x >= planBlock.x &&
        point.x <= planBlock.x + planBlock.width &&
        point.y >= planBlock.y &&
        point.y <= planBlock.y + planBlock.height
    );

  // ── In-place text editing ─────────────────────────────────────────────────
  // Double-clicking a block opens a textarea laid exactly over it, so copy is
  // typed on the sheet rather than in a side panel.
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const editingBlock = sheet ? sheet.blocks.find((block) => block.id === editingBlockId) ?? null : null;

  useEffect(() => {
    if (!sheet) setEditingBlockId(null);
  }, [sheet]);

  const editorBox = React.useMemo(() => {
    if (!editingBlock) return null;
    const titleHeight = editingBlock.title ? editingBlock.titleHeight ?? 30 : 0;
    const padding = editingBlock.padding ?? 8;
    return {
      left: (stagePos.x + (editingBlock.x + padding) * zoom),
      top: stagePos.y + (editingBlock.y + titleHeight) * zoom,
      width: Math.max(30, (editingBlock.width - padding * 2) * zoom),
      height: Math.max(24, (editingBlock.height - titleHeight) * zoom),
      fontSize: (editingBlock.fontSize ?? 14) * zoom,
      lineHeight: editingBlock.lineHeight ?? 1.3,
      align: editingBlock.align ?? "left",
      color: editingBlock.color ?? "#1a1a1a",
      bold: (editingBlock.fontStyle ?? "normal").includes("bold")
    };
  }, [editingBlock, stagePos, zoom]);

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

  /**
   * Pointer -> plan coordinates. On the sheet the plan is nested inside its
   * window and scaled to fit it, so the stage transform is no longer the one
   * that maps a click onto the plan: the placement group's is.
   */
  const pointerInPlanCoords = (stage: any) => {
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return null;
    const placement = sheet ? stage.findOne(".planPlacement") : null;
    return (placement || stage).getAbsoluteTransform().copy().invert().point(pointer);
  };

  /** Pointer in the unrotated coordinate system shared by annotations. */
  const pointerInSceneCoords = (stage: any) => {
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return null;
    const scene = stage.findOne(".planScene");
    return (scene || stage).getAbsoluteTransform().copy().invert().point(pointer);
  };

  /**
   * Starts a rubber band. Callers decide *when* it is allowed: the explicit
   * area-selection mode always may, and a plain drag on empty canvas may too,
   * so the toolbar toggle is a convenience rather than a prerequisite.
   */
  const startMarquee = (stage: any) => {
    const point = sheet ? pointerInSheetCoords(stage) : pointerInSceneCoords(stage);
    if (!point) return false;
    marqueeOriginRef.current = point;
    setMarquee({ x: point.x, y: point.y, width: 0, height: 0 });
    if (!shiftPressedRef.current) {
      onSelectIcon(null);
      onSelectShape?.(null);
      onSelectText?.(null);
      onSelectBlock?.(null);
      onSelectBlocks?.([]);
      onSelectOverlay?.(null);
      onSelectBatBlock?.(false);
      onMultiSelectionChange?.({ iconIds: [], shapeIds: [], textIds: [] });
    }
    return true;
  };

  const beginAreaSelection = (stage: any) => {
    if (!areaSelectionMode) return false;
    return startMarquee(stage);
  };

  const extendAreaSelection = (stage: any) => {
    const origin = marqueeOriginRef.current;
    if (!origin) return;
    const point = sheet ? pointerInSheetCoords(stage) : pointerInSceneCoords(stage);
    if (!point) return;
    setMarquee({
      x: Math.min(origin.x, point.x),
      y: Math.min(origin.y, point.y),
      width: Math.abs(point.x - origin.x),
      height: Math.abs(point.y - origin.y),
    });
  };

  const finishAreaSelection = () => {
    if (!marqueeOriginRef.current) return;
    const rect = marqueeRectRef.current;
    marqueeOriginRef.current = null;
    setMarquee(null);
    if (!rect || rect.width < 3 || rect.height < 3) {
      // A click that never travelled: startMarquee already cleared the
      // selection, so there is nothing to report unless the mode is armed.
      if (areaSelectionMode) onAreaSelectionComplete?.(0);
      return;
    }
    const rMinX = Math.min(rect.x, rect.x + rect.width);
    const rMaxX = Math.max(rect.x, rect.x + rect.width);
    const rMinY = Math.min(rect.y, rect.y + rect.height);
    const rMaxY = Math.max(rect.y, rect.y + rect.height);

    const boxIntersects = (bMinX: number, bMinY: number, bMaxX: number, bMaxY: number) =>
      bMinX <= rMaxX && bMaxX >= rMinX && bMinY <= rMaxY && bMaxY >= rMinY;

    if (sheet) {
      const ids = sheet.blocks
        .filter((block) =>
          block.kind !== "background" &&
          block.kind !== "plan" &&
          block.visible &&
          !block.locked &&
          boxIntersects(block.x, block.y, block.x + block.width, block.y + block.height)
        )
        .map((block) => block.id);
      const nextIds = shiftPressedRef.current
        ? Array.from(new Set([...selectedBlockIds, ...ids]))
        : ids;
      onSelectBlocks?.(nextIds);
      onAreaSelectionComplete?.(nextIds.length);
      return;
    }
    const selection: CanvasMultiSelection = {
      iconIds: icons
        .filter((icon) => icon.visible !== false && !icon.locked && boxIntersects(
          icon.x,
          icon.y,
          icon.x + icon.width,
          icon.y + icon.height
        ))
        .map((icon) => icon.tempId),
      shapeIds: shapes
        .filter((shape) => {
          if (shape.visible === false || shape.locked) return false;
          const bounds = isPolygonShape(shape.shape_type) && shape.points?.length
            ? boundsFromPoints(shape.points)
            : {
                x: Math.min(shape.x, shape.x + shape.width),
                y: Math.min(shape.y, shape.y + shape.height),
                width: Math.abs(shape.width),
                height: Math.abs(shape.height),
              };
          return boxIntersects(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height);
        })
        .map((shape) => shape.tempId),
      textIds: texts
        .filter((text) => {
          if (text.visible === false || text.locked) return false;
          const fontStyle = `${text.italic ? "italic" : ""} ${text.bold ? "bold" : "normal"}`.trim() || "normal";
          const { width, height } = measureCanvasText(text.text, text.font_size, text.font_family, fontStyle);
          return boxIntersects(text.x, text.y, text.x + Math.max(width, 20), text.y + Math.max(height, 14));
        })
        .map((text) => text.tempId),
    };
    const nextSelection: CanvasMultiSelection = shiftPressedRef.current
      ? {
          iconIds: Array.from(new Set([...multiSelection.iconIds, ...selection.iconIds])),
          shapeIds: Array.from(new Set([...multiSelection.shapeIds, ...selection.shapeIds])),
          textIds: Array.from(new Set([...multiSelection.textIds, ...selection.textIds])),
        }
      : selection;
    const count = nextSelection.iconIds.length + nextSelection.shapeIds.length + nextSelection.textIds.length;
    if (count === 1 && !shiftPressedRef.current) {
      if (nextSelection.iconIds.length === 1) {
        onSelectIcon(nextSelection.iconIds[0]);
      } else if (nextSelection.shapeIds.length === 1) {
        onSelectShape?.(nextSelection.shapeIds[0]);
      } else if (nextSelection.textIds.length === 1) {
        onSelectText?.(nextSelection.textIds[0]);
      }
      onAreaSelectionComplete?.(1);
      return;
    }
    onMultiSelectionChange?.(nextSelection);
    onAreaSelectionComplete?.(count);
  };

  /**
   * Pointer -> pixels of the plan image itself. The eraser paints onto a copy
   * of that image, so a click has to be read through the plan's own transform:
   * once the plan has been moved or resized on the canvas, its coordinates are
   * no longer the scene's. Strokes are stored at the image's natural size, so
   * they stay put whatever the plan does afterwards.
   */
  const pointerInBackgroundCoords = (stage: any) => {
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return null;

    const planNode = stage.findOne("." + MAIN_PLAN_ID);
    if (!planNode) return pointerInPlanCoords(stage);

    const local = planNode.getAbsoluteTransform().copy().invert().point(pointer);
    return {
      x: local.x * (imageSize.width / Math.max(1, mainPlanTransform.width)),
      y: local.y * (imageSize.height / Math.max(1, mainPlanTransform.height))
    };
  };

  /** Brush size in plan-image pixels, so it looks constant on screen. */
  const eraserSizeInBackground = () =>
    eraserSize * (imageSize.width / Math.max(1, mainPlanTransform.width));

  const beginEraseStroke = (stage: any) => {
    if (eraserTarget === "lines") {
      const point = pointerInSceneCoords(stage);
      if (point) activeVectorEraseStrokeRef.current = [{ x: point.x, y: point.y }];
      return;
    }

    const point = pointerInBackgroundCoords(stage);
    if (!point || !editedBackground) return;

    activeStrokeRef.current = {
      points: [point.x, point.y],
      size: eraserSizeInBackground(),
      shape: eraserShape
    };
    const context = editedBackground.getContext("2d");
    if (context) paintStroke(context, activeStrokeRef.current, canvasScale);
    layerRef.current?.batchDraw();
  };

  const extendEraseStroke = (stage: any) => {
    if (eraserTarget === "lines") {
      const stroke = activeVectorEraseStrokeRef.current;
      const point = pointerInSceneCoords(stage);
      if (!stroke || !point) return;
      const previous = stroke[stroke.length - 1];
      if (Math.hypot(point.x - previous.x, point.y - previous.y) >= Math.max(0.5, eraserSize / 8)) {
        stroke.push({ x: point.x, y: point.y });
      }
      return;
    }

    const stroke = activeStrokeRef.current;
    if (!stroke || !editedBackground) return;

    const point = pointerInBackgroundCoords(stage);
    if (!point) return;

    const previousLength = stroke.points.length;
    stroke.points.push(point.x, point.y);

    const context = editedBackground.getContext("2d");
    if (context) paintStroke(context, stroke, canvasScale, Math.max(0, previousLength - 2));
    layerRef.current?.batchDraw();
  };

  const finishEraseStroke = () => {
    if (eraserTarget === "lines") {
      const eraserStroke = activeVectorEraseStrokeRef.current;
      activeVectorEraseStrokeRef.current = null;
      if (!eraserStroke?.length || !onShapesChange) return;

      let changed = false;
      const nextShapes = shapes.flatMap((shape) => {
        if (shape.locked || shape.visible === false) return [shape];

        let sourcePoints: ShapePoint[] | null = null;
        if (shape.shape_type === "polyline" && shape.points?.length) {
          sourcePoints = shape.points;
        } else if (shape.shape_type === "line") {
          const radians = (shape.rotation * Math.PI) / 180;
          sourcePoints = [
            { x: shape.x, y: shape.y },
            {
              x: shape.x + shape.width * Math.cos(radians) - shape.height * Math.sin(radians),
              y: shape.y + shape.width * Math.sin(radians) + shape.height * Math.cos(radians),
            },
          ];
        }
        if (!sourcePoints) return [shape];

        const cut = cutPolylineByEraser(
          sourcePoints,
          eraserStroke,
          eraserSize / 2 + Math.max(0, shape.stroke_width) / 2
        );
        if (!cut.changed) return [shape];
        changed = true;

        return cut.fragments.map((points, fragmentIndex) => ({
          ...shape,
          ...(fragmentIndex === 0 ? {} : { id: undefined, tempId: makeShapeTempId() }),
          shape_type: "polyline" as ShapeKind,
          points,
          ...boundsFromPoints(points),
          rotation: 0,
          fill_color: null,
          fill_opacity: 0,
          tension: 0,
          control_points: {},
        }));
      });

      if (changed) {
        onShapesChange(nextShapes);
        if (selectedShapeId && !nextShapes.some((shape) => shape.tempId === selectedShapeId)) {
          onSelectShape?.(null);
        }
      }
      return;
    }

    if (!activeStrokeRef.current) return;
    strokesRef.current = [...strokesRef.current, activeStrokeRef.current];
    // Drawing after an undo drops the redo branch, as everywhere else.
    undoneStrokesRef.current = [];
    activeStrokeRef.current = null;
    onEraseStrokesChangeRef.current?.(strokesRef.current.length);
  };

  // Strokes removed by an undo are kept here so a redo can put them back.
  const undoneStrokesRef = useRef<typeof strokesRef.current>([]);

  const previousUndoSignalRef = useRef(undoEraseSignal);
  useEffect(() => {
    if (undoEraseSignal === previousUndoSignalRef.current) return;
    previousUndoSignalRef.current = undoEraseSignal;
    if (!strokesRef.current.length) return;

    undoneStrokesRef.current = [
      strokesRef.current[strokesRef.current.length - 1],
      ...undoneStrokesRef.current,
    ];
    strokesRef.current = strokesRef.current.slice(0, -1);
    redrawEditedBackground();
    onEraseStrokesChangeRef.current?.(strokesRef.current.length);
  });

  // Global undo/redo: replay or rewind the strokes until the count matches.
  useEffect(() => {
    if (eraseStrokeTarget == null) return;
    const wanted = eraseStrokeTarget.count;
    const current = strokesRef.current.length;
    if (wanted === current) return;

    if (wanted < current) {
      const removed = strokesRef.current.slice(wanted);
      undoneStrokesRef.current = [...removed, ...undoneStrokesRef.current];
      strokesRef.current = strokesRef.current.slice(0, wanted);
    } else {
      const missing = wanted - current;
      const restored = undoneStrokesRef.current.slice(0, missing);
      if (!restored.length) return;
      undoneStrokesRef.current = undoneStrokesRef.current.slice(restored.length);
      strokesRef.current = [...strokesRef.current, ...restored];
    }

    redrawEditedBackground();
    onEraseStrokesChangeRef.current?.(strokesRef.current.length);
  }, [eraseStrokeTarget]);

  const previousResetSignalRef = useRef(resetEraseSignal);
  useEffect(() => {
    if (resetEraseSignal === previousResetSignalRef.current) return;
    previousResetSignalRef.current = resetEraseSignal;
    if (!strokesRef.current.length) return;

    // Keep them: the global undo may ask for these strokes back.
    undoneStrokesRef.current = [...strokesRef.current, ...undoneStrokesRef.current];
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

    // In sheet mode the printed page is what has to be framed, and it never
    // turns: the plan's rotation happens inside its own window.
    const bounds = sheet
      ? { x: 0, y: 0, width: sheet.width, height: sheet.height }
      : contentBounds;
    const angle = sheet ? 0 : planRotation;

    // Fit the whole sheet, not just the plan: icons placed outside must stay in
    // view. Turned, the sheet needs its rotated bounding box or it spills over.
    const radians = (angle * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const rotatedWidth = bounds.width * cos + bounds.height * sin;
    const rotatedHeight = bounds.width * sin + bounds.height * cos;

    const scale = Math.min(width / rotatedWidth, height / rotatedHeight) * FIT_VIEWPORT_RATIO;
    const clampedScale = Math.max(0.1, Math.min(5, scale));

    // The scene pivots on the sheet's centre, so that point stays put: park it
    // in the middle of the workspace.
    const centreX = bounds.x + bounds.width / 2;
    const centreY = bounds.y + bounds.height / 2;

    setZoom(clampedScale);
    setStagePos({
      x: width / 2 - centreX * clampedScale,
      y: height / 2 - centreY * clampedScale
    });

    // This position is already correct for the new size — tell the centre-keeping
    // effect not to shift it again when it observes the resize.
    previousStageSizeRef.current = { width, height };
  }, [contentBounds, planRotation, setZoom, sheet]);

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

    if (backgroundType === "pdf") {
      let cancelled = false;
      const renderPdf = async () => {
        try {
          const pdfjsLib = await loadPdfJs();
          if (cancelled) return;
          const loadingTask = pdfjsLib.getDocument({
            url: backgroundUrl,
            withCredentials: true,
          });
          const pdf = await loadingTask.promise;
          if (cancelled) return;
          const page = await pdf.getPage(1);
          
          const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Impossible de préparer le rendu PDF.");
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          const renderContext = {
            canvas,
            canvasContext: context,
            viewport: viewport,
          };
          await page.render(renderContext).promise;

          const img = new window.Image();
          img.src = canvas.toDataURL();
          img.onload = () => {
            if (cancelled) return;
            setBgImage(img);
            setImageSize({ width: img.width / PDF_RENDER_SCALE, height: img.height / PDF_RENDER_SCALE });
          };
        } catch (err) {
          console.error("Error loading PDF background:", err);
        }
      };
      renderPdf();
      return () => {
        cancelled = true;
      };
    } else {
      const img = new window.Image();
      img.crossOrigin = imageCrossOrigin(backgroundUrl);
      img.onload = () => {
        setBgImage(img);
        setImageSize({ width: img.width, height: img.height });
      };
      img.src = backgroundUrl;
    }
  }, [backgroundUrl, backgroundType]);

  // Builds the recoloured pictograms a plan asks for, and only those. Keyed by
  // type+colour so two icons sharing a colour share one decode, and so a colour
  // that is no longer used simply stops being rebuilt.
  useEffect(() => {
    const wanted = new Map<string, { type: IconType; color: string }>();
    icons.forEach((icon) => {
      const color = normalizePictogramColorOverride(icon.color);
      if (!color) return;
      const key = `${icon.icon_type}|${color}`;
      if (!wanted.has(key)) wanted.set(key, { type: icon.icon_type, color });
    });
    sheet?.blocks.forEach((block) => {
      const color = normalizePictogramColorOverride(block.color);
      if (block.kind !== "picto" || !block.iconType || !color) return;
      const key = `${block.iconType}|${color}`;
      if (!wanted.has(key)) wanted.set(key, { type: block.iconType, color });
    });

    const missing = [...wanted.entries()].filter(([key]) => !recoloredIconImages[key]);
    if (!missing.length) return;

    let cancelled = false;
    void Promise.all(
      missing.map(async ([key, { type, color }]) => {
        const source = await buildStretchableIconSource(type, color, iconDefinitions);
        if (!source) return [key, null] as const;
        return await new Promise<readonly [string, HTMLImageElement | null]>((resolve) => {
          const image = new window.Image();
          image.crossOrigin = imageCrossOrigin(source);
          image.onload = () => resolve([key, image] as const);
          image.onerror = () => resolve([key, null] as const);
          image.src = source;
        });
      })
    ).then((entries) => {
      if (cancelled) return;
      const loaded = entries.filter((entry): entry is readonly [string, HTMLImageElement] => Boolean(entry[1]));
      if (!loaded.length) return;
      setRecoloredIconImages((previous) => ({ ...previous, ...Object.fromEntries(loaded) }));
    });

    return () => {
      cancelled = true;
    };
  }, [icons, sheet, iconDefinitions, recoloredIconImages]);

  // Cache/preload pictograms for the editable canvas. Placed artwork fills its
  // selection box, whose ratio is locked to the artwork while it is resized.
  useEffect(() => {
    const types = Object.keys(iconDefinitions) as IconType[];
    if (types.length === 0) {
      setIconImages({});
      return;
    }

    let cancelled = false;
    void Promise.all(
      types.map(async (type) => {
        const source = await buildStretchableIconSource(type, "", iconDefinitions);
        if (!source) return null;
        return await new Promise<readonly [IconType, HTMLImageElement] | null>((resolve) => {
          const image = new window.Image();
          image.crossOrigin = imageCrossOrigin(source);
          image.onload = () => resolve([type, image] as const);
          image.onerror = () => resolve(null);
          image.src = source;
        });
      })
    ).then((entries) => {
      if (cancelled) return;
      setIconImages(Object.fromEntries(entries.filter((entry): entry is readonly [IconType, HTMLImageElement] => Boolean(entry))));
    });

    return () => {
      cancelled = true;
    };
  }, [iconDefinitions]);

  useEffect(() => {
    if (restoringDraftRef.current) {
      restoringDraftRef.current = false;
      return;
    }
    if (!isPolygonTool(shapeTool)) {
      draftPolygonPointsRef.current = [];
      draftStraightSegmentsRef.current = [];
      setDraftPolygonPoints([]);
      setPolygonCursor(null);
    } else if (shapeTool !== "curve_polygon_zone") {
      draftStraightSegmentsRef.current = [];
    }
  }, [shapeTool]);

  // Konva normally follows the fixed JSX category order. Reorder the direct
  // children of planScene from the shared z-index so plans, shapes, icons and
  // texts can genuinely pass in front of one another like Illustrator layers.
  useEffect(() => {
    const scene = stageRef.current?.findOne(".planScene") as Konva.Group | undefined;
    if (!scene) return;

    const orderedItems = [
      ...(mainPlanVisible ? [{ id: MAIN_PLAN_ID, zIndex: mainPlanZIndex }] : []),
      ...planOverlays
        .filter((overlay) => overlay.visible !== false)
        .map((overlay) => ({ id: overlay.tempId, zIndex: overlay.z_index ?? 100 })),
      ...shapes
        .filter((shape) => shape.visible !== false)
        .map((shape) => ({ id: shape.tempId, zIndex: shape.z_index ?? 200 })),
      ...icons
        .filter((icon) => icon.visible !== false)
        .map((icon) => ({ id: icon.tempId, zIndex: icon.z_index ?? 300 })),
      ...texts
        .filter((text) => text.visible !== false)
        .map((text) => ({ id: text.tempId, zIndex: text.z_index ?? 400 })),
    ].sort((left, right) => left.zIndex - right.zIndex);

    orderedItems.forEach((item) => {
      scene.find(`.${editorLayerNodeName(item.id)}`).forEach((node: Konva.Node) => node.moveToTop());
    });
    // Drawing previews and selection furniture must remain usable regardless
    // of the visual order chosen for real project objects.
    scene.find(".editorUiOverlay").forEach((node: Konva.Node) => node.moveToTop());
    layerRef.current?.batchDraw();
  }, [mainPlanVisible, mainPlanZIndex, planOverlays, shapes, icons, texts]);

  // Sheet blocks use their array order as their layer order. Move every node
  // carrying the same sheet-layer name together so the plan window (backing,
  // clipped plan and border) can pass behind or in front of notices and SVGs.
  useEffect(() => {
    const layer = layerRef.current;
    if (!sheet || !layer) return;

    sheet.blocks
      .filter((block) => block.visible)
      .forEach((block) => {
        layer
          .find(`.${sheetLayerNodeName(block.id)}`)
          .forEach((node: Konva.Node) => node.moveToTop());
      });

    layer.find(".approvalLayer").forEach((node: Konva.Node) => node.moveToTop());
    layer.find(".editorUiOverlay").forEach((node: Konva.Node) => node.moveToTop());
    transformerRef.current?.moveToTop();
    layer.batchDraw();
  }, [sheet]);

  // Update Transformer nodes when selection changes
  useEffect(() => {
    if (transformerRef.current) {
      const stage = stageRef.current;
      if (!stage) return;

      // Icons, shapes and texts share the Transformer: whichever is selected gets it.
      const selectedShape = selectedShapeId
        ? shapes.find((shape) => shape.tempId === selectedShapeId)
        : null;
      const selectedIcon = selectedIconId
        ? icons.find((icon) => icon.tempId === selectedIconId)
        : null;
      const selectedText = selectedTextId
        ? texts.find((text) => text.tempId === selectedTextId)
        : null;
      const selectedOverlay = selectedOverlayId && selectedOverlayId !== MAIN_PLAN_ID
        ? planOverlays.find((overlay) => overlay.tempId === selectedOverlayId)
        : null;
      const selectedBlock = selectedBlockId
        ? sheet?.blocks.find((block) => block.id === selectedBlockId)
        : null;
      const selectedBlockHasEditablePoints = Boolean(
        selectedBlock?.kind === "shape" &&
        selectedBlock.shapePoints &&
        selectedBlock.shapePoints.length >= 2
      );
      const selectionLocked = Boolean(
        selectedIcon?.locked ||
        selectedShape?.locked ||
        selectedText?.locked ||
        selectedOverlay?.locked ||
        selectedBlock?.locked ||
        (selectedOverlayId === MAIN_PLAN_ID && mainPlanLocked) ||
        (selectedBatBlock && watermark.block_locked)
      );
      const activeId =
        selectionLocked || selectedBlockIds.length > 1 || (planReframeMode && selectedBlockId === planBlock?.id)
          ? null
          : selectedBatBlock
            ? BAT_BLOCK_ID
            : selectedIconId ||
              selectedTextId ||
              (isPolygonShape(selectedShape?.shape_type) ? null : selectedShapeId) ||
              (selectedBlockHasEditablePoints ? null : selectedBlockId) ||
              selectedOverlayId;
      if (activeId) {
        const selectedNode = stage.findOne("#" + activeId) || stage.findOne("." + activeId);
        if (selectedNode) {
          transformerRef.current.nodes([selectedNode]);
          transformerRef.current.moveToTop();
          transformerRef.current.forceUpdate();
          transformerRef.current.getLayer().batchDraw();
          return;
        }
      }
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer().batchDraw();
    }
  }, [selectedIconId, selectedShapeId, selectedTextId, selectedBlockId, selectedBlockIds, selectedOverlayId, selectedBatBlock, watermark.block_locked, watermark.block_width, watermark.block_height, watermark.enabled, icons, shapes, texts, sheet, planOverlays, mainPlanLocked, mainPlanTransform, zoom, stagePos, planRotation, planReframeMode, planBlock]);

  // Keyboard shortcut to delete the selected icon or shape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") {
        return;
      }

      if (isPolygonTool(shapeTool)) {
        if (e.key === "Enter") {
          e.preventDefault();
          finishPolygonDraft();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          resetPolygonDraft();
          return;
        }
        if (e.key === "Backspace") {
          e.preventDefault();
          removeLastPolygonPoint();
          return;
        }
      }

      if (e.key !== "Delete" && e.key !== "Backspace") return;

      if (sheet && selectedBlockIds.length > 0 && onSheetBlocksChange) {
        e.preventDefault();
        const ids = new Set(selectedBlockIds);
        onSheetBlocksChange(sheet.blocks.filter((block) =>
          !ids.has(block.id) || block.locked || block.kind === "plan" || block.kind === "background"
        ));
        onSelectBlock?.(null);
        onSelectBlocks?.([]);
        return;
      }

      const multiCount = multiSelection.iconIds.length + multiSelection.shapeIds.length + multiSelection.textIds.length;
      if (multiCount > 0) {
        const iconIds = new Set(multiSelection.iconIds);
        const shapeIds = new Set(multiSelection.shapeIds);
        const textIds = new Set(multiSelection.textIds);
        onIconsChange(icons.filter((icon) => !iconIds.has(icon.tempId) || Boolean(icon.locked)));
        onShapesChange?.(shapes.filter((shape) => !shapeIds.has(shape.tempId) || Boolean(shape.locked)));
        onTextsChange?.(texts.filter((text) => !textIds.has(text.tempId) || Boolean(text.locked)));
        onMultiSelectionChange?.({ iconIds: [], shapeIds: [], textIds: [] });
        return;
      }

      if (selectedIconId) {
        if (icons.find((icon) => icon.tempId === selectedIconId)?.locked) return;
        onIconsChange(icons.filter((icon) => icon.tempId !== selectedIconId));
        onSelectIcon(null);
      } else if (selectedShapeId) {
        if (shapes.find((shape) => shape.tempId === selectedShapeId)?.locked) return;
        onShapesChange?.(shapes.filter((shape) => shape.tempId !== selectedShapeId));
        onSelectShape?.(null);
      } else if (selectedTextId) {
        if (texts.find((text) => text.tempId === selectedTextId)?.locked) return;
        onTextsChange?.(texts.filter((t) => t.tempId !== selectedTextId));
        onSelectText?.(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedIconId, selectedShapeId, selectedTextId, selectedBlockIds, multiSelection, icons, shapes, texts, sheet, onSheetBlocksChange, onSelectBlock, onSelectBlocks, onIconsChange, onSelectIcon, onShapesChange, onSelectShape, onTextsChange, onSelectText, onMultiSelectionChange, shapeTool, draftPolygonPoints, removeLastPolygonPoint]);

  const handleStageMouseDown = (e: any) => {
    // Navigation must remain available while a guided polygon trace is armed.
    // In pan mode the stage owns the drag; no point is added underneath it.
    if (mode === "pan") return;
    const stage = e.target.getStage();
    let targetNode = e.target;
    while (targetNode && targetNode !== stage) {
      const targetId = typeof targetNode.id === "function" ? targetNode.id() : "";
      if (targetId && icons.some((icon) => icon.tempId === targetId)) {
        // A real pictogram click is a selection request. Let its own click
        // handler switch the editor back to selection without drawing or
        // erasing underneath it during the same pointer gesture.
        return;
      }
      targetNode = typeof targetNode.getParent === "function" ? targetNode.getParent() : null;
    }

    // Erasing must win over a stale area-selection flag. The toolbar normally
    // clears that flag, but a keyboard/tool change can land in the same React
    // render and would otherwise start a marquee instead of an eraser stroke.
    if (mode === "erase") {
      beginEraseStroke(e.target.getStage());
      return;
    }

    if (beginAreaSelection(e.target.getStage())) return;

    if (isPolygonTool(shapeTool)) {
      addPolygonPoint(e.target.getStage(), Boolean(e.evt?.shiftKey));
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

      const requestedWidth = normalizeCanvasIconDimension(placementIconSize.width);
      const requestedHeight = normalizeCanvasIconDimension(placementIconSize.height);
      const placementImage = iconImages[placementIconType];
      const naturalWidth = placementImage?.naturalWidth || placementImage?.width || 0;
      const naturalHeight = placementImage?.naturalHeight || placementImage?.height || 0;
      let iconWidth = requestedWidth;
      let iconHeight = requestedHeight;

      // A newly imported rectangular SVG must not be squeezed into the old
      // universal 40 × 40 square. Start it at its natural ratio; the Transformer
      // preserves that ratio during every later resize.
      if (naturalWidth > 0 && naturalHeight > 0) {
        const baseSize = Math.max(15, Math.min(requestedWidth, requestedHeight));
        const naturalRatio = naturalWidth / naturalHeight;
        if (naturalRatio >= 1) {
          iconWidth = Math.min(1000, baseSize * naturalRatio);
          iconHeight = baseSize;
        } else {
          iconWidth = baseSize;
          iconHeight = Math.min(1000, baseSize / naturalRatio);
        }
      }

      const resolvedIconSize = { width: iconWidth, height: iconHeight };

      // On the sheet, dropping a pictogram outside the plan's window puts it on
      // the page itself — in a heading, beside a notice, inside the legend.
      if (sheet) {
        const sheetPoint = pointerInSheetCoords(stage);
        if (sheetPoint && !isInsidePlanWindow(sheetPoint)) {
          if (sheetEditingEnabled && onPlaceSheetIcon) {
            onPlaceSheetIcon(placementIconType, sheetPoint.x, sheetPoint.y, resolvedIconSize);
          }
          return;
        }
      }

      const planPoint = pointerInPlanCoords(stage);
      if (!planPoint) return;

      // Deliberately unclamped: an assembly point often belongs outside the
      // building outline, and the sheet grows to include whatever is placed there.
      onPlaceIcon(
        placementIconType,
        planPoint.x - iconWidth / 2,
        planPoint.y - iconHeight / 2,
        resolvedIconSize
      );
      return;
    }

    if (placementText && onPlaceText) {
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!stage || !pointer) return;

      // A click in the template margin creates a real sheet block, editable
      // with all the other template properties. A click inside the plan window
      // intentionally remains a plan annotation.
      if (sheet) {
        const sheetPoint = pointerInSheetCoords(stage);
        if (sheetPoint && !isInsidePlanWindow(sheetPoint)) {
          if (sheetEditingEnabled && onPlaceSheetText) onPlaceSheetText(sheetPoint.x, sheetPoint.y);
          return;
        }
      }

      const planPoint = pointerInPlanCoords(stage);
      if (!planPoint) return;
      onPlaceText(planPoint.x, planPoint.y);
      return;
    }

    // On the sheet, clicking the plan itself picks the plan window, so it can be
    // moved and resized like any other block without hunting for a handle.
    const targetName = typeof e.target.name === "function" ? e.target.name() : (e.target.name || "");
    const targetId = typeof e.target.id === "function" ? e.target.id() : (e.target.id || "");
    const hasTargetName = (name: string) => typeof e.target.hasName === "function" ? e.target.hasName(name) : String(targetName).includes(name);

    if (
      sheet &&
      planBlock &&
      (targetName === "bgImage" ||
        targetName === "planWindow" ||
        targetId === planBlock.id ||
        hasTargetName("planWindow") ||
        hasTargetName("planWindowClip") ||
        hasTargetName("planWindowBorder") ||
        hasTargetName(planBlock.id) ||
        hasTargetName(sheetLayerNodeName(planBlock.id)))
    ) {
      onSelectIcon(null);
      onSelectShape?.(null);
      onSelectText?.(null);
      onSelectOverlay?.(null);
      onSelectBlock?.(planBlock.id);
      onSelectBatBlock?.(false);
      return;
    }

    // Off the sheet the plan is a selectable object of its own: its group has
    // already picked it on this very click, so leave the selection alone.
    // Locked, though, it cannot be dragged — then a drag across it can only
    // mean a rubber band, which is where most objects actually sit.
    if (!sheet && e.target.name() === "bgImage") {
      if (mode === "select" && (mainPlanLocked || selectedOverlayId !== MAIN_PLAN_ID || areaSelectionMode)) {
        startMarquee(e.target.getStage());
      }
      return;
    }

    // Clicked on empty canvas. In select mode this both clears the selection and
    // arms a rubber band, so objects can be swept without arming a mode first;
    // a click that never moves simply ends as a deselect.
    if (e.target === e.target.getStage() || e.target.name() === "bgImage" || e.target.name() === "sheetPaper") {
      if (mode === "select") {
        startMarquee(e.target.getStage());
        return;
      }
      onSelectIcon(null);
      onSelectShape?.(null);
      onSelectText?.(null);
      onSelectBlock?.(null);
      onSelectOverlay?.(null);
      onSelectBatBlock?.(false);
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

    // In reframe mode the wheel and trackpad control the drawing *inside* its
    // fixed template window. Zoom is anchored under the pointer, so aiming at
    // the right or left wing keeps that exact zone in view instead of always
    // enlarging around the centre of the sheet.
    if (sheet && planBlock && planReframeMode && onPlanPlacementChange) {
      const sheetPoint = pointerInSheetCoords(stage);
      if (sheetPoint && isInsidePlanWindow(sheetPoint)) {
        if (isPinchGesture || isModifierZoom || isMouseWheel) {
          const placementPoint = pointerInPlanCoords(stage);
          if (!placementPoint) return;
          const currentPercent = Math.max(10, planPlacement.scale);
          const sensitivity = isPinchGesture ? 0.01 : 0.002;
          const nextPercent = Math.max(
            20,
            Math.min(600, currentPercent * Math.exp(-event.deltaY * sensitivity)),
          );
          const radians = planRotation * Math.PI / 180;
          const centreX = contentBounds.x + contentBounds.width / 2;
          const centreY = contentBounds.y + contentBounds.height / 2;
          // pointerInPlanCoords returns coordinates local to planPlacement;
          // planScene's rotation has already been applied in that coordinate space.
          const rotatedSource = placementPoint;
          const cos = Math.abs(Math.cos(radians));
          const sin = Math.abs(Math.sin(radians));
          const rotatedWidth = contentBounds.width * cos + contentBounds.height * sin;
          const rotatedHeight = contentBounds.width * sin + contentBounds.height * cos;
          const fit = Math.min(
            planBlock.width / Math.max(1, rotatedWidth),
            planBlock.height / Math.max(1, rotatedHeight),
          );
          const nextScale = fit * nextPercent / 100;
          onPlanPlacementChange({
            scale: Math.round(nextPercent * 100) / 100,
            offsetX: Math.round(
              sheetPoint.x - planBlock.x - planBlock.width / 2
              + (centreX - rotatedSource.x) * nextScale,
            ),
            offsetY: Math.round(
              sheetPoint.y - planBlock.y - planBlock.height / 2
              + (centreY - rotatedSource.y) * nextScale,
            ),
          });
          return;
        }

        const deltaX = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
        const deltaY = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
        onPlanPlacementChange({
          ...planPlacement,
          offsetX: Math.round(planPlacement.offsetX - deltaX / Math.max(zoom, 0.1)),
          offsetY: Math.round(planPlacement.offsetY - deltaY / Math.max(zoom, 0.1)),
        });
        return;
      }
    }

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

  const approvalSurface = sheet
    ? { x: 0, y: 0, width: sheet.width, height: sheet.height }
    : contentBounds;
  const approvalCentre = {
    x: approvalSurface.x + approvalSurface.width / 2,
    y: approvalSurface.y + approvalSurface.height / 2,
  };
  const watermarkFontSize = Math.max(22, Math.min(64, approvalSurface.width / 15));
  const watermarkPositions = watermark.repeat
    ? Array.from({ length: 12 }, (_, index) => ({
        x: approvalSurface.x + approvalSurface.width * ((index % 3) + 0.5) / 3,
        y: approvalSurface.y + approvalSurface.height * (Math.floor(index / 3) + 0.5) / 4,
      }))
    : [approvalCentre];
  const hasBatLogos = Boolean(batLogoImages.client || batLogoImages.creator);
  const baseBatWidth = Math.min(
    approvalSurface.width,
    420,
    Math.max(270, approvalSurface.width * 0.28)
  );
  const baseBatHeight = Math.min(
    approvalSurface.height,
    hasBatLogos ? 350 : 290,
    Math.max(hasBatLogos ? 310 : 220, approvalSurface.height * (hasBatLogos ? 0.38 : 0.28))
  );
  const batWidth = watermark.block_width
    ? Math.max(100, Math.min(approvalSurface.width, watermark.block_width))
    : baseBatWidth;
  const batHeight = watermark.block_height
    ? Math.max(70, Math.min(approvalSurface.height, watermark.block_height))
    : baseBatHeight;

  const contentScale = Math.max(0.45, Math.min(2.5, Math.min(batWidth / 340, batHeight / (hasBatLogos ? 320 : 250))));
  const headerH = Math.max(16, Math.min(48, Math.round(38 * (batHeight / (hasBatLogos ? 320 : 260)))));
  const headerFontSize = Math.max(9, Math.min(24, Math.round(19 * contentScale)));
  const logoSlotHeight = Math.max(16, Math.min(60, Math.round(43 * contentScale)));
  const batInfoY = headerH + (hasBatLogos ? logoSlotHeight + Math.round(14 * contentScale) : Math.round(8 * contentScale));
  const infoFontSize = Math.max(7, Math.min(16, Math.round(13 * contentScale)));

  const checkboxSize = Math.max(7, Math.min(16, Math.round(13 * contentScale)));
  const checkFontSize = Math.max(7, Math.min(15, Math.round(13 * contentScale)));
  const sigFontSize = Math.max(7, Math.min(14, Math.round(12 * contentScale)));

  const bottomOffset1 = Math.round(92 * contentScale);
  const bottomOffset2 = Math.round(66 * contentScale);
  const bottomOffset3 = Math.round(36 * contentScale);
  const bottomOffsetLine = Math.round(26 * contentScale);

  const batTravelX = Math.max(0, approvalSurface.width - batWidth);
  const batTravelY = Math.max(0, approvalSurface.height - batHeight);
  const batX = approvalSurface.x + watermark.block_x * batTravelX;
  const batY = approvalSurface.y + watermark.block_y * batTravelY;

  const selectBatBlock = (event: { cancelBubble: boolean }) => {
    event.cancelBubble = true;
    onSelectIcon(null);
    onSelectShape?.(null);
    onSelectText?.(null);
    onSelectBlock?.(null);
    onSelectOverlay?.(null);
    onSelectBatBlock?.(true);
  };

  const renderSmartAlignmentGuide = (space: "plan" | "sheet") => {
    if (!smartAlignment || smartAlignment.space !== space) return null;

    const nestedPlanScale = space === "plan" && sheet ? planTransform.scale : 1;
    const inverseScale = 1 / Math.max(zoom * nestedPlanScale, 0.05);
    const extension = 14 * inverseScale;
    const dash = [5 * inverseScale, 3 * inverseScale];
    const { point, verticalReference, horizontalReference } = smartAlignment;
    const referencePoints = [verticalReference, horizontalReference]
      .filter((reference): reference is ShapePoint => Boolean(reference))
      .filter((reference, index, all) => all.findIndex(
        (candidate) => candidate.x === reference.x && candidate.y === reference.y
      ) === index);

    return (
      <Group name="editorUiOverlay" listening={false}>
        {verticalReference && (
          <Line
            points={[
              point.x,
              Math.min(point.y, verticalReference.y) - extension,
              point.x,
              Math.max(point.y, verticalReference.y) + extension,
            ]}
            stroke="#ec4899"
            strokeWidth={1}
            strokeScaleEnabled={false}
            dash={dash}
            listening={false}
          />
        )}
        {horizontalReference && (
          <Line
            points={[
              Math.min(point.x, horizontalReference.x) - extension,
              point.y,
              Math.max(point.x, horizontalReference.x) + extension,
              point.y,
            ]}
            stroke="#ec4899"
            strokeWidth={1}
            strokeScaleEnabled={false}
            dash={dash}
            listening={false}
          />
        )}
        {referencePoints.map((reference, index) => (
          <Circle
            key={`smart-reference-${index}`}
            x={reference.x}
            y={reference.y}
            radius={4 * inverseScale}
            fill="#ffffff"
            stroke="#ec4899"
            strokeWidth={1.5}
            strokeScaleEnabled={false}
            listening={false}
          />
        ))}
        <Circle
          x={point.x}
          y={point.y}
          radius={2.75 * inverseScale}
          fill="#ec4899"
          listening={false}
        />
      </Group>
    );
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
      {stageSize.width > 0 && stageSize.height > 0 && (
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
        onDblClick={() => {}}
        onMouseMove={(e: any) => {
          if (mode === "pan") return;
          if (mode === "erase") {
            if (eraserTarget === "lines") {
              setVectorEraserCursor(pointerInSceneCoords(e.target.getStage()));
            }
            extendEraseStroke(e.target.getStage());
          }
          else if (marqueeOriginRef.current) extendAreaSelection(e.target.getStage());
          else if (isPolygonTool(shapeTool)) updatePolygonCursor(e.target.getStage(), Boolean(e.evt?.shiftKey));
          else if (shapeTool) extendShape(e.target.getStage());
        }}
        onTouchMove={(e: any) => {
          if (mode === "pan") return;
          if (mode === "erase") extendEraseStroke(e.target.getStage());
          else if (marqueeOriginRef.current) extendAreaSelection(e.target.getStage());
          else if (isPolygonTool(shapeTool)) updatePolygonCursor(e.target.getStage());
          else if (shapeTool) extendShape(e.target.getStage());
        }}
        onMouseUp={() => {
          finishAreaSelection();
          finishEraseStroke();
          if (!isPolygonTool(shapeTool)) finishShape();
        }}
        onTouchEnd={() => {
          finishAreaSelection();
          finishEraseStroke();
          if (!isPolygonTool(shapeTool)) finishShape();
        }}
        onMouseLeave={() => {
          finishAreaSelection();
          finishEraseStroke();
          if (!isPolygonTool(shapeTool)) finishShape();
          if (isPolygonTool(shapeTool)) {
            setPolygonCursor(null);
            setSmartAlignment(null);
          }
          setVectorEraserCursor(null);
        }}
        onDragEnd={handleStageDrag}
        onWheel={handleWheel}
        style={{
          cursor:
            mode === "erase"
              ? "cell"
              : mode === "pan"
                  ? "grab"
                  : areaSelectionMode || isPolygonTool(shapeTool) || placementIconType || placementText
                    ? "crosshair"
                  : planReframeMode
                    ? "grab"
                  : "default"
        }}
      >
        <Layer ref={layerRef}>
          {/* ── Sheet mode: the printed page behind everything ── */}
          {sheet && (
            <Rect
              name="sheetPaper"
              x={0}
              y={0}
              width={sheet.width}
              height={sheet.height}
              fill="#ffffff"
              shadowColor="#000000"
              shadowBlur={24 / Math.max(zoom, 0.1)}
              shadowOpacity={0.55}
              shadowOffsetY={6 / Math.max(zoom, 0.1)}
            />
          )}

          {sheet && sheetBackgroundBlock?.imageKey && sheetImages[sheetBackgroundBlock.imageKey] && (
            <KonvaImage
              name={sheetLayerNodeName(sheetBackgroundBlock.id)}
              image={sheetImages[sheetBackgroundBlock.imageKey] ?? undefined}
              x={sheetBackgroundBlock.x}
              y={sheetBackgroundBlock.y}
              width={sheetBackgroundBlock.width}
              height={sheetBackgroundBlock.height}
              listening={false}
            />
          )}

          {/* The plan window's backing. It is also the node the Transformer
              resizes, which is why it carries the block's name. */}
          {sheet && planBlock && planBlock.visible && (
            <Rect
              name={`${planBlock.id} ${sheetLayerNodeName(planBlock.id)} planWindow`}
              id={planBlock.id}
              x={planBlock.x}
              y={planBlock.y}
              width={planBlock.width}
              height={planBlock.height}
              fill={planBlock.fill || "#ffffff"}
              cornerRadius={planBlock.cornerRadius ?? 0}
              draggable={Boolean(sheet) && sheetEditingEnabled && mode === "select" && planBlockSelected && !planBlock?.locked && !planReframeMode}
              onClick={() => {
                onSelectIcon(null);
                onSelectShape?.(null);
                onSelectText?.(null);
                onSelectOverlay?.(null);
                onSelectBlock?.(planBlock.id);
                onSelectBatBlock?.(false);
              }}
              onTap={() => {
                onSelectIcon(null);
                onSelectShape?.(null);
                onSelectText?.(null);
                onSelectOverlay?.(null);
                onSelectBlock?.(planBlock.id);
                onSelectBatBlock?.(false);
              }}
              onMouseDown={() => {
                onSelectIcon(null);
                onSelectShape?.(null);
                onSelectText?.(null);
                onSelectOverlay?.(null);
                onSelectBlock?.(planBlock.id);
                onSelectBatBlock?.(false);
              }}
              onTouchStart={() => {
                onSelectIcon(null);
                onSelectShape?.(null);
                onSelectText?.(null);
                onSelectOverlay?.(null);
                onSelectBlock?.(planBlock.id);
                onSelectBatBlock?.(false);
              }}
              onDragEnd={(event: any) => {
                if (!sheet || !planBlock || planBlock.locked) return;
                const node = event.target;
                const dx = node.x() - planBlock.x;
                const dy = node.y() - planBlock.y;
                if (!dx && !dy) return;
                updateSheetBlock(planBlock.id, {
                  x: Math.round(node.x()),
                  y: Math.round(node.y())
                });
              }}
              onTransformEnd={(event: any) => {
                if (planBlock.locked) return;
                const node = event.target;
                const scaleX = Math.abs(node.scaleX()) || 1;
                const scaleY = Math.abs(node.scaleY()) || 1;
                node.scaleX(1);
                node.scaleY(1);
                updateSheetBlock(planBlock.id, {
                  x: Math.round(node.x()),
                  y: Math.round(node.y()),
                  width: Math.max(80, Math.round(planBlock.width * scaleX)),
                  height: Math.max(80, Math.round(planBlock.height * scaleY))
                });
              }}
            />
          )}



          {/* The plan window: clips the plan to the frame, and drags it — with
              its content — across the sheet. Holding Alt reframes the plan
              inside the window instead of moving the window. */}
          <Group
            name={`planWindowClip planWindow${planBlock ? ` ${sheetLayerNodeName(planBlock.id)}` : ""}`}
            clipFunc={
              sheet && planBlock && planBlock.visible
                ? (context: any) => {
                    context.rect(planBlock.x, planBlock.y, planBlock.width, planBlock.height);
                  }
                : undefined
            }
            draggable={Boolean(sheet) && sheetEditingEnabled && mode === "select" && planBlockSelected && !planBlock?.locked && !planReframeMode}
            onDragEnd={(event: any) => {
              if (!sheet || !planBlock) return;
              const node = event.target;
              if (!node.hasName("planWindowClip")) return;
              const dx = node.x();
              const dy = node.y();
              node.position({ x: 0, y: 0 });
              if (!dx && !dy) return;
              updateSheetBlock(planBlock.id, {
                x: Math.round(planBlock.x + dx),
                y: Math.round(planBlock.y + dy)
              });
            }}
          >
            <Group
              name="planPlacement"
              x={sheet ? planTransform.x : 0}
              y={sheet ? planTransform.y : 0}
              scaleX={sheet ? planTransform.scale : 1}
              scaleY={sheet ? planTransform.scale : 1}
              draggable={Boolean(sheet) && sheetEditingEnabled && mode === "select" && (planBlockSelected || planReframeMode) && (!planBlock?.locked || planReframeMode) && Boolean(onPlanPlacementChange)}
              onMouseEnter={(e: any) => {
                if (planReframeMode) {
                  const stage = e.target.getStage();
                  if (stage) stage.container().style.cursor = "grab";
                }
              }}
              onMouseLeave={(e: any) => {
                if (planReframeMode) {
                  const stage = e.target.getStage();
                  if (stage) stage.container().style.cursor = "default";
                }
              }}
              onDragStart={(event: any) => {
                const stage = event.target.getStage();
                if (stage) stage.container().style.cursor = "grabbing";
                // Both the window and the plan inside it are draggable, and Konva
                // always picks the innermost one. Alt is the switch: without it,
                // hand the gesture back to the window so the whole block moves.
                if (planReframeMode || event.evt?.altKey) return;
                const node = event.target;
                if (node.name() !== "planPlacement") return;
                node.stopDrag();
                node.getParent()?.startDrag(event.evt);
              }}
              onDragEnd={(event: any) => {
                const stage = event.target.getStage();
                if (stage) stage.container().style.cursor = planReframeMode ? "grab" : "default";
                if (!sheet || !onPlanPlacementChange) return;
                const node = event.target;
                if (node.name() !== "planPlacement") return;
                onPlanPlacementChange({
                  ...planPlacement,
                  offsetX: Math.round(planPlacement.offsetX + (node.x() - planTransform.x)),
                  offsetY: Math.round(planPlacement.offsetY + (node.y() - planTransform.y))
                });
              }}
            >
              {/* Reliable hit surface for planPlacement: allows clicking/dragging anywhere
                  within the plan window to engage plan recadrage */}
              {sheet && planBlock && (
                <Rect
                  x={contentBounds.x - 20000}
                  y={contentBounds.y - 20000}
                  width={contentBounds.width + 40000}
                  height={contentBounds.height + 40000}
                  fill="rgba(255,255,255,0.001)"
                  name="bgImage planPlacementHit"
                  listening={true}
                />
              )}
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
          <Rect
            x={contentBounds.x}
            y={contentBounds.y}
            width={contentBounds.width}
            height={contentBounds.height}
            fill={sheet ? "rgba(255,255,255,0.001)" : (bgImage ? "#ffffff" : "#f8fafc")}
            shadowColor={sheet ? undefined : "#000000"}
            shadowBlur={sheet ? undefined : 24 / Math.max(zoom, 0.1)}
            shadowOpacity={sheet ? undefined : 0.55}
            shadowOffsetY={sheet ? undefined : 6 / Math.max(zoom, 0.1)}
            listening={shouldMainPlanReceivePointerEvents({
              areaSelectionMode,
              sheetActive: Boolean(sheet),
              mainPlanLocked,
            })}
            name="bgImage planSheet"
          />

          {/* Background plan — draggable and resizable, and everything drawn on
              it follows: a pictogram marks a real place in the building, so it
              cannot stay behind when the plan moves under it. */}
          {bgImage && mainPlanVisible && (
            <Group
              id={MAIN_PLAN_ID}
              name={`${MAIN_PLAN_ID} ${editorLayerNodeName(MAIN_PLAN_ID)}`}
              x={mainPlanTransform.x}
              y={mainPlanTransform.y}
              width={mainPlanTransform.width}
              height={mainPlanTransform.height}
              listening={shouldMainPlanReceivePointerEvents({
                areaSelectionMode,
                sheetActive: Boolean(sheet),
                mainPlanLocked,
              })}
              draggable={!areaSelectionMode && !sheet && mode === "select" && !shapeTool && !mainPlanLocked && selectedOverlayId === MAIN_PLAN_ID}
              onClick={selectMainPlan}
              onTap={selectMainPlan}
              onDragEnd={(e: any) => {
                const node = e.target;
                const dx = node.x() - mainPlanTransform.x;
                const dy = node.y() - mainPlanTransform.y;
                if (!dx && !dy) return;
                setMainPlanTransform((prev) => ({ ...prev, x: node.x(), y: node.y() }));
                moveMainPlanContent({ dx, dy, scaleX: 1, scaleY: 1, originX: 0, originY: 0 });
              }}
              onTransformEnd={(e: any) => {
                const node = e.target;
                const rawScaleX = Math.abs(node.scaleX()) || 1;
                const rawScaleY = Math.abs(node.scaleY()) || 1;
                node.scaleX(1);
                node.scaleY(1);

                let width: number;
                let height: number;
                let scaleX: number;
                let scaleY: number;

                if (keepPlanRatio) {
                  const naturalRatio = (bgImage?.naturalWidth && bgImage?.naturalHeight)
                    ? bgImage.naturalWidth / bgImage.naturalHeight
                    : (mainPlanTransform.width / Math.max(1, mainPlanTransform.height));
                  const uniformScale = Math.abs(rawScaleX - 1) > Math.abs(rawScaleY - 1) ? rawScaleX : rawScaleY;
                  width = Math.max(50, Math.round(mainPlanTransform.width * uniformScale));
                  height = Math.max(50, Math.round(width / naturalRatio));
                  scaleX = width / mainPlanTransform.width;
                  scaleY = height / mainPlanTransform.height;
                } else {
                  width = Math.max(50, Math.round(mainPlanTransform.width * rawScaleX));
                  height = Math.max(50, Math.round(mainPlanTransform.height * rawScaleY));
                  scaleX = width / mainPlanTransform.width;
                  scaleY = height / mainPlanTransform.height;
                }

                setMainPlanTransform((prev) => ({
                  ...prev,
                  x: node.x(),
                  y: node.y(),
                  width,
                  height
                }));
                moveMainPlanContent({
                  dx: node.x() - mainPlanTransform.x,
                  dy: node.y() - mainPlanTransform.y,
                  scaleX,
                  scaleY,
                  originX: mainPlanTransform.x,
                  originY: mainPlanTransform.y
                });
              }}
            >
              <KonvaImage
                image={editedBackground || bgImage}
                width={mainPlanTransform.width}
                height={mainPlanTransform.height}
                stroke={selectedOverlayId === MAIN_PLAN_ID && mainPlanLocked ? "#3b82f6" : undefined}
                strokeWidth={selectedOverlayId === MAIN_PLAN_ID && mainPlanLocked ? 1 : 0}
                strokeScaleEnabled={false}
                name="bgImage"
                listening={shouldMainPlanReceivePointerEvents({
                  areaSelectionMode,
                  sheetActive: Boolean(sheet),
                  mainPlanLocked,
                })}
              />
            </Group>
          )}

          {/* Secondary Plan Overlays (Multi-plan in Plan Seul mode) */}
          {planOverlays.filter((overlay) => overlay.visible !== false).map((overlay) => {
            const img = overlayImages[overlay.tempId];
            const isSelected = selectedOverlayId === overlay.tempId;
            return (
              <Group
                key={overlay.tempId}
                id={overlay.tempId}
                name={`${overlay.tempId} ${editorLayerNodeName(overlay.tempId)}`}
                x={overlay.x}
                y={overlay.y}
                width={overlay.width}
                height={overlay.height}
                rotation={overlay.rotation}
                listening={!areaSelectionMode && (!sheet || !overlay.locked)}
                draggable={!areaSelectionMode && !sheet && mode === "select" && !shapeTool && !overlay.locked}
                onMouseDown={() => !sheet && !overlay.locked && selectPlanOverlay(overlay.tempId)}
                onTouchStart={() => !sheet && !overlay.locked && selectPlanOverlay(overlay.tempId)}
                onClick={() => !sheet && !overlay.locked && selectPlanOverlay(overlay.tempId)}
                onTap={() => !sheet && !overlay.locked && selectPlanOverlay(overlay.tempId)}
                onDragEnd={(e: any) => {
                  if (!onPlanOverlaysChange) return;
                  const nextOverlay = { ...overlay, x: e.target.x(), y: e.target.y() };
                  moveOverlayGroupedContent(overlay, nextOverlay);
                  const updated = planOverlays.map((item) =>
                    item.tempId === overlay.tempId
                      ? nextOverlay
                      : item
                  );
                  onPlanOverlaysChange(updated);
                }}
                onTransformEnd={(e: any) => {
                  if (!onPlanOverlaysChange) return;
                  const node = e.target;
                  const rawScaleX = Math.abs(node.scaleX()) || 1;
                  const rawScaleY = Math.abs(node.scaleY()) || 1;
                  node.scaleX(1);
                  node.scaleY(1);

                  let width: number;
                  let height: number;

                  if (keepPlanRatio) {
                    const img = overlayImages[overlay.tempId];
                    const naturalRatio = (img?.naturalWidth && img?.naturalHeight)
                      ? img.naturalWidth / img.naturalHeight
                      : (overlay.width / Math.max(1, overlay.height));
                    const uniformScale = Math.abs(rawScaleX - 1) > Math.abs(rawScaleY - 1) ? rawScaleX : rawScaleY;
                    width = Math.max(40, Math.round(overlay.width * uniformScale));
                    height = Math.max(40, Math.round(width / naturalRatio));
                  } else {
                    width = Math.max(40, Math.round(overlay.width * rawScaleX));
                    height = Math.max(40, Math.round(overlay.height * rawScaleY));
                  }

                  const nextOverlay = {
                    ...overlay,
                    x: Math.round(node.x()),
                    y: Math.round(node.y()),
                    width,
                    height,
                    rotation: node.rotation()
                  };
                  moveOverlayGroupedContent(overlay, nextOverlay);
                  const updated = planOverlays.map((item) =>
                    item.tempId === overlay.tempId
                      ? nextOverlay
                      : item
                  );
                  onPlanOverlaysChange(updated);
                }}
              >
                {img ? (
                  <KonvaImage
                    image={img}
                    width={overlay.width}
                    height={overlay.height}
                    stroke={isSelected && overlay.locked ? "#3b82f6" : undefined}
                    strokeWidth={isSelected && overlay.locked ? 1 : 0}
                    strokeScaleEnabled={false}
                  />
                ) : (
                  <Rect
                    width={overlay.width}
                    height={overlay.height}
                    fill="rgba(56, 189, 248, 0.15)"
                    stroke={isSelected && overlay.locked ? "#3b82f6" : "#38bdf8"}
                    strokeWidth={1}
                    strokeScaleEnabled={false}
                    dash={[4, 4]}
                  />
                )}
              </Group>
            );
          })}

          {/* Drawn shapes — under the pictograms so icons stay readable */}
          {shapes.filter((shape) => shape.visible !== false).map((shape) => {
            const isShapeMultiSelected = multiSelection.shapeIds.includes(shape.tempId);
            if (isPolygonShape(shape.shape_type)) {
              return renderPolygonZone(shape, {
                isSelected: selectedShapeId === shape.tempId || isShapeMultiSelected
              });
            }

            const common = {
              id: shape.tempId,
              name: `${shape.tempId} ${editorLayerNodeName(shape.tempId)}`,
              stroke: shape.color,
              strokeWidth: shape.stroke_width,
              strokeScaleEnabled: false,
              rotation: shape.rotation,
              listening: !areaSelectionMode && (!sheet || !shape.locked),
              draggable: !areaSelectionMode && !sheet && mode === "select" && !shapeTool && !shape.locked,
              onClick: (e: any) => {
                if (sheet && shape.locked) return;
                const isMulti = Boolean(e?.evt?.shiftKey || e?.evt?.ctrlKey || e?.evt?.metaKey);
                onSelectShape?.(shape.tempId, { shiftKey: isMulti });
              },
              onTap: () => !(sheet && shape.locked) && onSelectShape?.(shape.tempId),
              // Only the hidden hit area grows; the visible contour stays exact.
              hitStrokeWidth: shapeHitStrokeWidth(shape.stroke_width, zoom),
              onDragEnd: (e: any) => {
                const dx = e.target.x() - shape.x;
                const dy = e.target.y() - shape.y;
                if (!moveObjectGroup(shape.object_group_id, dx, dy)) {
                  const multiCount = multiSelection.iconIds.length + multiSelection.shapeIds.length + multiSelection.textIds.length;
                  if (multiCount > 1 && multiSelection.shapeIds.includes(shape.tempId)) {
                    translateContent(dx, dy, multiSelection);
                  } else {
                    updateShape(shape.tempId, { x: e.target.x(), y: e.target.y() });
                  }
                }
              },
              onTransformEnd: (e: any) => {
                const node = e.target;
                const scaleX = Math.abs(node.scaleX());
                const scaleY = Math.abs(node.scaleY());
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
              const fillOpacity = shape.fill_opacity !== undefined ? shape.fill_opacity : 0.35;
              const hasFill = hasVisibleShapeFill(shape.fill_color, fillOpacity);
              const fill = hasFill ? shape.fill_color! : undefined;
              return (
                <Ellipse
                  key={shape.tempId}
                  {...common}
                  x={shape.x + shape.width / 2}
                  y={shape.y + shape.height / 2}
                  radiusX={Math.max(1, shape.width / 2)}
                  radiusY={Math.max(1, shape.height / 2)}
                  fill={fill}
                  fillEnabled={hasFill}
                  fillOpacity={hasFill ? fillOpacity : undefined}
                  globalCompositeOperation={shouldMultiplyFill(fill) ? "multiply" : undefined}
                  onDragEnd={(e: any) => {
                    const dx = e.target.x() - (shape.x + shape.width / 2);
                    const dy = e.target.y() - (shape.y + shape.height / 2);
                    if (!moveObjectGroup(shape.object_group_id, dx, dy)) {
                      updateShape(shape.tempId, {
                        x: e.target.x() - shape.width / 2,
                        y: e.target.y() - shape.height / 2
                      });
                    }
                  }}
                />
              );
            }

            // A zone is a filled, semi-transparent rectangle used to highlight
            // an area on the plan (e.g. a sector, a room). Same geometry as the
            // plain rect, but with a tinted fill and a dashed border.
            if (shape.shape_type === "zone") {
              const fillOpacity = shape.fill_opacity !== undefined ? shape.fill_opacity : 0.28;
              const hasFill = hasVisibleShapeFill(shape.fill_color, fillOpacity);
              const fill = hasFill ? shape.fill_color! : undefined;
              return (
                <Rect
                  key={shape.tempId}
                  {...common}
                  x={shape.x}
                  y={shape.y}
                  width={Math.max(1, shape.width)}
                  height={Math.max(1, shape.height)}
                  fill={fill}
                  fillEnabled={hasFill}
                  fillOpacity={hasFill ? fillOpacity : undefined}
                  globalCompositeOperation={shouldMultiplyFill(fill) ? "multiply" : undefined}
                  dash={[10 / Math.max(zoom, 0.05), 6 / Math.max(zoom, 0.05)]}
                  cornerRadius={2}
                />
              );
            }

            const fillOpacity = shape.fill_opacity !== undefined ? shape.fill_opacity : 0.35;
            const hasFill = hasVisibleShapeFill(shape.fill_color, fillOpacity);
            const fill = hasFill ? shape.fill_color! : undefined;
            return (
              <Rect
                key={shape.tempId}
                {...common}
                x={shape.x}
                y={shape.y}
                width={Math.max(1, shape.width)}
                height={Math.max(1, shape.height)}
                fill={fill}
                fillEnabled={hasFill}
                fillOpacity={hasFill ? fillOpacity : undefined}
                globalCompositeOperation={shouldMultiplyFill(fill) ? "multiply" : undefined}
              />
            );
          })}

          {draftShapeSpace === "plan" && [...(draftShape ? [draftShape] : [])].map((shape) => {
            const isDraft = true;
            const common = {
              id: shape.tempId,
              name: "editorUiOverlay",
              stroke: shape.color,
              strokeWidth: shape.stroke_width,
              strokeScaleEnabled: false,
              rotation: shape.rotation,
              draggable: false,
              listening: false,
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
                />
              );
            }

            if (shape.shape_type === "zone") {
              return (
                <Rect
                  key={shape.tempId}
                  {...common}
                  x={shape.x}
                  y={shape.y}
                  width={Math.max(1, shape.width)}
                  height={Math.max(1, shape.height)}
                  fill={shape.color}
                  opacity={0.28}
                  dash={[10 / Math.max(zoom, 0.05), 6 / Math.max(zoom, 0.05)]}
                  cornerRadius={2}
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

          {draftShapeSpace === "plan" && isPolygonTool(shapeTool) && draftPolygonPoints.length > 0 &&
            renderPolygonZone(
              {
                tempId: "draft-polygon-zone",
                shape_type: (shapeTool || "polygon_zone") as ShapeKind,
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                rotation: 0,
                stroke_width: shapeStrokeWidth,
                color: shapeColor
              },
              { isDraft: true, previewPoint: polygonCursor }
            )}

          {isPolygonTool(shapeTool) && renderSmartAlignmentGuide("plan")}

          {mode === "erase" && eraserTarget === "lines" && vectorEraserCursor && (
            <Circle
              name="editorUiOverlay"
              x={vectorEraserCursor.x}
              y={vectorEraserCursor.y}
              radius={eraserSize / 2}
              fill="#f59e0b"
              opacity={0.14}
              stroke="#f59e0b"
              strokeWidth={1.5 / Math.max(zoom, 0.1)}
              dash={[5 / Math.max(zoom, 0.1), 3 / Math.max(zoom, 0.1)]}
              listening={false}
            />
          )}

          {/* Leader lines. Pure geometry linking two real positions, so unlike the
              pictograms these turn with the plan — they sit outside the
              ".iconUpright" groups that hold the artwork straight. */}
          {icons.filter((icon) => icon.visible !== false).flatMap((icon) =>
            canvasIconLeaderPoints(icon).map((leaderPoint) => {
            const end = leaderEndpoint(icon, leaderPoint.x, leaderPoint.y, iconDefinitions, planRotation);
            // Centralised leader colour: exact pictogram → colour lookup, so the
            // line and anchor dot use the pictogram's functional colour (red for
            // fire-fighting, green for escape, …) rather than a flat tint.
            const leaderColor = getIconLeaderColor(icon.icon_type, {
              leaderColor: icon.leader_color,
              iconColor: icon.color,
              label: iconDefinitions[icon.icon_type]?.label,
              definitions: iconDefinitions,
            });

            return (
              <Group key={`leader-${icon.tempId}-${leaderPoint.id}`} name={editorLayerNodeName(icon.tempId)}>
                <Line
                  points={[leaderPoint.x, leaderPoint.y, end.x, end.y]}
                  stroke={leaderColor}
                  strokeWidth={normalizeCanvasLeaderWidth(icon.leader_width)}
                  strokeScaleEnabled={false}
                  lineCap="round"
                  listening={false}
                />
                <Circle
                  x={leaderPoint.x}
                  y={leaderPoint.y}
                  radius={normalizeCanvasLeaderDotSize(icon.leader_dot_size) / Math.max(zoom, 0.05)}
                  fill={leaderColor}
                  stroke={leaderColor}
                  strokeWidth={normalizeCanvasLeaderDotSize(icon.leader_dot_size) > 0 ? 1 : 0}
                  strokeScaleEnabled={false}
                  hitStrokeWidth={14 / Math.max(zoom, 0.05)}
                  listening={!areaSelectionMode && (!sheet || !icon.locked)}
                  draggable={!areaSelectionMode && !sheet && mode === "select" && !shapeTool && !icon.locked}
                  onClick={() => !(sheet && icon.locked) && onSelectIcon(icon.tempId)}
                  onTap={() => !(sheet && icon.locked) && onSelectIcon(icon.tempId)}
                  onDragEnd={(e: any) => {
                    onIconsChange(
                      icons.map((item) =>
                        item.tempId === icon.tempId
                          ? {
                              ...item,
                              anchor_x: null,
                              anchor_y: null,
                              leader_points: canvasIconLeaderPoints(item).map((point) =>
                                point.id === leaderPoint.id
                                  ? { ...point, x: e.target.x(), y: e.target.y() }
                                  : point
                              ),
                            }
                          : item
                      )
                    );
                  }}
                />
              </Group>
            );
          }))}

          {/* Render Safety Icons */}
          {icons.filter((icon) => icon.visible !== false).map((icon) => {
            // Falls back to the original artwork while the recoloured variant
            // is still being built, so a pictogram never blinks out.
            const colorOverride = normalizePictogramColorOverride(icon.color);
            const iconImage = colorOverride
              ? recoloredIconImages[`${icon.icon_type}|${colorOverride}`] || iconImages[icon.icon_type]
              : iconImages[icon.icon_type];
            const artworkWidth = Math.max(1, iconImage?.naturalWidth || iconImage?.width || icon.width);
            const artworkHeight = Math.max(1, iconImage?.naturalHeight || iconImage?.height || icon.height);
            return (
              <Group
                key={icon.tempId}
                id={icon.tempId}
                name={`${icon.tempId} ${editorLayerNodeName(icon.tempId)}`}
                x={icon.x}
                y={icon.y}
                width={icon.width}
                height={icon.height}
                rotation={icon.rotation}
                listening={!areaSelectionMode && (!sheet || !icon.locked)}
                draggable={!areaSelectionMode && !sheet && mode === "select" && !icon.locked}
                onClick={(e) => {
                  if (sheet && icon.locked) return;
                  const isMulti = Boolean(e?.evt?.shiftKey || e?.evt?.ctrlKey || e?.evt?.metaKey);
                  onSelectIcon(icon.tempId, { shiftKey: isMulti });
                }}
                onTap={() => !(sheet && icon.locked) && onSelectIcon(icon.tempId)}
                onDragEnd={(e) => {
                  const dx = e.target.x() - icon.x;
                  const dy = e.target.y() - icon.y;
                  if (moveObjectGroup(icon.object_group_id, dx, dy)) return;
                  const multiCount = multiSelection.iconIds.length + multiSelection.shapeIds.length + multiSelection.textIds.length;
                  if (multiCount > 1 && multiSelection.iconIds.includes(icon.tempId)) {
                    translateContent(dx, dy, multiSelection);
                    return;
                  }
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
                  // Konva stores a resize as scale. Commit it as real dimensions
                  // while preserving the pictogram artwork's intrinsic ratio.
                  const node = e.target;
                  const nodeScaleX = Math.abs(node.scaleX());
                  const nodeScaleY = Math.abs(node.scaleY());
                  const scaleX = Number.isFinite(nodeScaleX) ? nodeScaleX : 1;
                  const scaleY = Number.isFinite(nodeScaleY) ? nodeScaleY : 1;

                  // Reset scale to avoid accumulating multiplier issues
                  node.scaleX(1);
                  node.scaleY(1);

                  const transformedWidth = normalizeTransformedCanvasIconDimension(
                    icon.width * scaleX,
                    icon.width
                  );
                  const transformedHeight = normalizeTransformedCanvasIconDimension(
                    icon.height * scaleY,
                    icon.height
                  );
                  const transformedSize = icon.lock_aspect_ratio !== false
                    ? normalizeCanvasIconSizeToAspectRatio(
                        transformedWidth,
                        transformedHeight,
                        artworkWidth / artworkHeight,
                        { width: icon.width, height: icon.height }
                      )
                    : { width: transformedWidth, height: transformedHeight };

                  const updated = icons.map((item) => {
                    if (item.tempId === icon.tempId) {
                      return {
                        ...item,
                        x: node.x(),
                        y: node.y(),
                        width: transformedSize.width,
                        height: transformedSize.height,
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
                  scaleX={icon.flip_x ? -1 : 1}
                  scaleY={icon.flip_y ? -1 : 1}
                >
                  {/* SVG Render */}
                  {iconImage ? (
                    <KonvaImage
                      image={iconImage}
                      width={artworkWidth}
                      height={artworkHeight}
                      scaleX={icon.width / artworkWidth}
                      scaleY={icon.height / artworkHeight}
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
                      scaleX={icon.flip_x ? -1 : 1}
                      scaleY={icon.flip_y ? -1 : 1}
                    />
                  )}
                </Group>
                {multiSelection.iconIds.includes(icon.tempId) && (
                  <Rect
                    x={-2}
                    y={-2}
                    width={icon.width + 4}
                    height={icon.height + 4}
                    stroke="#3b82f6"
                    strokeWidth={1 / Math.max(zoom, 0.1)}
                    dash={[4 / Math.max(zoom, 0.1), 2 / Math.max(zoom, 0.1)]}
                    listening={false}
                  />
                )}
              </Group>
            );
          })}

          {/* Render free text annotations */}
          {texts.filter((text) => text.visible !== false).map((t) => {
            const fontStyle = `${t.italic ? "italic" : ""} ${t.bold ? "bold" : "normal"}`.trim() || "normal";
            const { width: approxWidth, height: approxHeight } = measureCanvasText(
              t.text,
              t.font_size,
              t.font_family,
              fontStyle
            );
            const padX = 6;
            const padY = 4;
            return (
              <Group
                key={t.tempId}
                id={t.tempId}
                name={`${t.tempId} ${editorLayerNodeName(t.tempId)}`}
                x={t.x}
                y={t.y}
                rotation={t.rotation}
                listening={!areaSelectionMode && (!sheet || !t.locked)}
                draggable={!areaSelectionMode && !sheet && mode === "select" && !t.locked}
                onClick={(e) => {
                  if (sheet && t.locked) return;
                  const isMulti = Boolean(e?.evt?.shiftKey || e?.evt?.ctrlKey || e?.evt?.metaKey);
                  onSelectText?.(t.tempId, { shiftKey: isMulti });
                }}
                onTap={() => !(sheet && t.locked) && onSelectText?.(t.tempId)}
                onDragEnd={(e) => {
                  const dx = e.target.x() - t.x;
                  const dy = e.target.y() - t.y;
                  if (moveObjectGroup(t.object_group_id, dx, dy)) return;
                  const multiCount = multiSelection.iconIds.length + multiSelection.shapeIds.length + multiSelection.textIds.length;
                  if (multiCount > 1 && multiSelection.textIds.includes(t.tempId)) {
                    translateContent(dx, dy, multiSelection);
                    return;
                  }
                  const updated = texts.map((item) =>
                    item.tempId === t.tempId
                      ? { ...item, x: e.target.x(), y: e.target.y() }
                      : item
                  );
                  onTextsChange?.(updated);
                }}
                onTransformEnd={(e) => {
                  const node = e.target;
                  const scaleX = Math.abs(node.scaleX());
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
                    width={approxWidth}
                    height={approxHeight}
                    align={t.align ?? "left"}
                    fontSize={t.font_size}
                    fontFamily={t.font_family}
                    fill={t.color}
                    fontStyle={fontStyle}
                    lineHeight={1.3}
                  />
                </Group>
                {multiSelection.textIds.includes(t.tempId) && (
                  <Rect
                    x={-padX - 2}
                    y={-padY - 2}
                    width={approxWidth + padX * 2 + 4}
                    height={approxHeight + padY * 2 + 4}
                    stroke="#3b82f6"
                    strokeWidth={1 / Math.max(zoom, 0.1)}
                    dash={[4 / Math.max(zoom, 0.1), 2 / Math.max(zoom, 0.1)]}
                    listening={false}
                  />
                )}
              </Group>
            );
          })}

          {selectedContentBounds && !areaSelectionMode && (
            <Rect
              name="multiSelectionBounds editorUiOverlay"
              x={selectedContentBounds.x - 7 / Math.max(zoom, 0.05)}
              y={selectedContentBounds.y - 7 / Math.max(zoom, 0.05)}
              width={selectedContentBounds.width + 14 / Math.max(zoom, 0.05)}
              height={selectedContentBounds.height + 14 / Math.max(zoom, 0.05)}
              fill="rgba(59, 130, 246, 0.05)"
              stroke="#3b82f6"
              strokeWidth={1}
              strokeScaleEnabled={false}
              dash={[8 / Math.max(zoom, 0.1), 5 / Math.max(zoom, 0.1)]}
              draggable={mode === "select"}
              listening={mode === "select"}
              onDragEnd={(event: any) => {
                const dx = event.target.x() - (selectedContentBounds.x - 7 / Math.max(zoom, 0.05));
                const dy = event.target.y() - (selectedContentBounds.y - 7 / Math.max(zoom, 0.05));
                translateContent(dx, dy, multiSelection);
              }}
            />
          )}

          {marqueeRect && !sheet && (
            <Rect
              name="areaSelectionMarquee editorUiOverlay"
              x={marqueeRect.x}
              y={marqueeRect.y}
              width={marqueeRect.width}
              height={marqueeRect.height}
              fill="rgba(56, 189, 248, 0.12)"
              stroke="#38bdf8"
              strokeWidth={1}
              strokeScaleEnabled={false}
              dash={[7 / Math.max(zoom, 0.1), 4 / Math.max(zoom, 0.1)]}
              listening={false}
            />
          )}
          </Group>
            </Group>
          </Group>



          {/* The window's rule, drawn over the plan so the frame stays crisp
              whatever the plan bleeds to its edges. */}
          {sheet && planBlock && planBlock.visible && planBlock.strokeWidth ? (
            <Rect
              name={`planWindowBorder ${sheetLayerNodeName(planBlock.id)}`}
              x={planBlock.x}
              y={planBlock.y}
              width={planBlock.width}
              height={planBlock.height}
              stroke={planBlock.stroke}
              strokeWidth={planBlock.strokeWidth}
              strokeScaleEnabled={false}
              cornerRadius={planBlock.cornerRadius ?? 0}
              listening={false}
            />
          ) : null}

          {/* ── Sheet blocks: banner, notices, legend, logos ── */}
          {sheet &&
            sheet.blocks
              .filter((block) => block.kind !== "plan" && block.kind !== "background")
              .map((block) => (
                <SheetBlockNode
                  key={block.id}
                  block={block}
                  isSelected={selectedBlockIds.includes(block.id)}
                  editable={sheetEditingEnabled
                    && (isSheetBlockEditable?.(block) ?? true)
                    && mode === "select"
                    && !areaSelectionMode
                    && !block.locked}
                  legendEntries={sheetLegendEntries}
                  images={sheetImages}
                  pictoImages={resolvedSheetPictoImages}
                  recoloredPictoImages={recoloredIconImages}
                  interactionScale={zoom}
                  layerName={sheetLayerNodeName(block.id)}
                  onSelect={(id, meta) => {
                    onSelectIcon(null);
                    onSelectShape?.(null);
                    onSelectText?.(null);
                    onSelectBlock?.(id, meta);
                  }}
                  onChange={updateSheetBlock}
                  onDragStateChange={onDragStateChange}
                  onEditText={(id) => {
                    const target = sheet.blocks.find((item) => item.id === id);
                    if (
                      !target
                      || target.kind === "image"
                      || target.kind === "picto"
                      || target.kind === "shape"
                      || target.situationRole === "frame"
                      || !(isSheetBlockEditable?.(target) ?? true)
                    ) return;
                    onSelectBlock?.(id);
                    setEditingBlockId(id);
                  }}
                />
              ))}

          {sheet && selectedSheetBounds && !areaSelectionMode && (
            <Rect
              name="sheetMultiSelectionBounds editorUiOverlay"
              x={selectedSheetBounds.x - 7 / Math.max(zoom, 0.05)}
              y={selectedSheetBounds.y - 7 / Math.max(zoom, 0.05)}
              width={selectedSheetBounds.width + 14 / Math.max(zoom, 0.05)}
              height={selectedSheetBounds.height + 14 / Math.max(zoom, 0.05)}
              fill="rgba(59, 130, 246, 0.04)"
              stroke="#3b82f6"
              strokeWidth={1}
              strokeScaleEnabled={false}
              dash={[8 / Math.max(zoom, 0.1), 5 / Math.max(zoom, 0.1)]}
              draggable={sheetEditingEnabled && mode === "select"}
              listening={sheetEditingEnabled && mode === "select"}
              onDragEnd={(event: any) => {
                const originX = selectedSheetBounds.x - 7 / Math.max(zoom, 0.05);
                const originY = selectedSheetBounds.y - 7 / Math.max(zoom, 0.05);
                translateSheetSelection(event.target.x() - originX, event.target.y() - originY);
              }}
            />
          )}

          {sheet && marqueeRect && (
            <Rect
              name="sheetAreaSelectionMarquee editorUiOverlay"
              x={marqueeRect.x}
              y={marqueeRect.y}
              width={marqueeRect.width}
              height={marqueeRect.height}
              fill="rgba(56, 189, 248, 0.12)"
              stroke="#38bdf8"
              strokeWidth={1}
              strokeScaleEnabled={false}
              dash={[7 / Math.max(zoom, 0.1), 4 / Math.max(zoom, 0.1)]}
              listening={false}
            />
          )}

          {/* A sheet-space draft sits above the template blocks while it is
              drawn. Once completed it becomes a normal, persistent block. */}
          {sheet && draftShapeSpace === "sheet" && draftShape && (() => {
            const common = {
              name: "editorUiOverlay",
              stroke: draftShape.color,
              strokeWidth: draftShape.stroke_width,
              strokeScaleEnabled: false,
              rotation: draftShape.rotation,
              listening: false,
            };
            if (draftShape.shape_type === "line") {
              return <Line {...common} x={draftShape.x} y={draftShape.y} points={[0, 0, draftShape.width, draftShape.height]} lineCap="round" />;
            }
            if (draftShape.shape_type === "circle") {
              return (
                <Ellipse
                  {...common}
                  x={draftShape.x + draftShape.width / 2}
                  y={draftShape.y + draftShape.height / 2}
                  radiusX={Math.max(1, draftShape.width / 2)}
                  radiusY={Math.max(1, draftShape.height / 2)}
                />
              );
            }
            return (
              <Rect
                {...common}
                x={draftShape.x}
                y={draftShape.y}
                width={Math.max(1, draftShape.width)}
                height={Math.max(1, draftShape.height)}
                fill={draftShape.shape_type === "zone" ? draftShape.color : undefined}
                opacity={draftShape.shape_type === "zone" ? 0.28 : undefined}
                dash={draftShape.shape_type === "zone"
                  ? [10 / Math.max(zoom, 0.05), 6 / Math.max(zoom, 0.05)]
                  : undefined}
              />
            );
          })()}

          {sheet && draftShapeSpace === "sheet" && isPolygonTool(shapeTool) && draftPolygonPoints.length > 0 &&
            renderPolygonZone(
              {
                tempId: "draft-sheet-polygon-zone",
                shape_type: (shapeTool || "polygon_zone") as ShapeKind,
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                rotation: 0,
                stroke_width: shapeStrokeWidth,
                color: shapeColor
              },
              { isDraft: true, previewPoint: polygonCursor }
            )}

          {sheet && isPolygonTool(shapeTool) && renderSmartAlignmentGuide("sheet")}

          {/* Approval layer: the stage remains the single source for preview and
              export. Repeated watermark text never listens to pointer events;
              only the optional BAT block can be selected and moved. */}
          {watermark.enabled && (
            <Group
              name="approvalLayer"
              x={approvalCentre.x}
              y={approvalCentre.y}
              offsetX={approvalCentre.x}
              offsetY={approvalCentre.y}
              rotation={sheet ? 0 : planRotation}
            >
              <Group
                listening={false}
                clipFunc={(context: { rect: (x: number, y: number, width: number, height: number) => void }) => {
                  context.rect(
                    approvalSurface.x,
                    approvalSurface.y,
                    approvalSurface.width,
                    approvalSurface.height
                  );
                }}
              >
                {watermarkPositions.map((position, index) => (
                  <Text
                    key={`approval-watermark-${index}`}
                    x={position.x}
                    y={position.y}
                    offsetX={approvalSurface.width * 0.28}
                    offsetY={watermarkFontSize / 2}
                    width={approvalSurface.width * 0.56}
                    text={watermark.text || "BON À TIRER – POUR VALIDATION UNIQUEMENT"}
                    align="center"
                    fontSize={watermarkFontSize}
                    fontFamily="Arial"
                    fontStyle="bold"
                    fill="#b91c1c"
                    opacity={watermark.repeat ? 0.17 : 0.22}
                    rotation={watermark.diagonal ? -28 : 0}
                    listening={false}
                  />
                ))}
              </Group>

              {watermark.show_bat_block && (
                <Group
                  id={BAT_BLOCK_ID}
                  name={BAT_BLOCK_ID}
                  x={batX}
                  y={batY}
                  width={batWidth}
                  height={batHeight}
                  draggable={mode === "select" && !watermark.block_locked}
                  onMouseDown={selectBatBlock}
                  onTouchStart={selectBatBlock}
                  onClick={selectBatBlock}
                  onTap={selectBatBlock}
                  onDragEnd={(event: { target: { x: () => number; y: () => number } }) => {
                    const nextX = batTravelX
                      ? (event.target.x() - approvalSurface.x) / batTravelX
                      : 0;
                    const nextY = batTravelY
                      ? (event.target.y() - approvalSurface.y) / batTravelY
                      : 0;
                    onWatermarkChange({
                      ...watermark,
                      block_x: Math.min(1, Math.max(0, nextX)),
                      block_y: Math.min(1, Math.max(0, nextY)),
                    });
                  }}
                  onTransformEnd={(event: any) => {
                    if (watermark.block_locked) return;
                    const node = event.target;
                    const scaleX = Math.abs(node.scaleX()) || 1;
                    const scaleY = Math.abs(node.scaleY()) || 1;
                    node.scaleX(1);
                    node.scaleY(1);
                    const newW = Math.max(100, Math.round(batWidth * scaleX));
                    const newH = Math.max(70, Math.round(batHeight * scaleY));
                    const newTravelX = Math.max(0, approvalSurface.width - newW);
                    const newTravelY = Math.max(0, approvalSurface.height - newH);
                    const nextX = newTravelX > 0 ? (node.x() - approvalSurface.x) / newTravelX : 0;
                    const nextY = newTravelY > 0 ? (node.y() - approvalSurface.y) / newTravelY : 0;
                    const safeX = Number.isFinite(nextX) ? Math.min(1, Math.max(0, nextX)) : 0;
                    const safeY = Number.isFinite(nextY) ? Math.min(1, Math.max(0, nextY)) : 0;
                    onWatermarkChange({
                      ...watermark,
                      block_width: newW,
                      block_height: newH,
                      block_x: safeX,
                      block_y: safeY,
                    });
                  }}
                >
                  <Rect
                    width={batWidth}
                    height={batHeight}
                    fill="rgba(255,255,255,0.96)"
                    stroke={selectedBatBlock ? "#2563eb" : "#991b1b"}
                    strokeWidth={selectedBatBlock ? 2 : 2}
                    cornerRadius={6}
                    shadowColor="#000000"
                    shadowBlur={8}
                    shadowOpacity={0.2}
                  />
                  <Rect width={batWidth} height={headerH} fill="#991b1b" cornerRadius={[6, 6, 0, 0]} listening={false} />
                  <Text
                    text="BON À TIRER"
                    width={batWidth}
                    height={headerH}
                    align="center"
                    verticalAlign="middle"
                    fontSize={headerFontSize}
                    fontStyle="bold"
                    fill="#ffffff"
                    listening={false}
                  />
                  {hasBatLogos && (
                    <>
                      {([
                        { key: "client", label: "CLIENT", image: batLogoImages.client, slotX: Math.round(14 * contentScale) },
                        { key: "creator", label: "CRÉATEUR", image: batLogoImages.creator, slotX: batWidth / 2 + Math.round(5 * contentScale) },
                      ] as const).map(({ key, label, image, slotX }) => {
                        if (!image || !image.width || !image.height) return null;
                        const slotWidth = Math.max(20, batWidth / 2 - Math.round(20 * contentScale));
                        const slotHeight = logoSlotHeight;
                        const scale = Math.min(slotWidth / image.width, slotHeight / image.height);
                        const width = image.width * scale;
                        const height = image.height * scale;
                        return (
                          <Group key={`bat-logo-${key}`} x={slotX} y={headerH + 5} listening={false}>
                            <Text
                              text={label}
                              width={slotWidth}
                              align="center"
                              fontSize={Math.max(6, Math.min(11, Math.round(8 * contentScale)))}
                              fontStyle="bold"
                              fill="#6b7280"
                              listening={false}
                            />
                            <KonvaImage
                              image={image}
                              x={(slotWidth - width) / 2}
                              y={Math.round(9 * contentScale) + (slotHeight - height) / 2}
                              width={width}
                              height={height}
                              listening={false}
                            />
                          </Group>
                        );
                      })}
                      {batLogoImages.client && batLogoImages.creator && (
                        <Line
                          points={[batWidth / 2, headerH + 5, batWidth / 2, headerH + 5 + logoSlotHeight]}
                          stroke="#e5e7eb"
                          strokeWidth={1}
                          listening={false}
                        />
                      )}
                    </>
                  )}
                  <Text
                    x={Math.round(16 * contentScale)}
                    y={batInfoY}
                    width={Math.max(40, batWidth - Math.round(32 * contentScale))}
                    height={Math.max(16, batHeight - bottomOffset1 - batInfoY - 4)}
                    text={`Client : ${watermark.client || ""}\nRéférence : ${watermark.reference || ""}\nDate : ${watermark.date || ""}${watermark.comment ? `\nCommentaire : ${watermark.comment}` : ""}`}
                    fontSize={infoFontSize}
                    lineHeight={1.4}
                    fill="#111827"
                    ellipsis
                    listening={false}
                  />
                  <Rect x={Math.round(17 * contentScale)} y={batHeight - bottomOffset1} width={checkboxSize} height={checkboxSize} stroke="#111827" strokeWidth={1.2} listening={false} />
                  <Text x={Math.round(17 * contentScale) + checkboxSize + 8} y={batHeight - bottomOffset1 - 1} text="Validé" fontSize={checkFontSize} fill="#111827" listening={false} />
                  <Rect x={Math.round(17 * contentScale)} y={batHeight - bottomOffset2} width={checkboxSize} height={checkboxSize} stroke="#111827" strokeWidth={1.2} listening={false} />
                  <Text x={Math.round(17 * contentScale) + checkboxSize + 8} y={batHeight - bottomOffset2 - 1} text="Validé avec modifications" fontSize={checkFontSize} fill="#111827" listening={false} />
                  <Text x={Math.round(16 * contentScale)} y={batHeight - bottomOffset3} text="Nom / Signature :" fontSize={sigFontSize} fontStyle="bold" fill="#111827" listening={false} />
                  <Line points={[Math.round(16 * contentScale) + Math.round(105 * contentScale), batHeight - bottomOffsetLine, batWidth - Math.round(16 * contentScale), batHeight - bottomOffsetLine]} stroke="#374151" strokeWidth={1} listening={false} />
                </Group>
              )}
            </Group>
          )}

          {/* Selection Transformer handles resizing & rotation */}
          {mode === "select" && (() => {
            const isPlanOrOverlaySelected = Boolean(
              selectedOverlayId &&
              !selectedIconId &&
              !selectedShapeId &&
              !selectedTextId &&
              !selectedBlockId
            );
            const shouldLockRatio = selectedPictogramRatioLocked || (isPlanOrOverlaySelected ? (keepPlanRatio || shiftPressed) : shiftPressed);

            let selectedNaturalRatio: number | null = null;
            if (isPlanOrOverlaySelected) {
              if (selectedOverlayId === MAIN_PLAN_ID) {
                const nw = bgImage?.naturalWidth || bgImage?.width;
                const nh = bgImage?.naturalHeight || bgImage?.height;
                if (nw && nh) selectedNaturalRatio = nw / nh;
              } else if (selectedOverlayId) {
                const overlay = planOverlays.find((o) => o.tempId === selectedOverlayId);
                const img = overlay ? overlayImages[overlay.tempId] : null;
                const nw = img?.naturalWidth || img?.width || overlay?.width;
                const nh = img?.naturalHeight || img?.height || overlay?.height;
                if (nw && nh) selectedNaturalRatio = nw / nh;
              }
            }

            return (
              <Transformer
                ref={transformerRef}
                flipEnabled={false}
                keepRatio={shouldLockRatio}
                shiftBehavior="none"
                rotateEnabled={selectedOverlayId !== MAIN_PLAN_ID && !selectedSituationFrame && !planBlockSelected && !selectedBatBlock}
                boundBoxFunc={(oldBox, newBox) => {
                  if (Math.abs(newBox.width) < 15 || Math.abs(newBox.height) < 15) {
                    return oldBox;
                  }
                  if (isPlanOrOverlaySelected && (keepPlanRatio || shiftPressed) && selectedNaturalRatio && selectedNaturalRatio > 0) {
                    const absOldW = Math.abs(oldBox.width);
                    const absOldH = Math.abs(oldBox.height);
                    const scaleW = Math.abs(newBox.width) / Math.max(1, absOldW);
                    const scaleH = Math.abs(newBox.height) / Math.max(1, absOldH);
                    const dominantScale = Math.abs(scaleW - 1) > Math.abs(scaleH - 1) ? scaleW : scaleH;
                    const targetW = Math.max(30, absOldW * dominantScale);
                    const targetH = Math.max(30, targetW / selectedNaturalRatio);
                    const signW = newBox.width < 0 ? -1 : 1;
                    const signH = newBox.height < 0 ? -1 : 1;
                    return {
                      x: newBox.x,
                      y: newBox.y,
                      width: targetW * signW,
                      height: targetH * signH,
                      rotation: newBox.rotation,
                    };
                  }
                  return newBox;
                }}
                enabledAnchors={
                  selectedPictogramRatioLocked || (isPlanOrOverlaySelected && keepPlanRatio)
                    ? ["top-left", "top-right", "bottom-right", "bottom-left"]
                    : [
                        "top-left",
                        "top-center",
                        "top-right",
                        "middle-right",
                        "bottom-right",
                        "bottom-center",
                        "bottom-left",
                        "middle-left",
                      ]
                }
                rotateAnchorOffset={20}
                borderStroke="#3b82f6"
                borderStrokeWidth={1}
                anchorStroke="#3b82f6"
                anchorStrokeWidth={1}
                anchorFill="#ffffff"
                anchorSize={8}
              />
            );
          })()}

          {/* Drawing and erasing have priority over every existing object and handle.
              The transparent hit surface forwards events to Stage, preventing
              an old vertex, pictogram or transformer anchor from stealing a
              pointer event intended for the active tool. */}
          {(shapeTool || mode === "erase") && (
            <Rect
              name="drawingInputShield"
              x={-stagePos.x / Math.max(zoom, 0.01)}
              y={-stagePos.y / Math.max(zoom, 0.01)}
              width={stageSize.width / Math.max(zoom, 0.01)}
              height={stageSize.height / Math.max(zoom, 0.01)}
              fill="rgba(0,0,0,0)"
              listening
            />
          )}
        </Layer>
      </Stage>
      )}

      {isPolygonTool(shapeTool) && draftPolygonPoints.length > 0 && (
        <div className="absolute bottom-3 left-1/2 z-30 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-[#202023]/95 p-1.5 text-[11px] text-neutral-200 shadow-2xl backdrop-blur-sm">
          <span className="shrink-0 px-1.5 font-semibold tabular-nums text-neutral-400">
            {draftPolygonPoints.length} point{draftPolygonPoints.length > 1 ? "s" : ""}
          </span>
          <span className={`shrink-0 rounded px-1.5 py-1 text-[10px] font-semibold ${
            shiftPressed ? "bg-emerald-500/20 text-emerald-200" : "bg-white/5 text-neutral-400"
          }`}>
            {shiftPressed ? "Maj actif : Clic pour terminer" : "Maj + Clic : Terminer le tracé"}
          </span>
          <button
            type="button"
            onClick={removeLastPolygonPoint}
            className="shrink-0 cursor-pointer rounded border border-white/10 px-2 py-1.5 font-semibold text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
            title="Supprimer le dernier point (Retour arrière)"
          >
            Supprimer le dernier point
          </button>
          <button
            type="button"
            disabled={draftPolygonPoints.length < (shapeTool === "polyline" ? 2 : 3)}
            onClick={() => finishPolygonDraft(false)}
            className="shrink-0 cursor-pointer rounded bg-sky-600 px-2.5 py-1.5 font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-35"
            title={shapeTool === "curve_polygon_zone"
              ? "Terminer sans relier la fin au début"
              : "Terminer le tracé; la plume reste active pour dessiner la ligne suivante"}
          >
            {shapeTool === "curve_polygon_zone" ? "Terminer ouverte" : "Terminer"}
          </button>
        </div>
      )}

      {/* In-place text editing: a textarea laid over the block being edited, so
          the copy is typed where it will be printed. */}
      {editingBlock && editorBox && (
        <textarea
          autoFocus
          value={editingBlock.text ?? ""}
          onChange={(event) => updateSheetBlock(editingBlock.id, { text: event.target.value })}
          onBlur={() => setEditingBlockId(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setEditingBlockId(null);
            }
            // Enter inserts a line break; Cmd/Ctrl+Enter closes the editor.
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              setEditingBlockId(null);
            }
            event.stopPropagation();
          }}
          style={{
            position: "absolute",
            left: editorBox.left,
            top: editorBox.top,
            width: editorBox.width,
            height: editorBox.height,
            fontSize: editorBox.fontSize,
            lineHeight: editorBox.lineHeight,
            textAlign: editorBox.align,
            color: editorBox.color,
            fontWeight: editorBox.bold ? 700 : 400,
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            textTransform: editingBlock.uppercase ? "uppercase" : "none",
            background: "rgba(255,255,255,0.97)",
            border: "2px solid #3b82f6",
            outline: "none",
            resize: "none",
            padding: 0,
            margin: 0,
            overflow: "hidden",
            zIndex: 20
          }}
        />
      )}

      {editingBlock && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 select-none rounded-md border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-[11px] font-medium text-sky-200 backdrop-blur-sm">
          Saisie directe &middot; Échap ou clic ailleurs pour terminer
        </div>
      )}

      {placementIconType && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 select-none rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-[11px] font-medium text-emerald-300 backdrop-blur-sm">
          {sheet
            ? "Cliquez sur le plan pour l'équipement, ailleurs sur la feuille pour un pictogramme libre · Échap pour annuler"
            : "Cliquez sur le plan pour placer l'équipement · Échap pour annuler"}
        </div>
      )}

      {mode === "erase" && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 select-none rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-[11px] font-medium text-amber-300 backdrop-blur-sm">
          {eraserTarget === "lines"
            ? "Gomme Ouvertures · glissez sur une ligne pour créer le passage de porte"
            : "Gomme Fond du plan · glissez sur l’image pour effacer"}
        </div>
      )}
    </div>
  );
}

export default PlanCanvas;
