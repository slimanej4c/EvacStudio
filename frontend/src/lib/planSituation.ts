import type { PlanDocumentType } from "@/lib/planCompliance";
import type { SheetBlock } from "@/lib/sheetTemplates";

export const PLAN_SITUATION_BLOCK_PREFIX = "plan-situation:";
export const PLAN_SITUATION_FRAME_ID = `${PLAN_SITUATION_BLOCK_PREFIX}frame`;
export const PLAN_SITUATION_BACKGROUND_ID = `${PLAN_SITUATION_BLOCK_PREFIX}background`;
export const PLAN_SITUATION_IMAGE_KEY = "planSituationBackground";

export type PlanSituationRole = NonNullable<SheetBlock["situationRole"]>;
export type PlanSituationOrientationMode = "manual" | "observer";

export interface PlanSituationState {
  version: 1;
  enabled: boolean;
  visible: boolean;
  locked: boolean;
  sectorial: boolean;
  auto_refresh_visible_area: boolean;
  orientation: number;
  orientation_mode: PlanSituationOrientationMode;
  /** Maximum share of the usable frame occupied by traced geometry. */
  content_width_percent: number;
  content_height_percent: number;
  /** Opacity of the highlighted sector traced on the source plan. */
  zone_opacity_percent: number;
  blocks: SheetBlock[];
}

export interface PlanSituationAuditItem {
  severity: "error" | "warning" | "manual" | "ok";
  message: string;
}

export const EMPTY_PLAN_SITUATION: PlanSituationState = {
  version: 1,
  enabled: false,
  visible: true,
  locked: false,
  sectorial: false,
  auto_refresh_visible_area: true,
  orientation: 0,
  orientation_mode: "observer",
  content_width_percent: 90,
  content_height_percent: 82,
  zone_opacity_percent: 35,
  blocks: [],
};

const finite = (value: unknown, fallback: number) => (
  typeof value === "number" && Number.isFinite(value) ? value : fallback
);

const cloneBlocks = (blocks: SheetBlock[]) => blocks.map((block) => ({
  ...block,
  shapePoints: block.shapePoints?.map((point) => ({ ...point })),
  shapeControlPoints: block.shapeControlPoints
    ? Object.fromEntries(Object.entries(block.shapeControlPoints).map(([key, point]) => [key, { ...point }]))
    : undefined,
  shapeStraightSegments: block.shapeStraightSegments ? [...block.shapeStraightSegments] : undefined,
  situationSourcePoints: block.situationSourcePoints?.map((point) => ({ ...point })),
  situationIsSilhouette: block.situationIsSilhouette,
}));

const boundedPercent = (value: unknown, fallback: number, minimum: number) => (
  Math.max(minimum, Math.min(100, finite(value, fallback)))
);

export function isPlanSituationBlock(block: SheetBlock) {
  return block.planSpecificKind === "situation"
    || block.id.startsWith(PLAN_SITUATION_BLOCK_PREFIX);
}

export function isPlanSituationMovableElement(block: SheetBlock): boolean {
  if (!isPlanSituationBlock(block)) return false;
  if (
    block.id === PLAN_SITUATION_FRAME_ID ||
    block.id === PLAN_SITUATION_BACKGROUND_ID ||
    block.situationRole === "frame" ||
    block.situationRole === "background" ||
    block.situationRole === "building_outline" ||
    block.situationRole === "represented_zone" ||
    block.situationIsSilhouette === true
  ) {
    return false;
  }
  return true;
}

export function stripPlanSituationBlocks(blocks: SheetBlock[]) {
  return blocks.filter((block) => !isPlanSituationBlock(block));
}

export function situationBlocksFromSheet(blocks: SheetBlock[]) {
  return blocks.filter(isPlanSituationBlock);
}

export function normalizePlanSituation(value?: Partial<PlanSituationState> | null): PlanSituationState {
  if (!value || !Array.isArray(value.blocks)) {
    return {
      ...EMPTY_PLAN_SITUATION,
      visible: value?.visible !== false,
      locked: Boolean(value?.locked),
      sectorial: Boolean(value?.sectorial),
      auto_refresh_visible_area: value?.auto_refresh_visible_area !== false,
      orientation: finite(value?.orientation, 0),
      orientation_mode: value?.orientation_mode === "manual" ? "manual" : "observer",
      content_width_percent: boundedPercent(value?.content_width_percent, 90, 20),
      content_height_percent: boundedPercent(value?.content_height_percent, 82, 20),
      zone_opacity_percent: boundedPercent(value?.zone_opacity_percent, 35, 5),
    };
  }
  const blocks = value.blocks
    .filter((block): block is SheetBlock => Boolean(
      block
      && typeof block.id === "string"
      && block.id.startsWith(PLAN_SITUATION_BLOCK_PREFIX)
    ))
    .slice(0, 100)
    .map((block) => ({
      ...block,
      planSpecificKind: "situation" as const,
      x: finite(block.x, 0),
      y: finite(block.y, 0),
      width: Math.max(1, finite(block.width, 40)),
      height: Math.max(1, finite(block.height, 40)),
      rotation: finite(block.rotation, 0),
      visible: block.visible !== false,
      situationSourcePoints: block.situationSourcePoints
        ?.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
        .slice(0, 500)
        .map((point) => ({ x: point.x, y: point.y })),
      situationIsSilhouette: block.situationIsSilhouette ?? (
        block.situationRole === "building_outline" || block.id.includes("building_outline")
          ? true
          : undefined
      ),
    }));
  const frame = blocks.find((block) => block.id === PLAN_SITUATION_FRAME_ID);
  return {
    version: 1,
    enabled: Boolean(value.enabled && frame),
    visible: value.visible !== false,
    locked: Boolean(value.locked),
    sectorial: Boolean(value.sectorial),
    auto_refresh_visible_area: value.auto_refresh_visible_area !== false,
    orientation: finite(value.orientation, 0),
    orientation_mode: value.orientation_mode === "manual" ? "manual" : "observer",
    content_width_percent: boundedPercent(value.content_width_percent, 90, 20),
    content_height_percent: boundedPercent(value.content_height_percent, 82, 20),
    zone_opacity_percent: boundedPercent(value.zone_opacity_percent, 35, 5),
    blocks,
  };
}

