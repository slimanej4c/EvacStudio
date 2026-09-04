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
  orientation_mode: "manual",
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
}));

const boundedPercent = (value: unknown, fallback: number, minimum: number) => (
  Math.max(minimum, Math.min(100, finite(value, fallback)))
);

export function isPlanSituationBlock(block: SheetBlock) {
  return block.planSpecificKind === "situation"
    || block.id.startsWith(PLAN_SITUATION_BLOCK_PREFIX);
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
      orientation_mode: value?.orientation_mode === "observer" ? "observer" : "manual",
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
    }));
  const frame = blocks.find((block) => block.id === PLAN_SITUATION_FRAME_ID);
  return {
    version: 1,
    enabled: Boolean(value.enabled && frame),
    visible: value.visible !== false,
    locked: Boolean(value.locked),
    sectorial: Boolean(value.sectorial),
    auto_refresh_visible_area: value.auto_refresh_visible_area !== false,
    orientation: finite(value.orientation, frame?.rotation ?? 0),
    orientation_mode: value.orientation_mode === "observer" ? "observer" : "manual",
    content_width_percent: boundedPercent(value.content_width_percent, 90, 20),
    content_height_percent: boundedPercent(value.content_height_percent, 82, 20),
    zone_opacity_percent: boundedPercent(value.zone_opacity_percent, 35, 5),
    blocks,
  };
}

export function planSituationFrame(state: PlanSituationState) {
  return state.blocks.find((block) => block.id === PLAN_SITUATION_FRAME_ID) ?? null;
}

export function createPlanSituation(sheetWidth: number, sheetHeight: number): PlanSituationState {
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
  return {
    ...EMPTY_PLAN_SITUATION,
    enabled: true,
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

/**
 * Refit traced vector geometry inside the situation frame. Only the saved
 * plan-space points are used, so browser zoom and canvas pan never affect it.
 * The traced silhouette and represented zone rotate by the frame-relative
 * orientation to remain aligned with the main plan's observer angle.
 */
export function refitPlanSituationTraces(
  state: PlanSituationState,
  changes: Partial<Pick<PlanSituationState, "content_width_percent" | "content_height_percent" | "zone_opacity_percent" | "orientation" | "orientation_mode" | "auto_refresh_visible_area">> = {},
) {
  const configured = normalizePlanSituation({ ...state, ...changes });
  const outline = configured.blocks.find(
    (block) => block.situationRole === "building_outline" && (block.situationSourcePoints?.length ?? 0) >= 3,
  );
  if (!outline?.situationSourcePoints) return configured;
  const frame = planSituationFrame(configured);
  if (!frame) return configured;

  const traceRotation = ((configured.orientation - (frame.rotation ?? 0)) % 360 + 360) % 360;
  const rawOutlineBounds = sourceBounds(outline.situationSourcePoints);
  const center = {
    x: rawOutlineBounds.x + rawOutlineBounds.width / 2,
    y: rawOutlineBounds.y + rawOutlineBounds.height / 2,
  };

  const rotateAroundCenter = (point: SourcePoint, degrees: number): SourcePoint => {
    if (degrees % 360 === 0) return { ...point };
    const rotated = rotatePoint(point.x - center.x, point.y - center.y, degrees);
    return { x: center.x + rotated.x, y: center.y + rotated.y };
  };

  const rotatedOutlinePoints = outline.situationSourcePoints.map((point) => rotateAroundCenter(point, traceRotation));
  const rotatedOutlineBounds = sourceBounds(rotatedOutlinePoints);

  const titleHeight = frame.title ? frame.titleHeight ?? 28 : 0;
  const usable = {
    x: 12,
    y: titleHeight + 12,
    width: Math.max(20, frame.width - 24),
    height: Math.max(20, frame.height - titleHeight - 24),
  };
  const maximumWidth = usable.width * configured.content_width_percent / 100;
  const maximumHeight = usable.height * configured.content_height_percent / 100;
  const scale = Math.min(maximumWidth / rotatedOutlineBounds.width, maximumHeight / rotatedOutlineBounds.height);
  const localX = usable.x + (usable.width - rotatedOutlineBounds.width * scale) / 2;
  const localY = usable.y + (usable.height - rotatedOutlineBounds.height * scale) / 2;

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
      x: localX + (bounds.x - rotatedOutlineBounds.x) * scale,
      y: localY + (bounds.y - rotatedOutlineBounds.y) * scale,
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
) {
  if (points.length < 3 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return state;
  }
  if (role === "represented_zone" && !state.blocks.some((block) => block.situationRole === "building_outline")) {
    return state;
  }
  const normalizedPoints = points.map((point) => ({ x: point.x, y: point.y }));
  const block: SheetBlock = {
    id: blockId(role),
    kind: "shape",
    planSpecificKind: "situation",
    situationRole: role,
    label: role === "building_outline" ? "Silhouette du bâtiment" : "Zone représentée",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: state.orientation,
    visible: true,
    locked: true,
    shapeType: "polygon_zone",
    shapePoints: [],
    shapeClosed: true,
    situationSourcePoints: normalizedPoints,
    fill: role === "building_outline" ? "#e5e7eb" : "#6b7280",
    fillOpacity: role === "building_outline" ? 0.75 : state.zone_opacity_percent / 100,
    stroke: role === "building_outline" ? "#111827" : "#4b5563",
    strokeWidth: role === "building_outline" ? 2 : 1.5,
  };
  // A zone calculated from an older silhouette is no longer trustworthy after
  // that silhouette is retraced. Remove it and let the explicit refresh button
  // calculate a new visible field.
  const replaced = state.blocks.filter((candidate) => (
    candidate.situationRole !== role
    && !(role === "building_outline" && candidate.situationRole === "represented_zone")
  ));
  const frameIndex = replaced.findIndex((candidate) => candidate.id === PLAN_SITUATION_FRAME_ID);
  const outlineIndex = replaced.findIndex((candidate) => candidate.situationRole === "building_outline");
  const insertAt = role === "building_outline"
    ? Math.max(0, frameIndex + 1)
    : Math.max(frameIndex + 1, outlineIndex + 1);
  replaced.splice(insertAt, 0, block);
  return refitPlanSituationTraces({ ...state, blocks: replaced });
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
) {
  const outline = state.blocks.find(
    (block) => block.situationRole === "building_outline"
      && (block.situationSourcePoints?.length ?? 0) >= 3,
  );
  if (!outline?.situationSourcePoints) return null;
  const visibleArea = clipPlanSituationPolygon(
    outline.situationSourcePoints,
    visiblePlanPolygon,
  );
  if (visibleArea.length < 3) return null;
  return traceIntoPlanSituation(state, "represented_zone", visibleArea);
}

export function decorateWithPlanSituation(
  reusableBlocks: SheetBlock[],
  state: PlanSituationState,
) {
  const base = stripPlanSituationBlocks(reusableBlocks);
  if (!state.enabled || !state.visible) return base;
  return [
    ...base,
    ...cloneBlocks(state.blocks).map((block) => ({
      ...block,
      // The inset behaves as one protected object on the sheet. Its outer
      // frame remains editable; none of its contents can be deformed or moved
      // accidentally with the mouse.
      locked: block.situationRole !== "frame",
    })),
  ];
}

function blockId(role: PlanSituationRole) {
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
    locked: true,
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
    locked: true,
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
    locked: true,
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
      strokeWidth: 3,
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
      strokeWidth: 2,
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
      strokeWidth: 2,
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
  const items: PlanSituationAuditItem[] = [];
  if (!roles.has("background") && !roles.has("building_outline") && !roles.has("building")) {
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
