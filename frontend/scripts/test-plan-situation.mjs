import assert from "node:assert/strict";
import {
  PLAN_SITUATION_BACKGROUND_ID,
  PLAN_SITUATION_FRAME_ID,
  addPlanSituationElement,
  addPlanSituationPictogram,
  clipPlanSituationPolygon,
  constrainPlanSituationBlocks,
  createPlanSituation,
  decorateWithPlanSituation,
  evaluatePlanSituationAudit,
  getSituationSilhouettes,
  isPlanSituationMovableElement,
  isPointInsidePlanSituationFrame,
  normalizePlanSituation,
  orientPlanSituationFromObserver,
  planSituationFrame,
  refreshPlanSituationVisibleArea,
  refitPlanSituationTraces,
  removePlanSituationBlock,
  selectPlanSituationRepresentedOutline,
  setPlanSituationOrientation,
  stripPlanSituationBlocks,
  traceIntoPlanSituation,
  transformSituationChildrenForFrame,
  updatePlanSituationBlockLabel,
  upsertPlanSituationBackground,
} from "../src/lib/planSituation.ts";

const SHEET_WIDTH = 1123;
const SHEET_HEIGHT = 794;

const legacySectorialState = normalizePlanSituation({ sectorial: true });
assert.equal(legacySectorialState.enabled, false);
assert.equal(legacySectorialState.sectorial, true);
assert.equal(legacySectorialState.auto_refresh_visible_area, true);
assert.equal(
  normalizePlanSituation({ auto_refresh_visible_area: false }).auto_refresh_visible_area,
  false,
);
assert.equal(
  evaluatePlanSituationAudit(legacySectorialState, "evacuation")[0].severity,
  "error",
);

let state = createPlanSituation(SHEET_WIDTH, SHEET_HEIGHT);
assert.equal(state.enabled, true);
assert.equal(state.blocks.length, 1);
assert.equal(planSituationFrame(state)?.id, PLAN_SITUATION_FRAME_ID);

const sourceOutline = [
  { x: 100, y: 80 },
  { x: 700, y: 80 },
  { x: 700, y: 380 },
  { x: 100, y: 380 },
];
state = traceIntoPlanSituation(state, "building_outline", sourceOutline);
const tracedOutline = state.blocks.find((block) => block.situationRole === "building_outline");
assert.ok(tracedOutline);
assert.equal(state.blocks.some((block) => block.situationRole === "background"), false);
assert.ok(Math.abs(tracedOutline.width / tracedOutline.height - 2) < 0.001);
const visibleLeftHalf = [
  { x: 50, y: 40 },
  { x: 400, y: 40 },
  { x: 400, y: 420 },
  { x: 50, y: 420 },
];
const clippedLeftHalf = clipPlanSituationPolygon(sourceOutline, visibleLeftHalf);
assert.equal(Math.min(...clippedLeftHalf.map((point) => point.x)), 100);
assert.equal(Math.max(...clippedLeftHalf.map((point) => point.x)), 400);
const automaticallyRefreshed = refreshPlanSituationVisibleArea(state, visibleLeftHalf);
assert.ok(automaticallyRefreshed);
const automaticZone = automaticallyRefreshed.blocks.find(
  (block) => block.situationRole === "represented_zone",
);
assert.ok(automaticZone?.situationSourcePoints);
assert.equal(Math.min(...automaticZone.situationSourcePoints.map((point) => point.x)), 100);
assert.equal(Math.max(...automaticZone.situationSourcePoints.map((point) => point.x)), 400);
assert.equal(refreshPlanSituationVisibleArea(state, [
  { x: 800, y: 500 },
  { x: 900, y: 500 },
  { x: 900, y: 600 },
  { x: 800, y: 600 },
]), null);
state = traceIntoPlanSituation(state, "represented_zone", [
  { x: 400, y: 80 },
  { x: 700, y: 80 },
  { x: 700, y: 380 },
  { x: 400, y: 380 },
]);
assert.equal(state.blocks.some((block) => block.situationRole === "represented_zone"), true);
state = refitPlanSituationTraces(state, {
  content_width_percent: 50,
  content_height_percent: 30,
  zone_opacity_percent: 42,
});
const refittedOutline = state.blocks.find((block) => block.situationRole === "building_outline");
const refittedZone = state.blocks.find((block) => block.situationRole === "represented_zone");
const fittingFrame = planSituationFrame(state);
assert.ok(refittedOutline && refittedZone && fittingFrame);
assert.ok(refittedOutline.width <= (fittingFrame.width - 24) * 0.5 + 0.001);
assert.ok(refittedOutline.height <= (fittingFrame.height - (fittingFrame.titleHeight ?? 28) - 24) * 0.3 + 0.001);
assert.equal(refittedZone.fillOpacity, 0.42);
assert.ok(Math.abs(refittedOutline.width / refittedOutline.height - 2) < 0.001);