export function planSituationFrame(state: PlanSituationState) {
  return state.blocks.find((block) => block.id === PLAN_SITUATION_FRAME_ID) ?? null;
}

export function isPointInsidePlanSituationFrame(
  point: { x: number; y: number },
  state: PlanSituationState,
): boolean {
  if (!state.enabled || !state.visible) return false;
  const frame = planSituationFrame(state);
  if (!frame) return false;
  const local = rotatePoint(point.x - frame.x, point.y - frame.y, -frame.rotation);
  return local.x >= 0 && local.x <= frame.width && local.y >= 0 && local.y <= frame.height;
}

export function createPlanSituation(
  sheetWidth: number,
  sheetHeight: number,
  initialOrientation: number = 0,
): PlanSituationState {
  const portrait = sheetHeight > sheetWidth;
  const width = portrait ? 330 : 390;
  const height = portrait ? 275 : 235;
  const frame: SheetBlock = {
    id: PLAN_SITUATION_FRAME_ID,
    kind: "text",
    planSpecificKind: "situation",
    situationRole: "frame",
    label: "Plan de situation",
    x: Math.max(18, sheetWidth - width - 24),
    y: Math.max(18, sheetHeight - height - 24),
    width,
    height,
    rotation: 0,
    visible: true,
    locked: false,
    title: "PLAN DE SITUATION",
    text: "",
    fill: "#ffffff",
    stroke: "#111827",
    strokeWidth: 2,
    color: "#111827",
    padding: 8,
    titleFill: "#f3f4f6",
    titleColor: "#111827",
    titleFontSize: 13,
    titleHeight: 28,
    titleAlign: "center",
    titleRule: true,
  };
  const normalizedOrientation = ((initialOrientation % 360) + 360) % 360;
  return {
    ...EMPTY_PLAN_SITUATION,
    enabled: true,
    orientation: normalizedOrientation,
    orientation_mode: "observer",
    blocks: [frame],
  };
}

export type PlanSituationSourcePoint = { x: number; y: number };
type SourcePoint = PlanSituationSourcePoint;
type TraceRole = "building_outline" | "represented_zone";

function sourceBounds(points: SourcePoint[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    x: left,
    y: top,
    width: Math.max(1, Math.max(...xs) - left),
    height: Math.max(1, Math.max(...ys) - top),
  };
}

function tracedGeometryTransform(state: PlanSituationState, outlinePoints: SourcePoint[]) {
  const frame = planSituationFrame(state);
  if (!frame) return null;
  const bounds = sourceBounds(outlinePoints);
  const titleHeight = frame.title ? frame.titleHeight ?? 28 : 0;
  const usable = {
    x: 12,
    y: titleHeight + 12,
    width: Math.max(20, frame.width - 24),
    height: Math.max(20, frame.height - titleHeight - 24),
  };
  const maximumWidth = usable.width * state.content_width_percent / 100;
  const maximumHeight = usable.height * state.content_height_percent / 100;
  const scale = Math.min(maximumWidth / bounds.width, maximumHeight / bounds.height);
  return {
    frame,
    bounds,
    scale,
    localX: usable.x + (usable.width - bounds.width * scale) / 2,
    localY: usable.y + (usable.height - bounds.height * scale) / 2,
  };
}

export interface TraceIntoPlanSituationOptions {
  targetBlockId?: string;
  append?: boolean;
  label?: string;
}

export function isSituationSilhouette(block: SheetBlock, allBlocks?: SheetBlock[]): boolean {
  if ((block.situationSourcePoints?.length ?? 0) < 3) return false;
  if (block.situationIsSilhouette === true) return true;
  if (block.situationIsSilhouette === false) return false;
  if (block.situationRole === "building_outline") return true;
  if (block.id.includes("building_outline")) return true;
  if (block.situationRole === "represented_zone") {
    // If there is another building_outline among the blocks, this represented_zone is a sub-zone
    if (allBlocks && allBlocks.some((b) => b.id !== block.id && (b.situationRole === "building_outline" || b.situationIsSilhouette === true || b.id.includes("building_outline")))) {
      return false;
    }
    return true;
  }
  return false;
}

export function getSituationSilhouettes(state: PlanSituationState): SheetBlock[] {
  return state.blocks.filter((block) => isSituationSilhouette(block, state.blocks));
}

/**
 * Refit traced vector geometry inside the situation frame. Only the saved
 * plan-space points are used, so browser zoom and canvas pan never affect it.
 * The traced silhouettes and represented zone rotate by the frame-relative
 * orientation to remain aligned with the main plan's observer angle.
 * When multiple silhouettes exist, they are all framed together preserving
 * their exact relative distances, sizes, and positioning.
 */
