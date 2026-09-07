import assert from "node:assert/strict";
import { shouldMainPlanReceivePointerEvents } from "../src/lib/canvasPlanInteraction.ts";

// 1. Hit-test reception on sheet mode (must be true so planPlacement receives reframe drags)
assert.equal(
  shouldMainPlanReceivePointerEvents({
    areaSelectionMode: false,
    sheetActive: true,
    mainPlanLocked: true,
  }),
  true,
  "Main plan must receive pointer events on sheet even when locked, so reframe gestures work"
);

assert.equal(
  shouldMainPlanReceivePointerEvents({
    areaSelectionMode: false,
    sheetActive: true,
    mainPlanLocked: false,
  }),
  true,
  "Main plan must receive pointer events on sheet when unlocked"
);

assert.equal(
  shouldMainPlanReceivePointerEvents({
    areaSelectionMode: true,
    sheetActive: true,
    mainPlanLocked: true,
  }),
  false,
  "Area selection mode takes precedence and disables plan pointer events"
);

assert.equal(
  shouldMainPlanReceivePointerEvents({
    areaSelectionMode: false,
    sheetActive: false,
    mainPlanLocked: true,
  }),
  false,
  "Outside sheet, locked plan lets pointer events pass through to marquee"
);

assert.equal(
  shouldMainPlanReceivePointerEvents({
    areaSelectionMode: false,
    sheetActive: false,
    mainPlanLocked: false,
  }),
  true,
  "Outside sheet, unlocked plan receives pointer events"
);

// 2. Test reframe dragging coordinate offset calculation
const initialPlacement = { scale: 100, offsetX: 0, offsetY: 0 };
const planTransform = { x: 250, y: 180, scale: 0.85 };

// Simulate dragging planPlacement by dx: +45, dy: -30
const draggedNodePos = { x: planTransform.x + 45, y: planTransform.y - 30 };
const nextPlacement = {
  ...initialPlacement,
  offsetX: Math.round(initialPlacement.offsetX + (draggedNodePos.x - planTransform.x)),
  offsetY: Math.round(initialPlacement.offsetY + (draggedNodePos.y - planTransform.y)),
};

assert.equal(nextPlacement.offsetX, 45, "Plan placement offsetX should match drag delta");
assert.equal(nextPlacement.offsetY, -30, "Plan placement offsetY should match drag delta");

// Simulate second drag from updated placement
const updatedPlanTransform = {
  x: planTransform.x + nextPlacement.offsetX,
  y: planTransform.y + nextPlacement.offsetY,
  scale: 0.85,
};
const secondDragNodePos = { x: updatedPlanTransform.x + 20, y: updatedPlanTransform.y + 15 };
const secondPlacement = {
  ...nextPlacement,
  offsetX: Math.round(nextPlacement.offsetX + (secondDragNodePos.x - updatedPlanTransform.x)),
  offsetY: Math.round(nextPlacement.offsetY + (secondDragNodePos.y - updatedPlanTransform.y)),
};

assert.equal(secondPlacement.offsetX, 65, "Subsequent drag should accumulate properly");
assert.equal(secondPlacement.offsetY, -15, "Subsequent drag should accumulate properly");

console.log("Recadrage du plan : logique d'interaction et calcul de déplacement validés avec succès !");