state = upsertPlanSituationBackground(state);
state = addPlanSituationElement(state, "represented_zone");
state = addPlanSituationElement(state, "road");
state = addPlanSituationPictogram(
  state,
  "point_de_rassemblement",
  "Point de rassemblement",
  "assembly_point",
);
assert.equal(state.blocks.some((block) => block.id === PLAN_SITUATION_BACKGROUND_ID), true);
assert.equal(state.blocks.some((block) => block.situationRole === "represented_zone"), true);
assert.equal(state.blocks.some((block) => block.situationRole === "assembly_point"), true);

state = setPlanSituationOrientation(state, 90, "manual");
assert.equal(state.orientation, 90);
assert.equal(planSituationFrame(state)?.rotation, 90);
state.blocks
  .filter((block) => block.id !== PLAN_SITUATION_FRAME_ID)
  .forEach((block) => assert.equal(block.rotation, 90));

const rotatedFrame = planSituationFrame(state);
assert.ok(rotatedFrame);
const resizedFrame = {
  ...rotatedFrame,
  x: rotatedFrame.x - 40,
  y: rotatedFrame.y - 30,
  width: rotatedFrame.width * 0.8,
  height: rotatedFrame.height * 0.8,
};
const transformed = transformSituationChildrenForFrame(
  state.blocks,
  state.blocks.map((block) => block.id === PLAN_SITUATION_FRAME_ID ? resizedFrame : block),
);
assert.equal(transformed.length, state.blocks.length);
assert.equal(transformed.find((block) => block.id === PLAN_SITUATION_FRAME_ID)?.width, resizedFrame.width);
state.blocks
  .filter((block) => block.id !== PLAN_SITUATION_FRAME_ID)
  .forEach((block) => {
    const transformedBlock = transformed.find((candidate) => candidate.id === block.id);
    assert.ok(transformedBlock);
    assert.equal(transformedBlock.x, block.x);
    assert.equal(transformedBlock.y, block.y);
    assert.equal(transformedBlock.width, block.width);
    assert.equal(transformedBlock.height, block.height);
  });
assert.equal(
  transformed.filter((block) => block.id !== PLAN_SITUATION_FRAME_ID)
    .every((block) => Number.isFinite(block.x) && Number.isFinite(block.y)),
  true,
);

const constrained = constrainPlanSituationBlocks(
  transformed.map((block) => ({ ...block, x: block.x + SHEET_WIDTH, y: block.y + SHEET_HEIGHT })),
  SHEET_WIDTH,
  SHEET_HEIGHT,
);
assert.equal(constrained.every((block) => Number.isFinite(block.x) && Number.isFinite(block.y)), true);

