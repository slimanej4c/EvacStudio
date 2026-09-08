import assert from "node:assert/strict";
import { test } from "node:test";
import { createAutoSaveController, normalizeAutoSaveInterval } from "../src/lib/autoSave.ts";
import { createEditorSnapshot, reconcileSavedOverlays } from "../src/lib/editorPersistence.ts";

function setup(overrides = {}) {
  let time = 0;
  let state = { dirty: false, blocked: false };
  const saves = [];
  const countdowns = [];
  const controller = createAutoSaveController({
    intervalSeconds: 5,
    now: () => time,
    readState: () => state,
    save: async () => { saves.push({ ...state }); },
    onCountdown: (value) => countdowns.push(value),
    ...overrides,
  });
  return {
    controller, saves, countdowns,
    update(patch) { state = { ...state, ...patch }; },
    tick(at) { time = at; return controller.tick(); },
  };
}

test("preference values are bounded, including corrupt browser storage", () => {
  for (const value of [null, "", undefined, "invalid", Infinity]) {
    assert.equal(normalizeAutoSaveInterval(value), 20);
  }
  assert.equal(normalizeAutoSaveInterval("120"), 120);
  assert.equal(normalizeAutoSaveInterval(900), 600);
  assert.equal(normalizeAutoSaveInterval(-1), 5);
});

test("isolated legend changes start a save and the latest state is submitted", async () => {
  const clock = setup();
  await clock.tick(0);
  clock.update({ dirty: true, hiddenLegendIconTypes: ["extincteur"] });
  await clock.tick(1000);
  clock.update({ hiddenLegendIconTypes: ["extincteur", "sortie"] });
  await clock.tick(6000);
  assert.equal(clock.saves.length, 1);
  assert.deepEqual(clock.saves[0].hiddenLegendIconTypes, ["extincteur", "sortie"]);
});

test("continuous editing does not postpone the save deadline", async () => {
  const clock = setup();
  clock.update({ dirty: true });
  await clock.tick(0);
  for (let time = 250; time <= 5000; time += 250) {
    clock.update({ icons: [{ x: time }] });
    await clock.tick(time);
  }
  assert.equal(clock.saves.length, 1);
  assert.equal(clock.saves[0].icons[0].x, 5000);
});

test("clean, loading, read-only, manual-saving or incomplete-template state does not save", async () => {
  const clock = setup();
  await clock.tick(10000);
  assert.equal(clock.saves.length, 0);
  clock.update({ dirty: true, blocked: true });
  await clock.tick(20000);
  await clock.tick(40000);
  assert.equal(clock.saves.length, 0);
  clock.update({ blocked: false });
  await clock.tick(40000);
  await clock.tick(45000);
  assert.equal(clock.saves.length, 1);
});

test("pending saves never overlap and newer edits get a later save", async () => {
  let finish;
  let count = 0;
  const clock = setup({ save: () => { count++; return new Promise((resolve) => { finish = resolve; }); } });
  clock.update({ dirty: true });
  await clock.tick(0);
  const pending = clock.tick(5000);
  clock.update({ icons: [{ x: 42 }] });
  await clock.tick(20000);
  assert.equal(count, 1);
  finish();
  await pending;
  await clock.tick(20000);
  const next = clock.tick(25000);
  assert.equal(count, 2);
  finish();
  await next;
});

test("failed saves retry after a full interval", async () => {
  let count = 0;
  const clock = setup({ save: async () => { if (++count === 1) throw new Error("offline"); } });
  clock.update({ dirty: true });
  await clock.tick(0);
  await assert.rejects(clock.tick(5000), /offline/);
  await clock.tick(6000);
  await clock.tick(10999);
  assert.equal(count, 1);
  await clock.tick(11000);
  assert.equal(count, 2);
});

test("clock delays catch up using elapsed time instead of counting ticks", async () => {
  const clock = setup();
  clock.update({ dirty: true });
  await clock.tick(0);
  await clock.tick(30000);
  assert.equal(clock.saves.length, 1);
});

