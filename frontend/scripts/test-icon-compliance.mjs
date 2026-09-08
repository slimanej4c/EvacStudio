import assert from "node:assert/strict";
import { evaluateIconCompliance, NF_X08_070_ICON_TOOLTIP } from "../src/lib/planCompliance.ts";

// Tooltip verification
assert.equal(
  NF_X08_070_ICON_TOOLTIP,
  "Norme NF X08-070 : Les pictogrammes de sécurité doivent mesurer au minimum 7 mm à l'échelle d'impression (seuil critique toléré à 5 mm). Les symboles de la légende doivent avoir exactement la même taille que sur le plan."
);

// Cas 1 : Conforme (Taille >= 7 mm)
const c1 = evaluateIconCompliance({ sizeMm: 7.2, isYouAreHere: false });
assert.equal(c1.case, 1);
assert.equal(c1.status, "compliant");
assert.equal(c1.badgeLabel, "✅ Conforme NF X08-070");
assert.equal(c1.description, "Taille optimale pour impression (recommandé : ≥ 7 mm).");

const c1Boundary = evaluateIconCompliance({ sizeMm: 7.0, isYouAreHere: false });
assert.equal(c1Boundary.case, 1);
assert.equal(c1Boundary.status, "compliant");

// Cas 2 : Toléré / Avertissement (Entre 5 mm et 6.9 mm)
const c2 = evaluateIconCompliance({ sizeMm: 6.0, isYouAreHere: false });
assert.equal(c2.case, 2);
assert.equal(c2.status, "warning");
assert.equal(c2.badgeLabel, "⚠️ Conformité minimale (5 mm - 6.9 mm)");
assert.equal(c2.description, "Taille autorisée uniquement sur formats réduits (A4). Privilégiez 7 mm pour une lisibilité optimale.");

const c2BoundaryLow = evaluateIconCompliance({ sizeMm: 5.0, isYouAreHere: false });
assert.equal(c2BoundaryLow.case, 2);
assert.equal(c2BoundaryLow.status, "warning");

const c2BoundaryHigh = evaluateIconCompliance({ sizeMm: 6.9, isYouAreHere: false });
assert.equal(c2BoundaryHigh.case, 2);
assert.equal(c2BoundaryHigh.status, "warning");

// Cas 3 : Non conforme (Taille < 5 mm)
const c3 = evaluateIconCompliance({ sizeMm: 4.8, isYouAreHere: false });
assert.equal(c3.case, 3);
assert.equal(c3.status, "non_compliant");
assert.equal(c3.badgeLabel, "❌ Non conforme NF X08-070");
assert.equal(c3.description, "Taille inférieure au seuil légal (minimum absolu : 5 mm à l'impression). Risque de rejet lors du contrôle de sécurité.");

// Cas 4 : Cas particulier "Vous êtes ici" (Si < 8 mm)
const c4 = evaluateIconCompliance({ sizeMm: 7.5, isYouAreHere: true });
assert.equal(c4.case, 4);
assert.equal(c4.status, "warning");
assert.equal(c4.badgeLabel, "⚠️ Repère \"Vous êtes ici\" trop petit");
assert.equal(c4.description, "La norme exige une mise en évidence immédiate (taille recommandée : 8 mm à 10 mm).");

const c4Compliant = evaluateIconCompliance({ sizeMm: 8.5, isYouAreHere: true });
assert.equal(c4Compliant.case, 1);
assert.equal(c4Compliant.status, "compliant");
assert.equal(c4Compliant.badgeLabel, "✅ Conforme NF X08-070");
assert.equal(c4Compliant.description, "Taille optimale pour impression (recommandé : 8 mm à 10 mm).");

console.log("Validation de la conformité des pictogrammes NF X08-070 réussie !");