const templateBlock = {
  id: "template-title",
  kind: "text",
  label: "Titre template",
  x: 10,
  y: 10,
  width: 200,
  height: 50,
  rotation: 0,
  visible: true,
};
const decorated = decorateWithPlanSituation([templateBlock], { ...state, locked: true });
assert.equal(decorated[0].id, templateBlock.id);
assert.equal(decorated.find((block) => block.id === PLAN_SITUATION_FRAME_ID)?.locked, false);
assert.equal(
  decorated
    .filter((block) => (
      block.situationRole === "building_outline"
      || block.situationRole === "represented_zone"
      || block.situationRole === "background"
    ))
    .every((block) => block.locked),
  true,
);
assert.equal(
  decorated
    .filter((block) => isPlanSituationMovableElement(block))
    .every((block) => !block.locked),
  true,
);
assert.deepEqual(stripPlanSituationBlocks(decorated), [templateBlock]);
assert.deepEqual(decorateWithPlanSituation([templateBlock], { ...state, visible: false }), [templateBlock]);

const observerMissing = orientPlanSituationFromObserver(state);
assert.equal(observerMissing, null);
const fallbackOriented = orientPlanSituationFromObserver(state, 180);
assert.ok(fallbackOriented);
assert.equal(fallbackOriented.orientation, 180);
assert.equal(fallbackOriented.orientation_mode, "observer");

// Test trace rotation inside upright frame:
let uprightState = createPlanSituation(SHEET_WIDTH, SHEET_HEIGHT);
uprightState = traceIntoPlanSituation(uprightState, "building_outline", sourceOutline);
uprightState = traceIntoPlanSituation(uprightState, "represented_zone", [
  { x: 400, y: 80 },
  { x: 700, y: 80 },
  { x: 700, y: 380 },
  { x: 400, y: 380 },
]);
const initialOutline = uprightState.blocks.find((b) => b.situationRole === "building_outline");
assert.ok(initialOutline);
assert.ok(Math.abs(initialOutline.width / initialOutline.height - 2) < 0.001);

// Rotate to 90 degrees inside upright frame:
const rotated90State = refitPlanSituationTraces(uprightState, { orientation: 90 });
const rotated90Outline = rotated90State.blocks.find((b) => b.situationRole === "building_outline");
const rotated90Zone = rotated90State.blocks.find((b) => b.situationRole === "represented_zone");
assert.ok(rotated90Outline && rotated90Zone);
// Ratio width/height should now be 0.5 (height is twice the width):
assert.ok(Math.abs(rotated90Outline.height / rotated90Outline.width - 2) < 0.01);
// The zone must be in the bottom half of the outline:
assert.ok(rotated90Zone.y >= rotated90Outline.y + rotated90Outline.height * 0.4);

// Test silhouette tracing directly into an inverted (180°) plan situation:
let invertedState = createPlanSituation(SHEET_WIDTH, SHEET_HEIGHT, 180);
assert.equal(invertedState.orientation, 180);
assert.equal(invertedState.orientation_mode, "observer");
// Building with an asymmetrical shape: top-left corner notch
const asymmetricBuilding = [
  { x: 100, y: 100 },
  { x: 200, y: 100 },
  { x: 200, y: 150 },
  { x: 400, y: 150 },
  { x: 400, y: 300 },
  { x: 100, y: 300 },
];
invertedState = traceIntoPlanSituation(invertedState, "building_outline", asymmetricBuilding);
const invertedOutline = invertedState.blocks.find((b) => b.situationRole === "building_outline");
assert.ok(invertedOutline);

// Trace same building into 0° state for comparison:
let normalState = createPlanSituation(SHEET_WIDTH, SHEET_HEIGHT, 0);
normalState = traceIntoPlanSituation(normalState, "building_outline", asymmetricBuilding);
const normalOutline = normalState.blocks.find((b) => b.situationRole === "building_outline");
assert.ok(normalOutline);

// The 180° rotated points should have the notch inverted (top becomes bottom):
const firstPoint0 = normalOutline.shapePoints[0];
const firstPoint180 = invertedOutline.shapePoints[0];
assert.ok(firstPoint0.y < 0.1);
assert.ok(firstPoint180.y > 0.9);

