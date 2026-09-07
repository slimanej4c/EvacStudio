import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHEET_TEMPLATES, createSheetBlocks, ensureSheetTemplateLogos } from "../src/lib/sheetTemplates.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jsonPath = path.resolve(__dirname, "../src/lib/finalSheetTemplateStates.json");
const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

const templateKeys = Object.keys(SHEET_TEMPLATES);
assert.equal(templateKeys.length, 16, "Il doit y avoir exactement 16 templates");

for (const key of templateKeys) {
  const t = data.templates[key];
  assert.ok(t, `Template ${key} présent dans finalSheetTemplateStates.json`);
  const clientLogo = t.blocks.find(b => b.kind === "image" && b.imageKey === "clientLogo");
  const studioLogo = t.blocks.find(b => b.kind === "image" && b.imageKey === "studioLogo");
  assert.ok(clientLogo, `Template ${key} doit contenir un bloc image clientLogo dans finalSheetTemplateStates.json`);
  assert.ok(studioLogo, `Template ${key} doit contenir un bloc image studioLogo dans finalSheetTemplateStates.json`);
  assert.equal(clientLogo.visible, true);
  assert.equal(studioLogo.visible, true);
}

for (const key of templateKeys) {
  const blocks = createSheetBlocks(key);
  const clientLogo = blocks.find(b => b.kind === "image" && b.imageKey === "clientLogo");
  const studioLogo = blocks.find(b => b.kind === "image" && b.imageKey === "studioLogo");
  assert.ok(clientLogo, `createSheetBlocks('${key}') doit retourner un bloc image clientLogo`);
  assert.ok(studioLogo, `createSheetBlocks('${key}') doit retourner un bloc image studioLogo`);
}

const sampleStripped = createSheetBlocks("official_a2_pay_pi").filter(b => b.kind !== "image");
assert.equal(sampleStripped.some(b => b.kind === "image"), false);
const restored = ensureSheetTemplateLogos("official_a2_pay_pi", sampleStripped);
assert.ok(restored.some(b => b.kind === "image" && b.imageKey === "clientLogo"), "clientLogo doit être restauré");
assert.ok(restored.some(b => b.kind === "image" && b.imageKey === "studioLogo"), "studioLogo doit être restauré");

console.log("Validation des logos réussie : les 16 templates possèdent tous le Logo Client et le Logo Créateur.");