export function refitPlanSituationTraces(
  state: PlanSituationState,
  changes: Partial<Pick<PlanSituationState, "content_width_percent" | "content_height_percent" | "zone_opacity_percent" | "orientation" | "orientation_mode" | "auto_refresh_visible_area">> = {},
) {
  const configured = normalizePlanSituation({ ...state, ...changes });
  const traceBlocks = configured.blocks.filter(
    (block) => (block.situationRole === "building_outline" || block.situationRole === "represented_zone")
      && (block.situationSourcePoints?.length ?? 0) >= 3,
  );
  if (!traceBlocks.length) return configured;
  const frame = planSituationFrame(configured);
  if (!frame) return configured;

  const traceRotation = ((configured.orientation - (frame.rotation ?? 0)) % 360 + 360) % 360;
  const allSourcePoints = traceBlocks.flatMap((b) => b.situationSourcePoints ?? []);
  const rawSiteBounds = sourceBounds(allSourcePoints);
  const center = {
    x: rawSiteBounds.x + rawSiteBounds.width / 2,
    y: rawSiteBounds.y + rawSiteBounds.height / 2,
  };

  const rotateAroundCenter = (point: SourcePoint, degrees: number): SourcePoint => {
    if (degrees % 360 === 0) return { ...point };
    const rotated = rotatePoint(point.x - center.x, point.y - center.y, degrees);
    return { x: center.x + rotated.x, y: center.y + rotated.y };
  };

  const allRotatedPoints = allSourcePoints.map((point) => rotateAroundCenter(point, traceRotation));
  const rotatedSiteBounds = sourceBounds(allRotatedPoints);

  const titleHeight = frame.title ? frame.titleHeight ?? 28 : 0;
  const usable = {
    x: 12,
    y: titleHeight + 12,
    width: Math.max(20, frame.width - 24),
    height: Math.max(20, frame.height - titleHeight - 24),
  };
  const maximumWidth = usable.width * configured.content_width_percent / 100;
  const maximumHeight = usable.height * configured.content_height_percent / 100;
  const scale = Math.min(maximumWidth / rotatedSiteBounds.width, maximumHeight / rotatedSiteBounds.height);
  const localX = usable.x + (usable.width - rotatedSiteBounds.width * scale) / 2;
  const localY = usable.y + (usable.height - rotatedSiteBounds.height * scale) / 2;

  const blocks = configured.blocks.map((block) => {
    const points = block.situationSourcePoints;
    if (
      (block.situationRole !== "building_outline" && block.situationRole !== "represented_zone")
      || !points
      || points.length < 3
    ) return block;
    const rotatedPoints = points.map((point) => rotateAroundCenter(point, traceRotation));
    const bounds = sourceBounds(rotatedPoints);
    const local = {
      x: localX + (bounds.x - rotatedSiteBounds.x) * scale,
      y: localY + (bounds.y - rotatedSiteBounds.y) * scale,
    };
    const world = rotatePoint(local.x, local.y, frame.rotation);
    return {
      ...block,
      x: frame.x + world.x,
      y: frame.y + world.y,
      width: Math.max(4, bounds.width * scale),
      height: Math.max(4, bounds.height * scale),
      rotation: frame.rotation,
      shapePoints: rotatedPoints.map((point) => ({
        x: (point.x - bounds.x) / bounds.width,
        y: (point.y - bounds.y) / bounds.height,
      })),
      ...(block.situationRole === "represented_zone"
        ? { fillOpacity: configured.zone_opacity_percent / 100 }
        : {}),
    };
  });
  return { ...configured, blocks };
}