const observerState = addPlanSituationPictogram(state, "vous_etes_ici", "Vous êtes ici", "observer");
const observer = observerState.blocks.find((block) => block.situationRole === "observer");
assert.ok(observer);
observer.rotation += 30;
const observerOriented = orientPlanSituationFromObserver(observerState);
assert.ok(observerOriented);
assert.equal(observerOriented.orientation, 60);
assert.equal(observerOriented.orientation_mode, "observer");

const audit = evaluatePlanSituationAudit(state, "evacuation");
assert.equal(audit.some((item) => item.severity === "error"), false);
assert.equal(audit.some((item) => item.message.includes("rassemblement")), false);
const missingSector = evaluatePlanSituationAudit(
  {
    ...state,
    sectorial: true,
    blocks: state.blocks.filter((block) => block.situationRole !== "represented_zone"),
  },
  "evacuation",
);
assert.equal(missingSector.some((item) => item.severity === "error"), true);

// ── Multi-silhouette tests ──────────────────────────────────────────────────
let multiState = createPlanSituation(SHEET_WIDTH, SHEET_HEIGHT);
// Trace Building A
const buildingA = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 300 },
  { x: 100, y: 300 },
];
multiState = traceIntoPlanSituation(multiState, "building_outline", buildingA, { label: "Bâtiment A" });
let silhouettes = getSituationSilhouettes(multiState);
assert.equal(silhouettes.length, 1);
assert.equal(silhouettes[0].label, "Bâtiment A");
assert.equal(silhouettes[0].situationRole, "building_outline");

// Trace Building B with append: true
const buildingB = [
  { x: 500, y: 100 },
  { x: 700, y: 100 },
  { x: 700, y: 300 },
  { x: 500, y: 300 },
];
multiState = traceIntoPlanSituation(multiState, "building_outline", buildingB, { append: true, label: "Bâtiment B" });
silhouettes = getSituationSilhouettes(multiState);
assert.equal(silhouettes.length, 2);
assert.equal(silhouettes[0].label, "Bâtiment A");
assert.equal(silhouettes[1].label, "Bâtiment B");
assert.equal(silhouettes[0].situationRole, "building_outline");
assert.equal(silhouettes[1].situationRole, "building_outline");
// Both buildings should be placed side-by-side inside the frame
assert.ok(silhouettes[1].x > silhouettes[0].x);

// Trace Building C with append: true
const buildingC = [
  { x: 300, y: 400 },
  { x: 500, y: 400 },
  { x: 500, y: 600 },
  { x: 300, y: 600 },
];
multiState = traceIntoPlanSituation(multiState, "building_outline", buildingC, { append: true, label: "Bâtiment C" });
silhouettes = getSituationSilhouettes(multiState);
assert.equal(silhouettes.length, 3);
assert.equal(silhouettes[2].label, "Bâtiment C");

// Select Building B as the represented zone
const bId = silhouettes[1].id;
multiState = selectPlanSituationRepresentedOutline(multiState, bId);
assert.equal(multiState.sectorial, true);
const updatedSilhouettes = getSituationSilhouettes(multiState);
const updatedA = updatedSilhouettes.find((b) => b.label === "Bâtiment A");
const updatedB = updatedSilhouettes.find((b) => b.label === "Bâtiment B");
const updatedC = updatedSilhouettes.find((b) => b.label === "Bâtiment C");
assert.ok(updatedA && updatedB && updatedC);
assert.equal(updatedA.situationRole, "building_outline");
assert.equal(updatedA.fill, "#e5e7eb");
assert.equal(updatedB.situationRole, "represented_zone");
assert.equal(updatedB.fill, "#6b7280");
assert.equal(updatedC.situationRole, "building_outline");
assert.equal(updatedC.fill, "#e5e7eb");