test("unmount or disabling disposes the timer without another save", async () => {
  const clock = setup();
  clock.update({ dirty: true });
  await clock.tick(0);
  clock.controller.dispose();
  await clock.tick(10000);
  assert.equal(clock.saves.length, 0);
});

test("completion after disposal does not update the countdown", async () => {
  let finish;
  const clock = setup({ save: () => new Promise((resolve) => { finish = resolve; }) });
  clock.update({ dirty: true });
  await clock.tick(0);
  const pending = clock.tick(5000);
  const count = clock.countdowns.length;
  clock.controller.dispose();
  finish();
  await pending;
  assert.equal(clock.countdowns.length, count);
});

const base = { icons: [], shapes: [], texts: [], overlays: [] };

test("loading and saving share the same snapshot defaults and ignore volatile IDs", () => {
  const loaded = { ...base, icons: [{ tempId: "loaded", id: 1, x: 2 }] };
  const current = {
    ...base, icons: [{ tempId: "new", id: 999, x: 2, lock_aspect_ratio: true }],
    eraseStrokeCount: 0, sheetBlocks: [],
  };
  assert.equal(createEditorSnapshot(loaded), createEditorSnapshot(current));
});

test("snapshots detect every previously omitted class of isolated changes", () => {
  const before = createEditorSnapshot(base);
  for (const patch of [
    { hiddenLegendIconTypes: ["sortie"] },
    { planSituation: { enabled: true } },
    { mainPlanVisible: false },
    { mainPlanLocked: true },
    { sheetBlocks: [{ id: "title", text: "Updated" }] },
    { eraseStrokeCount: 1 },
    { exportPaperFormat: "a4" },
  ]) assert.notEqual(createEditorSnapshot({ ...base, ...patch }), before);
  assert.notEqual(
    createEditorSnapshot({ ...base, icons: [{ lock_aspect_ratio: false }] }),
    createEditorSnapshot({ ...base, icons: [{ lock_aspect_ratio: true }] }),
  );
});

test("only the submitted snapshot becomes clean when edits happen during a save", () => {
  const submitted = createEditorSnapshot({ ...base, icons: [{ x: 10 }] });
  const current = createEditorSnapshot({ ...base, icons: [{ x: 20 }] });
  const savedSnapshot = submitted;
  assert.notEqual(current, savedSnapshot);
});

test("undoing and redrawing the same number of eraser strokes stays dirty", () => {
  const saved = createEditorSnapshot({ ...base, eraseStrokeCount: 1, eraseRevision: 1 });
  const redrawn = createEditorSnapshot({ ...base, eraseStrokeCount: 1, eraseRevision: 3 });
  assert.notEqual(saved, redrawn);
});

test("overlay acknowledgements survive reordering, deletion and new imports", () => {
  const a = { tempId: "a", url: "blob:a", imageChanged: true };
  const b = { tempId: "b", url: "blob:b", imageChanged: true };
  const c = { tempId: "c", url: "blob:c", imageChanged: true };
  const saved = { overlay_ids: [101, 102] };
  const reordered = reconcileSavedOverlays([b, a, c], [a, b], saved);
  assert.deepEqual(reordered.map((overlay) => overlay.serverId), [102, 101, undefined]);
  assert.equal(reordered[2], c);
  assert.equal(reconcileSavedOverlays([b], [a, b], saved)[0].serverId, 102);
});

test("cropping an overlay during upload retains its unsaved image and geometry", () => {
  const submitted = { tempId: "a", url: "blob:old", imageChanged: true, x: 0 };
  const current = { ...submitted, url: "blob:cropped", x: 30 };
  const [result] = reconcileSavedOverlays([current], [submitted], { overlay_ids: [101] });
  assert.equal(result.serverId, 101);
  assert.equal(result.url, "blob:cropped");
  assert.equal(result.x, 30);
  assert.equal(result.imageChanged, true);
});