/** Convert a closed contour from the main plan into background-free SVG-like geometry. */
export function traceIntoPlanSituation(
  state: PlanSituationState,
  role: TraceRole,
  points: SourcePoint[],
  options?: TraceIntoPlanSituationOptions,
) {
  if (points.length < 3 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return state;
  }
  const silhouettes = getSituationSilhouettes(state);
  const hasOutlines = silhouettes.length > 0;
  if (role === "represented_zone" && !hasOutlines && !options?.targetBlockId) {
    return state;
  }
  const normalizedPoints = points.map((point) => ({ x: point.x, y: point.y }));

  // 1. If targetBlockId is provided, update that specific existing block
  if (options?.targetBlockId) {
    const existingIndex = state.blocks.findIndex((b) => b.id === options.targetBlockId);
    if (existingIndex !== -1) {
      const existing = state.blocks[existingIndex];
      const updatedBlock: SheetBlock = {
        ...existing,
        situationSourcePoints: normalizedPoints,
        ...(options.label ? { label: options.label } : {}),
      };
      const newBlocks = [...state.blocks];
      newBlocks[existingIndex] = updatedBlock;
      return refitPlanSituationTraces({ ...state, blocks: newBlocks });
    }
  }

  // 2. Tracing building outline
  if (role === "building_outline") {
    const count = silhouettes.length;
    const defaultLabel = count === 0 ? "Silhouette du bâtiment" : `Silhouette ${count + 1}`;
    const newBlock: SheetBlock = {
      id: blockId("building_outline"),
      kind: "shape",
      planSpecificKind: "situation",
      situationRole: "building_outline",
      situationIsSilhouette: true,
      label: options?.label || defaultLabel,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: state.orientation,
      visible: true,
      locked: false,
      shapeType: "polygon_zone",
      shapePoints: [],
      shapeClosed: true,
      situationSourcePoints: normalizedPoints,
      fill: "#e5e7eb",
      fillOpacity: 0.75,
      stroke: "#111827",
      strokeWidth: 1,
    };

    if (options?.append) {
      const frameIndex = state.blocks.findIndex((candidate) => candidate.id === PLAN_SITUATION_FRAME_ID);
      let lastOutlineIndex = frameIndex;
      for (let i = state.blocks.length - 1; i >= 0; i--) {
        if (state.blocks[i].situationRole === "building_outline" || state.blocks[i].situationIsSilhouette) {
          lastOutlineIndex = i;
          break;
        }
      }
      const newBlocks = [...state.blocks];
      newBlocks.splice(Math.max(0, lastOutlineIndex + 1), 0, newBlock);
      return refitPlanSituationTraces({ ...state, blocks: newBlocks });
    }

    // Default: initial trace or replace single outline
    const replaced = state.blocks.filter((candidate) => (
      candidate.situationRole !== "building_outline"
      && !(candidate.situationRole === "represented_zone" && !candidate.situationIsSilhouette)
    ));
    const frameIndex = replaced.findIndex((candidate) => candidate.id === PLAN_SITUATION_FRAME_ID);
    replaced.splice(Math.max(0, frameIndex + 1), 0, newBlock);
    return refitPlanSituationTraces({ ...state, blocks: replaced });
  }

  // 3. Tracing represented zone (subzone)
  const zoneBlock: SheetBlock = {
    id: blockId("represented_zone"),
    kind: "shape",
    planSpecificKind: "situation",
    situationRole: "represented_zone",
    situationIsSilhouette: false,
    label: options?.label || "Zone représentée",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: state.orientation,
    visible: true,
    locked: false,
    shapeType: "polygon_zone",
    shapePoints: [],
    shapeClosed: true,
    situationSourcePoints: normalizedPoints,
    fill: "#6b7280",
    fillOpacity: state.zone_opacity_percent / 100,
    stroke: "#4b5563",
    strokeWidth: 1,
  };

  // Remove any previous non-silhouette subzone
  const remaining = state.blocks.filter((candidate) => (
    candidate.situationRole !== "represented_zone" || candidate.situationIsSilhouette === true
  ));
  // If a silhouette was previously marked as represented_zone, revert it back to building_outline
  // so the subzone contrasts on top of it
  const normalizedRemaining = remaining.map((candidate) => {
    if (candidate.situationIsSilhouette && candidate.situationRole === "represented_zone") {
      return {
        ...candidate,
        situationRole: "building_outline" as const,
        fill: "#e5e7eb",
        stroke: "#111827",
        fillOpacity: 0.75,
      };
    }
    return candidate;
  });

  const frameIndex = normalizedRemaining.findIndex((candidate) => candidate.id === PLAN_SITUATION_FRAME_ID);
  let lastOutlineIndex = -1;
  for (let i = normalizedRemaining.length - 1; i >= 0; i--) {
    if (normalizedRemaining[i].situationRole === "building_outline" || normalizedRemaining[i].situationIsSilhouette) {
      lastOutlineIndex = i;
      break;
    }
  }
  const insertAt = Math.max(frameIndex + 1, lastOutlineIndex + 1);
  normalizedRemaining.splice(insertAt, 0, zoneBlock);
  return refitPlanSituationTraces({ ...state, blocks: normalizedRemaining });
}

/**
 * Select a specific building silhouette as the represented zone on the site.
 * Highlight it in dark grey (#6b7280) and set any other building outlines back to light grey (#e5e7eb).
 */
export function selectPlanSituationRepresentedOutline(
  state: PlanSituationState,
  outlineId: string,
): PlanSituationState {
  const target = state.blocks.find((b) => b.id === outlineId);
  if (!target || !target.situationSourcePoints) return state;

  // Remove any non-silhouette subzone
  const filteredBlocks = state.blocks.filter(
    (b) => !(b.situationRole === "represented_zone" && !b.situationIsSilhouette && b.id !== outlineId),
  );

  const updatedBlocks = filteredBlocks.map((block) => {
    if (block.id === outlineId) {
      return {
        ...block,
        situationRole: "represented_zone" as const,
        situationIsSilhouette: true,
        fill: "#6b7280",
        stroke: "#4b5563",
        fillOpacity: state.zone_opacity_percent / 100,
      };
    }
    if (block.situationIsSilhouette || block.situationRole === "building_outline" || block.situationRole === "represented_zone") {
      return {
        ...block,
        situationRole: "building_outline" as const,
        situationIsSilhouette: true,
        fill: "#e5e7eb",
        stroke: "#111827",
        fillOpacity: 0.75,
      };
    }
    return block;
  });

  return refitPlanSituationTraces({
    ...state,
    sectorial: true,
    blocks: updatedBlocks,
  });
}

/** Remove a specific building silhouette or element from the situation plan. */
export function removePlanSituationBlock(
  state: PlanSituationState,
  blockId: string,
): PlanSituationState {
  const nextBlocks = state.blocks.filter((block) => block.id !== blockId);
  return refitPlanSituationTraces({ ...state, blocks: nextBlocks });
}

/** Update the user-facing label of a situation plan silhouette or element. */
export function updatePlanSituationBlockLabel(
  state: PlanSituationState,
  blockId: string,
  label: string,
): PlanSituationState {
  const nextBlocks = state.blocks.map((block) => (
    block.id === blockId ? { ...block, label } : block
  ));
  return { ...state, blocks: nextBlocks };
}

const crossProduct = (left: SourcePoint, right: SourcePoint) => (
  left.x * right.y - left.y * right.x
);