// Now switch represented zone to Building C
const cId = updatedC.id;
multiState = selectPlanSituationRepresentedOutline(multiState, cId);
const reupdatedSilhouettes = getSituationSilhouettes(multiState);
const reupdatedB = reupdatedSilhouettes.find((b) => b.label === "Bâtiment B");
const reupdatedC = reupdatedSilhouettes.find((b) => b.label === "Bâtiment C");
assert.ok(reupdatedB && reupdatedC);
// Building B reverted back to outline
assert.equal(reupdatedB.situationRole, "building_outline");
assert.equal(reupdatedB.fill, "#e5e7eb");
// Building C is now represented
assert.equal(reupdatedC.situationRole, "represented_zone");
assert.equal(reupdatedC.fill, "#6b7280");

// Rename Building A
const aId = updatedA.id;
multiState = updatePlanSituationBlockLabel(multiState, aId, "Bâtiment Principal");
assert.equal(multiState.blocks.find((b) => b.id === aId)?.label, "Bâtiment Principal");

// Retrace Building A with targetBlockId
const buildingANew = [
  { x: 100, y: 100 },
  { x: 350, y: 100 },
  { x: 350, y: 300 },
  { x: 100, y: 300 },
];
multiState = traceIntoPlanSituation(multiState, "building_outline", buildingANew, { targetBlockId: aId });
assert.equal(getSituationSilhouettes(multiState).length, 3);
assert.equal(multiState.blocks.find((b) => b.id === aId)?.situationSourcePoints?.length, 4);

// Remove Building B
multiState = removePlanSituationBlock(multiState, bId);
assert.equal(getSituationSilhouettes(multiState).length, 2);
assert.equal(multiState.blocks.some((b) => b.id === bId), false);

// Refresh visible area intersects Building C
const visibleOverC = [
  { x: 320, y: 420 },
  { x: 450, y: 420 },
  { x: 450, y: 550 },
  { x: 320, y: 550 },
];
const refreshedMulti = refreshPlanSituationVisibleArea(multiState, visibleOverC);
assert.ok(refreshedMulti);
const subzone = refreshedMulti.blocks.find((b) => b.situationRole === "represented_zone" && !b.situationIsSilhouette);
assert.ok(subzone);
assert.ok(subzone.situationSourcePoints);

// Refresh visible area intersects BOTH Building A and Building C
const visibleOverBoth = [
  { x: 50, y: 50 },
  { x: 800, y: 50 },
  { x: 800, y: 700 },
  { x: 50, y: 700 },
];
const refreshedBoth = refreshPlanSituationVisibleArea(multiState, visibleOverBoth);
assert.ok(refreshedBoth);
// Both Building A and Building C should be represented_zone (filled with #6b7280)
const bothA = refreshedBoth.blocks.find((b) => b.id === aId);
const bothC = refreshedBoth.blocks.find((b) => b.id === cId);
assert.ok(bothA && bothC);
assert.equal(bothA.situationRole, "represented_zone");
assert.equal(bothA.fill, "#6b7280");
// Test movable situation elements vs protected silhouettes/zones
let situationWithElements = createPlanSituation(SHEET_WIDTH, SHEET_HEIGHT);
situationWithElements = traceIntoPlanSituation(situationWithElements, "building_outline", sourceOutline);
situationWithElements = traceIntoPlanSituation(situationWithElements, "represented_zone", [
  { x: 400, y: 80 },
  { x: 700, y: 80 },
  { x: 700, y: 380 },
  { x: 400, y: 380 },
]);
situationWithElements = addPlanSituationElement(situationWithElements, "parking");
situationWithElements = addPlanSituationElement(situationWithElements, "arrow");
situationWithElements = addPlanSituationPictogram(
  situationWithElements,
  "point_de_rassemblement",
  "Point de rassemblement",
  "assembly_point",
);

