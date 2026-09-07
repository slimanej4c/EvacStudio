import assert from "node:assert/strict";
import { shouldMainPlanReceivePointerEvents } from "../src/lib/canvasPlanInteraction.ts";

function createEditorLockManager(initialTemplate = "none") {
  let sheetTemplate = initialTemplate;
  let mainPlanLocked = initialTemplate !== "none";
  let icons = [{ id: 1, tempId: "icon-1", locked: initialTemplate !== "none" }];
  let shapes = [{ id: 1, tempId: "shape-1", locked: initialTemplate !== "none" }];
  let texts = [{ id: 1, tempId: "text-1", locked: initialTemplate !== "none" }];
  let overlays = [{ tempId: "plan-overlay-1", locked: initialTemplate !== "none" }];

  const setPlanObjectsLockState = (locked) => {
    icons = icons.map((i) => ({ ...i, locked }));
    shapes = shapes.map((s) => ({ ...s, locked }));
    texts = texts.map((t) => ({ ...t, locked }));
    overlays = overlays.map((o) => ({ ...o, locked }));
    mainPlanLocked = locked;
  };

  const applySheetTemplate = (template) => {
    sheetTemplate = template;
    if (template === "none") {
      setPlanObjectsLockState(false);
    } else {
      setPlanObjectsLockState(true);
    }
  };

  return {
    getState: () => ({
      sheetTemplate,
      mainPlanLocked,
      iconsLocked: icons.every((i) => i.locked),
      shapesLocked: shapes.every((s) => s.locked),
      textsLocked: texts.every((t) => t.locked),
      overlaysLocked: overlays.every((o) => o.locked),
      iconsUnlocked: icons.every((i) => !i.locked),
      shapesUnlocked: shapes.every((s) => !s.locked),
      textsUnlocked: texts.every((t) => !t.locked),
      overlaysUnlocked: overlays.every((o) => !o.locked),
    }),
    applySheetTemplate,
  };
}

// Test 1: Initial load in "Plan seul" (none) -> everything unlocked
{
  const manager = createEditorLockManager("none");
  const state = manager.getState();
  assert.equal(state.sheetTemplate, "none");
  assert.equal(state.mainPlanLocked, false);
  assert.equal(state.iconsUnlocked, true);
  assert.equal(state.shapesUnlocked, true);
  assert.equal(state.textsUnlocked, true);
  assert.equal(state.overlaysUnlocked, true);
}

// Test 2: Switch to a template -> everything locked
{
  const manager = createEditorLockManager("none");
  manager.applySheetTemplate("official_a3_pe_pay");
  const state = manager.getState();
  assert.equal(state.sheetTemplate, "official_a3_pe_pay");
  assert.equal(state.mainPlanLocked, true);
  assert.equal(state.iconsLocked, true);
  assert.equal(state.shapesLocked, true);
  assert.equal(state.textsLocked, true);
  assert.equal(state.overlaysLocked, true);
}

// Test 3: Switch back from template to "Plan seul" -> everything unlocked
{
  const manager = createEditorLockManager("official_a3_pe_pay");
  manager.applySheetTemplate("none");
  const state = manager.getState();
  assert.equal(state.sheetTemplate, "none");
  assert.equal(state.mainPlanLocked, false);
  assert.equal(state.iconsUnlocked, true);
  assert.equal(state.shapesUnlocked, true);
  assert.equal(state.textsUnlocked, true);
  assert.equal(state.overlaysUnlocked, true);
}

// Test 4: a locked plan remains a pointer target inside a template so the
// parent placement group can drag it to reframe the visible area.
assert.equal(shouldMainPlanReceivePointerEvents({
  areaSelectionMode: false,
  sheetActive: true,
  mainPlanLocked: true,
}), true);

// In Plan seul, locking the plan deliberately lets area selection pass through.
assert.equal(shouldMainPlanReceivePointerEvents({
  areaSelectionMode: false,
  sheetActive: false,
  mainPlanLocked: true,
}), false);

assert.equal(shouldMainPlanReceivePointerEvents({
  areaSelectionMode: true,
  sheetActive: true,
  mainPlanLocked: true,
}), false);

console.log("Test de verrouillage/déverrouillage Plan seul <-> Template validé avec succès !");