function polygonSignedArea(points: SourcePoint[]) {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function lineIntersection(
  start: SourcePoint,
  end: SourcePoint,
  clipStart: SourcePoint,
  clipEnd: SourcePoint,
) {
  const clipDirection = {
    x: clipEnd.x - clipStart.x,
    y: clipEnd.y - clipStart.y,
  };
  const subjectDirection = {
    x: end.x - start.x,
    y: end.y - start.y,
  };
  const denominator = crossProduct(clipDirection, subjectDirection);
  if (Math.abs(denominator) < 1e-9) return { ...end };
  const fromStartToClip = {
    x: clipStart.x - start.x,
    y: clipStart.y - start.y,
  };
  const distance = crossProduct(clipDirection, fromStartToClip) / denominator;
  return {
    x: start.x + subjectDirection.x * distance,
    y: start.y + subjectDirection.y * distance,
  };
}

/**
 * Clip an arbitrary traced silhouette with the convex polygon corresponding
 * to the current plan window. The viewport is normally a rectangle, but using
 * its four transformed corners keeps the calculation valid if the canvas
 * transform changes later.
 */
export function clipPlanSituationPolygon(
  subjectPolygon: SourcePoint[],
  clipPolygon: SourcePoint[],
) {
  if (subjectPolygon.length < 3 || clipPolygon.length < 3) return [];
  if (
    [...subjectPolygon, ...clipPolygon].some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  ) return [];

  const orientation = polygonSignedArea(clipPolygon) >= 0 ? 1 : -1;
  let output = subjectPolygon.map((point) => ({ ...point }));

  clipPolygon.forEach((clipStart, index) => {
    const clipEnd = clipPolygon[(index + 1) % clipPolygon.length];
    const edge = { x: clipEnd.x - clipStart.x, y: clipEnd.y - clipStart.y };
    const isInside = (point: SourcePoint) => orientation * crossProduct(edge, {
      x: point.x - clipStart.x,
      y: point.y - clipStart.y,
    }) >= -1e-7;
    const input = output;
    output = [];
    if (!input.length) return;
    let previous = input[input.length - 1];

    input.forEach((current) => {
      const currentInside = isInside(current);
      const previousInside = isInside(previous);
      if (currentInside) {
        if (!previousInside) {
          output.push(lineIntersection(previous, current, clipStart, clipEnd));
        }
        output.push({ ...current });
      } else if (previousInside) {
        output.push(lineIntersection(previous, current, clipStart, clipEnd));
      }
      previous = current;
    });
  });

  const deduplicated = output.filter((point, index) => {
    const previous = output[(index - 1 + output.length) % output.length];
    return Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-6;
  });
  return Math.abs(polygonSignedArea(deduplicated)) > 1e-6 ? deduplicated : [];
}

/**
 * Freeze the part of the traced building currently shown by the main plan.
 * Nothing calls this automatically: moving or zooming the plan leaves the
 * stored grey zone untouched until the user explicitly refreshes it again.
 */
export function refreshPlanSituationVisibleArea(
  state: PlanSituationState,
  visiblePlanPolygon: SourcePoint[],
): PlanSituationState | null {
  const silhouettes = getSituationSilhouettes(state);
  if (!silhouettes.length) return null;

  // Calculate intersection of visiblePlanPolygon with each silhouette
  const visibilityList = silhouettes.map((outline) => {
    if (!outline.situationSourcePoints || outline.situationSourcePoints.length < 3) {
      return { outline, clipped: [] as SourcePoint[], outlineArea: 0, clippedArea: 0, ratio: 0 };
    }
    const outlineArea = Math.abs(polygonSignedArea(outline.situationSourcePoints));
    const clipped = clipPlanSituationPolygon(outline.situationSourcePoints, visiblePlanPolygon);
    const clippedArea = clipped.length >= 3 ? Math.abs(polygonSignedArea(clipped)) : 0;
    const ratio = outlineArea > 0 ? clippedArea / outlineArea : 0;
    return { outline, clipped, outlineArea, clippedArea, ratio };
  });

  // If no silhouette intersects the visible plan window, return null
  const anyVisible = visibilityList.some((v) => v.ratio >= 0.01);
  if (!anyVisible) return null;

  // Remove all existing non-silhouette subzones
  const baseBlocks = state.blocks.filter(
    (b) => !(b.situationRole === "represented_zone" && !b.situationIsSilhouette),
  );

  const subzonesToAdd: SheetBlock[] = [];

  const newBlocks = baseBlocks.map((block) => {
    const vis = visibilityList.find((v) => v.outline.id === block.id);
    if (!vis) return block;

    if (vis.ratio >= 0.90) {
      // Silhouette is fully (or almost fully >= 90%) visible in the canvas viewport
      return {
        ...block,
        situationRole: "represented_zone" as const,
        situationIsSilhouette: true,
        fill: "#6b7280",
        stroke: "#4b5563",
        fillOpacity: state.zone_opacity_percent / 100,
      };
    } else if (vis.ratio >= 0.01) {
      // Silhouette is partially visible: base silhouette is building_outline,
      // and a subzone represented_zone is added with the exact clipped points
      const subzone: SheetBlock = {
        id: blockId("represented_zone"),
        kind: "shape",
        planSpecificKind: "situation",
        situationRole: "represented_zone",
        situationIsSilhouette: false,
        label: `${block.label || "Zone"} (visible)`,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: state.orientation,
        visible: true,
        locked: false,
        shapeType: "polygon_zone",
        shapePoints: [],
        shapeClosed: true,
        situationSourcePoints: vis.clipped,
        fill: "#6b7280",
        fillOpacity: state.zone_opacity_percent / 100,
        stroke: "#4b5563",
        strokeWidth: 1,
      };
      subzonesToAdd.push(subzone);

      return {
        ...block,
        situationRole: "building_outline" as const,
        situationIsSilhouette: true,
        fill: "#e5e7eb",
        stroke: "#111827",
        fillOpacity: 0.75,
      };
    } else {
      // Silhouette is not visible in the canvas viewport
      return {
        ...block,
        situationRole: "building_outline" as const,
        situationIsSilhouette: true,
        fill: "#e5e7eb",
        stroke: "#111827",
        fillOpacity: 0.75,
      };
    }
  });

  // Insert subzones right after the silhouettes
  let lastOutlineIndex = newBlocks.findIndex((b) => b.id === PLAN_SITUATION_FRAME_ID);
  for (let i = newBlocks.length - 1; i >= 0; i--) {
    if (newBlocks[i].situationRole === "building_outline" || newBlocks[i].situationIsSilhouette) {
      lastOutlineIndex = i;
      break;
    }
  }
  newBlocks.splice(Math.max(0, lastOutlineIndex + 1), 0, ...subzonesToAdd);

  return refitPlanSituationTraces({
    ...state,
    blocks: newBlocks,
  });
}

export function decorateWithPlanSituation(
  reusableBlocks: SheetBlock[],
  state: PlanSituationState,
) {
  const base = stripPlanSituationBlocks(reusableBlocks);
  if (!state.enabled || !state.visible) return base;
  return [
    ...base,
    ...cloneBlocks(state.blocks).map((block) => {
      const isProtectedGeometry =
        block.situationRole === "building_outline"
        || block.situationRole === "represented_zone"
        || block.situationIsSilhouette === true
        || block.situationRole === "background"
        || block.id === PLAN_SITUATION_BACKGROUND_ID;

      const isFrame = block.id === PLAN_SITUATION_FRAME_ID || block.situationRole === "frame";

      return {
        ...block,
        locked: isProtectedGeometry ? true : Boolean(block.locked),
      };
    }),
  ];
}

export function blockId(role: PlanSituationRole) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return `${PLAN_SITUATION_BLOCK_PREFIX}${role}:${suffix}`;
}