const frameBlock = situationWithElements.blocks.find((b) => b.id === PLAN_SITUATION_FRAME_ID);
const buildingBlock = situationWithElements.blocks.find((b) => b.situationRole === "building_outline");
const zoneBlock = situationWithElements.blocks.find((b) => b.situationRole === "represented_zone");
const parkingBlock = situationWithElements.blocks.find((b) => b.situationRole === "parking");
const arrowBlock = situationWithElements.blocks.find((b) => b.situationRole === "arrow");
const assemblyBlock = situationWithElements.blocks.find((b) => b.situationRole === "assembly_point");

assert.ok(frameBlock && buildingBlock && zoneBlock && parkingBlock && arrowBlock && assemblyBlock);

// Frame, building silhouette, and represented zone are NOT movable situation elements
assert.equal(isPlanSituationMovableElement(frameBlock), false);
assert.equal(isPlanSituationMovableElement(buildingBlock), false);
assert.equal(isPlanSituationMovableElement(zoneBlock), false);

// Parking, arrow, and assembly point ARE movable situation elements
assert.equal(isPlanSituationMovableElement(parkingBlock), true);
assert.equal(isPlanSituationMovableElement(arrowBlock), true);
assert.equal(isPlanSituationMovableElement(assemblyBlock), true);

// Test decorateWithPlanSituation keeps building silhouette and represented zone locked, but markers unlocked
const decoratedSituation = decorateWithPlanSituation([], situationWithElements);
const decBuilding = decoratedSituation.find((b) => b.situationRole === "building_outline");
const decZone = decoratedSituation.find((b) => b.situationRole === "represented_zone");
const decParking = decoratedSituation.find((b) => b.situationRole === "parking");
const decArrow = decoratedSituation.find((b) => b.situationRole === "arrow");
const decAssembly = decoratedSituation.find((b) => b.situationRole === "assembly_point");

assert.equal(decBuilding?.locked, true);
assert.equal(decZone?.locked, true);
assert.equal(decParking?.locked, false);
assert.equal(decArrow?.locked, false);
assert.equal(decAssembly?.locked, false);

// Test moving parking and assembly point and constraining them inside frame
const originalParkingX = parkingBlock.x;
const originalParkingY = parkingBlock.y;
const movedBlocks = situationWithElements.blocks.map((b) => {
  if (b.id === parkingBlock.id) {
    return { ...b, x: b.x + 30, y: b.y + 20 };
  }
  return b;
});
const constrainedMovable = constrainPlanSituationBlocks(movedBlocks);
const constrainedParking = constrainedMovable.find((b) => b.id === parkingBlock.id);
// Test isPointInsidePlanSituationFrame
const frameInsidePoint = { x: frameBlock.x + 20, y: frameBlock.y + 20 };
const frameOutsidePoint = { x: frameBlock.x - 50, y: frameBlock.y - 50 };
assert.equal(isPointInsidePlanSituationFrame(frameInsidePoint, situationWithElements), true);
assert.equal(isPointInsidePlanSituationFrame(frameOutsidePoint, situationWithElements), false);

// Test frame moving transforms all children (silhouettes + movable elements)
const movedFrame = { ...frameBlock, x: frameBlock.x + 50, y: frameBlock.y + 30 };
const frameMovedBlocks = situationWithElements.blocks.map((b) => b.id === frameBlock.id ? movedFrame : b);
const transformedAfterFrameMove = transformSituationChildrenForFrame(situationWithElements.blocks, frameMovedBlocks);
const transformedSilhouette = transformedAfterFrameMove.find((b) => b.id === buildingBlock.id);
const transformedParking = transformedAfterFrameMove.find((b) => b.id === parkingBlock.id);
assert.equal(transformedSilhouette.x, buildingBlock.x + 50);
assert.equal(transformedSilhouette.y, buildingBlock.y + 30);
assert.equal(transformedParking.x, parkingBlock.x + 50);
assert.equal(transformedParking.y, parkingBlock.y + 30);

console.log("Plan de situation: assertions visuelles et fonctionnelles réussies.");

