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
  normalizePlanSituation,
  orientPlanSituationFromObserver,
  planSituationFrame,
  refreshPlanSituationVisibleArea,
  refitPlanSituationTraces,
  setPlanSituationOrientation,
  stripPlanSituationBlocks,
  traceIntoPlanSituation,
  transformSituationChildrenForFrame,
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
    .filter((block) => block.planSpecificKind === "situation" && block.id !== PLAN_SITUATION_FRAME_ID)
    .every((block) => block.locked),
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

console.log("Plan de situation: assertions visuelles et fonctionnelles réussies.");