function nextElementPosition(state: PlanSituationState, width: number, height: number) {
  const frame = planSituationFrame(state);
  if (!frame) return { x: 40, y: 40 };
  const index = state.blocks.filter((block) => block.situationRole !== "frame" && block.situationRole !== "background").length;
  const innerTop = frame.y + (frame.titleHeight ?? 28) + 12;
  const innerHeight = Math.max(40, frame.height - (frame.titleHeight ?? 28) - 24);
  const columns = Math.max(1, Math.floor((frame.width - 24) / 76));
  const local = {
    x: 12 + (index % columns) * 70,
    y: innerTop - frame.y + (Math.floor(index / columns) * 58) % Math.max(58, innerHeight - height),
  };
  const world = rotatePoint(local.x, local.y, frame.rotation);
  return { x: frame.x + world.x, y: frame.y + world.y };
}

export function upsertPlanSituationBackground(state: PlanSituationState) {
  const frame = planSituationFrame(state);
  if (!frame) return state;
  const titleHeight = frame.title ? frame.titleHeight ?? 28 : 0;
  const local = { x: 8, y: titleHeight + 8 };
  const world = rotatePoint(local.x, local.y, frame.rotation);
  const background: SheetBlock = {
    id: PLAN_SITUATION_BACKGROUND_ID,
    kind: "image",
    planSpecificKind: "situation",
    situationRole: "background",
    label: "Fond du plan de situation",
    x: frame.x + world.x,
    y: frame.y + world.y,
    width: Math.max(40, frame.width - 16),
    height: Math.max(40, frame.height - titleHeight - 16),
    rotation: frame.rotation,
    visible: true,
    locked: false,
    imageKey: PLAN_SITUATION_IMAGE_KEY,
  };
  const blocks = state.blocks.filter((block) => block.id !== PLAN_SITUATION_BACKGROUND_ID);
  const frameIndex = blocks.findIndex((block) => block.id === PLAN_SITUATION_FRAME_ID);
  blocks.splice(Math.max(0, frameIndex), 0, background);
  return { ...state, blocks };
}

export function removePlanSituationBackground(state: PlanSituationState) {
  return {
    ...state,
    blocks: state.blocks.filter((block) => block.id !== PLAN_SITUATION_BACKGROUND_ID),
  };
}

export function addPlanSituationPictogram(
  state: PlanSituationState,
  iconType: string,
  label: string,
  role: PlanSituationRole = "pictogram",
) {
  const size = 42;
  const position = nextElementPosition(state, size, size);
  const block: SheetBlock = {
    id: blockId(role),
    kind: "picto",
    planSpecificKind: "situation",
    situationRole: role,
    label,
    ...position,
    width: size,
    height: size,
    rotation: state.orientation,
    visible: true,
    locked: false,
    iconType,
    lockAspectRatio: true,
  };
  return { ...state, blocks: [...state.blocks, block] };
}

