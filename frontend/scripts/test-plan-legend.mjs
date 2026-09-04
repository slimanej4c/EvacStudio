import assert from "node:assert/strict";
import {
  applyPlanLegendLayout,
  getPlanLegendLayout,
  stripPlanLegendLayoutOverrides,
} from "../src/lib/planLegend.ts";

const templateLegend = {
  id: "template-legend",
  kind: "legend",
  label: "Légende",
  x: 20,
  y: 600,
  width: 300,
  height: 120,
  rotation: 0,
  visible: true,
  locked: true,
};
const storedLayout = {
  x: 700,
  y: 540,
  width: 350,
  height: 150,
  rotation: 0,
  visible: true,
};

const decorated = applyPlanLegendLayout([templateLegend], storedLayout);
assert.deepEqual(getPlanLegendLayout(decorated), storedLayout);
assert.equal(decorated[0].locked, false);
assert.equal(decorated[0].planLegendBaseLayout.x, templateLegend.x);

const moved = [{ ...decorated[0], x: 760, y: 580 }];
const redecorated = applyPlanLegendLayout(moved, storedLayout);
assert.equal(redecorated[0].x, 760);
assert.equal(redecorated[0].y, 580);

const reusable = stripPlanLegendLayoutOverrides(moved);
assert.equal(reusable[0].x, templateLegend.x);
assert.equal(reusable[0].y, templateLegend.y);
assert.equal(reusable[0].locked, true);
assert.equal("planLegendBaseLayout" in reusable[0], false);

console.log("Légende du plan : déplacement propre au plan validé.");