export function addPlanSituationElement(
  state: PlanSituationState,
  role: Exclude<PlanSituationRole, "frame" | "background" | "pictogram" | "assembly_point" | "observer" | "remote_equipment">,
) {
  const common = {
    id: blockId(role),
    planSpecificKind: "situation" as const,
    situationRole: role,
    rotation: state.orientation,
    visible: true,
    locked: false,
  };
  let block: SheetBlock;
  if (role === "represented_zone") {
    block = {
      ...common,
      kind: "shape",
      label: "Zone représentée",
      ...nextElementPosition(state, 118, 72),
      width: 118,
      height: 72,
      shapeType: "zone",
      shapePoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      shapeClosed: true,
      fill: "#f59e0b",
      fillOpacity: 0.2,
      stroke: "#c2410c",
      strokeWidth: 1,
    };
  } else if (role === "road") {
    block = {
      ...common,
      kind: "shape",
      label: "Route",
      ...nextElementPosition(state, 145, 28),
      width: 145,
      height: 28,
      shapeType: "line",
      shapePoints: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
      stroke: "#4b5563",
      strokeWidth: 10,
    };
  } else if (role === "building" || role === "other_building") {
    block = {
      ...common,
      kind: "text",
      label: role === "building" ? "Bâtiment concerné" : "Autre bâtiment",
      text: role === "building" ? "BÂTIMENT CONCERNÉ" : "AUTRE BÂTIMENT",
      ...nextElementPosition(state, 112, 62),
      width: 112,
      height: 62,
      fill: role === "building" ? "#dbeafe" : "#e5e7eb",
      stroke: role === "building" ? "#2563eb" : "#6b7280",
      strokeWidth: 1,
      color: "#111827",
      fontSize: 10,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      padding: 5,
    };
  } else if (role === "parking") {
    block = {
      ...common,
      kind: "text",
      label: "Parking",
      text: "P",
      ...nextElementPosition(state, 46, 46),
      width: 46,
      height: 46,
      fill: "#2563eb",
      stroke: "#ffffff",
      strokeWidth: 1,
      color: "#ffffff",
      fontSize: 28,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
    };
  } else if (role === "arrow") {
    block = {
      ...common,
      kind: "text",
      label: "Flèche",
      text: "➜",
      ...nextElementPosition(state, 65, 42),
      width: 65,
      height: 42,
      color: "#111827",
      fontSize: 34,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
    };
  } else {
    block = {
      ...common,
      kind: "text",
      label: "Texte du plan de situation",
      text: "Texte",
      ...nextElementPosition(state, 110, 42),
      width: 110,
      height: 42,
      fill: "#ffffff",
      stroke: "#9ca3af",
      strokeWidth: 1,
      color: "#111827",
      fontSize: 12,
      align: "center",
      verticalAlign: "middle",
      padding: 5,
    };
  }
  return { ...state, blocks: [...state.blocks, block] };
}

function rotatePoint(x: number, y: number, degrees: number) {
  const radians = degrees * Math.PI / 180;
  return {
    x: x * Math.cos(radians) - y * Math.sin(radians),
    y: x * Math.sin(radians) + y * Math.cos(radians),
  };
}

export function transformSituationChildrenForFrame(
  previousBlocks: SheetBlock[],
  nextBlocks: SheetBlock[],
) {
  const previousFrame = previousBlocks.find((block) => block.id === PLAN_SITUATION_FRAME_ID);
  const nextFrame = nextBlocks.find((block) => block.id === PLAN_SITUATION_FRAME_ID);
  if (!previousFrame || !nextFrame) return nextBlocks;
  const changed = (["x", "y", "width", "height", "rotation"] as const).some(
    (field) => previousFrame[field] !== nextFrame[field],
  );
  if (!changed) return nextBlocks;

  const resized = previousFrame.width !== nextFrame.width || previousFrame.height !== nextFrame.height;
  const rotationDelta = nextFrame.rotation - previousFrame.rotation;

  return nextBlocks.map((block) => {
    if (block.id === PLAN_SITUATION_FRAME_ID) return block;
    const previous = previousBlocks.find((candidate) => candidate.id === block.id) ?? block;

    // Enlarging the frame must create actual free space for parking, assembly
    // points and access routes. Keep all existing contents at their exact size
    // and position instead of stretching them with the frame handles.
    if (resized) {
      return {
        ...block,
        x: previous.x,
        y: previous.y,
        width: previous.width,
        height: previous.height,
        rotation: previous.rotation,
      };
    }

    const previousCenterOffset = rotatePoint(
      previous.width / 2,
      previous.height / 2,
      previous.rotation,
    );
    const previousBlockCenter = {
      x: previous.x + previousCenterOffset.x,
      y: previous.y + previousCenterOffset.y,
    };
    const local = rotatePoint(
      previousBlockCenter.x - previousFrame.x,
      previousBlockCenter.y - previousFrame.y,
      -previousFrame.rotation,
    );
    const rotated = rotatePoint(local.x, local.y, nextFrame.rotation);
    const width = previous.width;
    const height = previous.height;
    const rotation = previous.rotation + rotationDelta;
    const nextCenterOffset = rotatePoint(width / 2, height / 2, rotation);
    return {
      ...block,
      x: nextFrame.x + rotated.x - nextCenterOffset.x,
      y: nextFrame.y + rotated.y - nextCenterOffset.y,
      width,
      height,
      rotation,
    };
  });
}

export function constrainPlanSituationBlocks(
  blocks: SheetBlock[],
  sheetWidth: number,
  sheetHeight: number,
) {
  const frame = blocks.find((block) => block.id === PLAN_SITUATION_FRAME_ID);
  if (!frame) return blocks;
  const corners = [
    [0, 0],
    [frame.width, 0],
    [frame.width, frame.height],
    [0, frame.height],
  ].map(([x, y]) => {
    const point = rotatePoint(x, y, frame.rotation);
    return { x: frame.x + point.x, y: frame.y + point.y };
  });
  const left = Math.min(...corners.map((point) => point.x));
  const right = Math.max(...corners.map((point) => point.x));
  const top = Math.min(...corners.map((point) => point.y));
  const bottom = Math.max(...corners.map((point) => point.y));
  const dx = left < 0 ? -left : right > sheetWidth ? sheetWidth - right : 0;
  const dy = top < 0 ? -top : bottom > sheetHeight ? sheetHeight - bottom : 0;
  const translated = blocks.map((block) => ({ ...block, x: block.x + dx, y: block.y + dy }));
  const translatedFrame = translated.find((block) => block.id === PLAN_SITUATION_FRAME_ID)!;

  return translated.map((block) => {
    if (block.id === PLAN_SITUATION_FRAME_ID) return block;
    if (!isPlanSituationMovableElement(block)) return block;
    const centerOffset = rotatePoint(block.width / 2, block.height / 2, block.rotation);
    const blockCenter = { x: block.x + centerOffset.x, y: block.y + centerOffset.y };
    const local = rotatePoint(
      blockCenter.x - translatedFrame.x,
      blockCenter.y - translatedFrame.y,
      -translatedFrame.rotation,
    );
    const halfWidth = Math.min(block.width / 2, Math.max(4, translatedFrame.width / 2 - 4));
    const halfHeight = Math.min(block.height / 2, Math.max(4, translatedFrame.height / 2 - 4));
    const titleInset = translatedFrame.title ? translatedFrame.titleHeight ?? 28 : 0;
    const minX = halfWidth + 4;
    const maxX = translatedFrame.width - halfWidth - 4;
    const minY = titleInset + halfHeight + 4;
    const maxY = translatedFrame.height - halfHeight - 4;
    const constrainedLocal = {
      x: Math.max(minX, Math.min(maxX, local.x)),
      y: Math.max(minY, Math.min(maxY, local.y)),
    };
    const world = rotatePoint(constrainedLocal.x, constrainedLocal.y, translatedFrame.rotation);
    return {
      ...block,
      x: translatedFrame.x + world.x - centerOffset.x,
      y: translatedFrame.y + world.y - centerOffset.y,
    };
  });
}

export function setPlanSituationOrientation(
  state: PlanSituationState,
  orientation: number,
  mode: PlanSituationOrientationMode = "manual",
) {
  const normalized = ((orientation % 360) + 360) % 360;
  const nextBlocks = state.blocks.map((block) => block.id === PLAN_SITUATION_FRAME_ID
    ? { ...block, rotation: normalized }
    : block);
  const rotatedState: PlanSituationState = {
    ...state,
    orientation: normalized,
    orientation_mode: mode,
    blocks: transformSituationChildrenForFrame(state.blocks, nextBlocks),
  };
  return refitPlanSituationTraces(rotatedState);
}

export function orientPlanSituationFromObserver(
  state: PlanSituationState,
  fallbackAngle?: number | null,
) {
  const observer = state.blocks.find((block) => block.situationRole === "observer");
  if (observer) {
    const observerAngleInsideFrame = observer.rotation - state.orientation;
    return setPlanSituationOrientation(
      state,
      state.orientation - observerAngleInsideFrame,
      "observer",
    );
  }
  if (typeof fallbackAngle === "number" && Number.isFinite(fallbackAngle)) {
    const normalized = ((fallbackAngle % 360) + 360) % 360;
    const configured = normalizePlanSituation({
      ...state,
      orientation: normalized,
      orientation_mode: "observer",
    });
    return refitPlanSituationTraces(configured);
  }
  return null;
}

export function evaluatePlanSituationAudit(
  state: PlanSituationState,
  documentType: PlanDocumentType,
): PlanSituationAuditItem[] {
  if (!state.enabled) {
    return state.sectorial
      ? [{ severity: "error", message: "Le plan est déclaré sectoriel mais aucun plan de situation n’est présent." }]
      : [{ severity: "manual", message: "Déterminer selon le site si un plan de situation est nécessaire." }];
  }
  const roles = new Set(state.blocks.map((block) => block.situationRole));
  const hasSilhouette = state.blocks.some((block) => (
    block.situationIsSilhouette
    || block.situationRole === "building_outline"
    || block.situationRole === "represented_zone"
  ) && (block.situationSourcePoints?.length ?? 0) >= 3);
  const items: PlanSituationAuditItem[] = [];
  if (!roles.has("background") && !roles.has("building_outline") && !roles.has("building") && !hasSilhouette) {
    items.push({ severity: "error", message: "La silhouette ou le fond du site n’est pas représenté dans le plan de situation." });
  }
  if (state.sectorial && !roles.has("represented_zone")) {
    items.push({ severity: "error", message: "La zone représentée par le plan sectoriel n’est pas identifiée." });
  }
  if (!roles.has("assembly_point")) {
    items.push({ severity: "manual", message: "Vérifier si un point de rassemblement doit être indiqué." });
  }
  if (documentType === "evacuation" && roles.has("observer") && state.orientation_mode !== "observer") {
    items.push({ severity: "warning", message: "Un repère « Vous êtes ici » existe : vérifier l’orientation par rapport à l’observateur." });
  }
  if (documentType === "intervention" && !roles.has("remote_equipment")) {
    items.push({ severity: "manual", message: "Vérifier si des équipements de sécurité déportés doivent être reportés." });
  }
  if (!items.length) {
    items.push({ severity: "ok", message: "Les contrôles automatiques disponibles ne signalent aucun manque certain." });
  }
  return items;
}
