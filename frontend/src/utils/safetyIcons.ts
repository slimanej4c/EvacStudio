export type IconType = string;

export interface SafetyIconDefinition {
  type: IconType;
  label: string;
  color: string;
  svg?: string;
  imageUrl?: string;
  fileName?: string;
  /** True only for SVG files uploaded by a user and safe to remove from the library. */
  deletable?: boolean;
}

/**
 * Pictograms whose meaning *is* a direction in the building. When the plan is
 * turned to match the reader's viewing direction, these must turn with it —
 * an escape arrow that no longer points at the real exit would be dangerous.
 * Every other pictogram marks a piece of equipment at a spot and must stay
 * upright and readable, so it gets the rotation compensated away.
 *
 * Matching is on the pictogram name, accents and case ignored.
 */
export const DIRECTIONAL_ICON_KEYWORDS = [
  "cheminement",
  "itineraire",
  "fleche",
  "acces pompiers",
  "vous etes ici",
  "issue finale",
  "issue de secours",
  "issue",
  "evacuation",
];

const stripAccents = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** True when the pictogram carries a direction and must follow the plan. */
export function isDirectionalIcon(
  type: IconType,
  definitions: Record<IconType, SafetyIconDefinition> = SAFETY_ICONS
): boolean {
  const definition = definitions[type];
  const haystack = stripAccents(`${type} ${definition?.label ?? ""}`);
  return DIRECTIONAL_ICON_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

/** The pictogram whose rotation defines the plan's reading direction. */
export const YOU_ARE_HERE_KEYWORD = "vous etes ici";

export function isYouAreHereIcon(
  type: IconType,
  definitions: Record<IconType, SafetyIconDefinition> = SAFETY_ICONS
): boolean {
  const definition = definitions[type];
  return stripAccents(`${type} ${definition?.label ?? ""}`).includes(YOU_ARE_HERE_KEYWORD);
}

/**
 * Centralised leader-line colours for pictograms.
 *
 * When a pictogram is offset (déport), the leader line, anchor dot fill and
 * anchor dot stroke must all use the pictogram's functional colour. Because the
 * server-supplied pictograms carry no colour metadata, we resolve the colour
 * from an exact, normalised-name lookup table built from the pictogram file
 * names actually present on disk. Matching is case- and accent-insensitive and
 * tolerates the typos found in the source files (e.g. "chaufferier",
 * "grouoe ventilisation").
 */
export const LEADER_COLOR_RED = "#ef233c";
export const LEADER_COLOR_GREEN = "#00a651";
export const LEADER_COLOR_BLUE = "#3046b8";
export const LEADER_COLOR_YELLOW = "#ffd500";
export const LEADER_COLOR_DARK = "#222222";

/** Exact pictogram name (normalised) → leader colour. Single source of truth. */
const PICTOGRAM_LEADER_COLORS: Record<string, string> = {
  // ROUGE — #ef233c
  "acces pompiers principal": LEADER_COLOR_RED,
  "acces pompiers": LEADER_COLOR_RED,
  "baie accessible": LEADER_COLOR_RED,
  "barrage eau incendie": LEADER_COLOR_RED,
  "centralisateur de mise en securite incendie": LEADER_COLOR_RED,
  "colonne humide": LEADER_COLOR_RED,
  "colonne seche": LEADER_COLOR_RED,
  "commande de desenfumage": LEADER_COLOR_RED,
  "declencheur manuel": LEADER_COLOR_RED,
  "equipement divers de lutte contre l incendie": LEADER_COLOR_RED,
  "extincteur sur roues": LEADER_COLOR_RED,
  "extincteur": LEADER_COLOR_RED,
  "gaz sous pression": LEADER_COLOR_RED,
  "porte coupe feu": LEADER_COLOR_RED,
  "produits dangereux pour la sante et l environnement": LEADER_COLOR_RED,
  "raccord zag": LEADER_COLOR_RED,
  "robinet d incendie arme": LEADER_COLOR_RED,
  "systeme securite incendie": LEADER_COLOR_RED,
  "systeme de securite incendie": LEADER_COLOR_RED,
  "telephone de securite incendie": LEADER_COLOR_RED,
  // Static catalogue aliases (lower-case ids)
  "ria": LEADER_COLOR_RED,
  "alarme_incendie": LEADER_COLOR_RED,

  // VERT — #00a651
  "cheminement d evacuation": LEADER_COLOR_GREEN,
  "cheminement d evacu": LEADER_COLOR_GREEN,
  "escalier descendant": LEADER_COLOR_GREEN,
  "espace d attente securise": LEADER_COLOR_GREEN,
  "issue finale": LEADER_COLOR_GREEN,
  "itineraire d evacuation": LEADER_COLOR_GREEN,
  "pharmacie": LEADER_COLOR_GREEN,
  "point de rassemblement": LEADER_COLOR_GREEN,
  // Static catalogue aliases
  "issue_de_secours": LEADER_COLOR_GREEN,
  "eclairage_de_secours": LEADER_COLOR_GREEN,
  "point_rassemblement": LEADER_COLOR_GREEN,
  "fleche_evacuation": LEADER_COLOR_GREEN,

  // BLEU — #3046b8
  "bouche d incendie": LEADER_COLOR_BLUE,
  "poteau d incendie": LEADER_COLOR_BLUE,
  "vous etes ici": LEADER_COLOR_BLUE,

  // JAUNE — #ffd500
  "bouteilles de gaz": LEADER_COLOR_YELLOW,
  "chaufferie": LEADER_COLOR_YELLOW,
  "chaufferier": LEADER_COLOR_YELLOW, // typo source conservée
  "coupure air comprime": LEADER_COLOR_YELLOW,
  "coupure fluides medicaux": LEADER_COLOR_YELLOW,
  "coupure fluides fm medicaux": LEADER_COLOR_YELLOW,
  "coupure gaz": LEADER_COLOR_YELLOW,
  "coupure hydrogene": LEADER_COLOR_YELLOW,
  "coupure oxygene": LEADER_COLOR_YELLOW,
  "coupure electricite basse tension": LEADER_COLOR_YELLOW,
  "coupure electricite bt": LEADER_COLOR_YELLOW,
  "coupure electricite haute tension": LEADER_COLOR_YELLOW,
  "coupure electricite ht": LEADER_COLOR_YELLOW,
  "depot fioul": LEADER_COLOR_YELLOW,
  "depot liquide inflammable": LEADER_COLOR_YELLOW,
  "local electrique": LEADER_COLOR_YELLOW,
  "transformateur": LEADER_COLOR_YELLOW,

  // NOIR / GRIS FONCÉ — #222222
  "acces a une toiture": LEADER_COLOR_DARK,
  "accés à une toiture": LEADER_COLOR_DARK,
  "arret d urgence": LEADER_COLOR_DARK,
  "ascenseur": LEADER_COLOR_DARK,
  "bac a sable": LEADER_COLOR_DARK,
  "commande manuelle d urgence": LEADER_COLOR_DARK,
  "elevateur pour personnes a mobilite reduite": LEADER_COLOR_DARK,
  "elevateur pmr": LEADER_COLOR_DARK,
  "groupe ventilation": LEADER_COLOR_DARK,
  "grouoe ventilisation": LEADER_COLOR_DARK, // typo source conservée
  "groupe climatisation": LEADER_COLOR_DARK,
  "monte charge": LEADER_COLOR_DARK,
};

/**
 * Resolve the leader colour for a pictogram.
 *
 * Priority:
 *   1. an explicit `leaderColor` on the icon/definition (future-proof escape hatch);
 *   2. the exact normalised-name lookup table;
 *   3. the dark fallback `#222222`.
 *
 * `iconType` is the pictogram's identifier (file name without extension for
 * server pictograms, or the lower-case key for the static catalogue); `label`
 * is its display name. Both are matched, accent- and case-insensitively.
 */
/**
 * Normalise a pictogram name for colour-table lookup: lowercase, accents and
 * curly quotes removed, apostrophes/tirets uniformised, whitespace collapsed.
 * Curly quotes (') and the various dash glyphs appear in the on-disk file names
 * and would otherwise break an exact match.
 */
const normalisePictoName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2018\u2019\u02bc`]/g, " ") // any apostrophe → space, then collapsed below
    .replace(/[\u2010-\u2015]/g, "-")        // figure dashes → hyphen
    .replace(/\s+/g, " ")
    .trim();

export function getIconLeaderColor(
  iconType: IconType,
  options?: { leaderColor?: string | null; label?: string; definitions?: Record<IconType, SafetyIconDefinition> }
): string {
  if (options?.leaderColor) return options.leaderColor;
  const normalised = normalisePictoName(`${iconType}`);
  if (PICTOGRAM_LEADER_COLORS[normalised]) return PICTOGRAM_LEADER_COLORS[normalised];
  const labelNorm = normalisePictoName(`${options?.label ?? options?.definitions?.[iconType]?.label ?? ""}`);
  if (PICTOGRAM_LEADER_COLORS[labelNorm]) return PICTOGRAM_LEADER_COLORS[labelNorm];
  // Last-resort substring match against the table keys (handles trailing
  // qualifiers like "à préciser" or double spaces in the source file names).
  for (const key of Object.keys(PICTOGRAM_LEADER_COLORS)) {
    if (normalised.includes(key) || labelNorm.includes(key)) return PICTOGRAM_LEADER_COLORS[key];
  }
  return LEADER_COLOR_DARK;
}

/** Back-compat alias kept for any external caller; routes to the central table. */
export function inferPictogramColor(type: IconType, label?: string): string {
  return getIconLeaderColor(type, { label });
}

export const SAFETY_ICONS: Record<IconType, SafetyIconDefinition> = {
  extincteur: {
    type: "extincteur",
    label: "Extincteur",
    color: "#ef4444", // Red
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="35" y="30" width="30" height="55" rx="5" fill="#ef4444" stroke="white" stroke-width="4"/>
      <path d="M42 20H58M50 20V30" stroke="white" stroke-width="5" stroke-linecap="round"/>
      <path d="M58 20C65 20 70 25 70 32C70 36 67 40 62 42" stroke="white" stroke-width="4" stroke-linecap="round"/>
      <rect x="42" y="40" width="16" height="8" rx="2" fill="white"/>
      <line x1="50" y1="55" x2="50" y2="75" stroke="white" stroke-width="3"/>
    </svg>`
  },
  ria: {
    type: "ria",
    label: "RIA",
    color: "#ef4444", // Red
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="15" width="70" height="70" rx="8" fill="#ef4444" stroke="white" stroke-width="4"/>
      <circle cx="50" cy="50" r="22" stroke="white" stroke-width="5" fill="none"/>
      <path d="M35 50H65M50 35V65" stroke="white" stroke-width="4"/>
      <circle cx="50" cy="50" r="10" fill="white"/>
    </svg>`
  },
  issue_de_secours: {
    type: "issue_de_secours",
    label: "Issue de secours",
    color: "#22c55e", // Green
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="15" width="70" height="70" rx="8" fill="#22c55e" stroke="white" stroke-width="4"/>
      <rect x="35" y="30" width="30" height="50" fill="white"/>
      <path d="M50 55L60 45M60 45H52M60 45V53" stroke="#22c55e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="42" cy="45" r="4" fill="#22c55e"/>
      <path d="M38 65H46" stroke="#22c55e" stroke-width="3"/>
    </svg>`
  },
  alarme_incendie: {
    type: "alarme_incendie",
    label: "Alarme incendie",
    color: "#ef4444",
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="15" width="70" height="70" rx="8" fill="#ef4444" stroke="white" stroke-width="4"/>
      <circle cx="50" cy="45" r="16" fill="white"/>
      <rect x="42" y="62" width="16" height="16" rx="2" fill="white"/>
      <path d="M42 45H58" stroke="#ef4444" stroke-width="4"/>
    </svg>`
  },
  detecteur_incendie: {
    type: "detecteur_incendie",
    label: "Détecteur fumée",
    color: "#3b82f6", // Blue
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="35" fill="#3b82f6" stroke="white" stroke-width="4"/>
      <circle cx="50" cy="50" r="22" stroke="white" stroke-width="3" stroke-dasharray="6 4" fill="none"/>
      <circle cx="50" cy="50" r="8" fill="white"/>
    </svg>`
  },
  eclairage_de_secours: {
    type: "eclairage_de_secours",
    label: "Bloc Secours",
    color: "#22c55e",
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="30" width="70" height="40" rx="6" fill="#22c55e" stroke="white" stroke-width="4"/>
      <circle cx="35" cy="50" r="8" fill="white"/>
      <circle cx="65" cy="50" r="8" fill="white"/>
      <path d="M35 45V55M30 50H40" stroke="#22c55e" stroke-width="3"/>
      <path d="M65 45V55M60 50H70" stroke="#22c55e" stroke-width="3"/>
    </svg>`
  },
  point_rassemblement: {
    type: "point_rassemblement",
    label: "Point rassemblement",
    color: "#22c55e",
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="15" width="70" height="70" rx="8" fill="#22c55e" stroke="white" stroke-width="4"/>
      <circle cx="50" cy="50" r="12" fill="white"/>
      <path d="M28 28L40 40M72 28L60 40M28 72L40 60M72 72L60 60" stroke="white" stroke-width="5" stroke-linecap="round"/>
    </svg>`
  },
  fleche_evacuation: {
    type: "fleche_evacuation",
    label: "Flèche évacuation",
    color: "#22c55e",
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="25" width="70" height="50" rx="6" fill="#22c55e" stroke="white" stroke-width="4"/>
      <path d="M30 50H65M65 50L52 37M65 50L52 63" stroke="white" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
  }
};

export function getSvgDataUrl(type: IconType): string {
  const definition = SAFETY_ICONS[type];
  if (!definition?.svg) return "";
  return `data:image/svg+xml;utf8,${encodeURIComponent(definition.svg)}`;
}

/**
 * Colours a pictogram must keep whatever the user picks: the glyph itself is
 * drawn in white (or black outline) on top of the coloured ground, and swapping
 * it too would erase the drawing.
 */
const RECOLOR_PRESERVED = new Set([
  "none", "transparent", "currentcolor",
  "white", "#fff", "#ffffff",
  "black", "#000", "#000000",
]);

const isPreservedColor = (value: string) => RECOLOR_PRESERVED.has(value.trim().toLowerCase());

/**
 * Repaints an SVG's ground colour.
 *
 * For the built-in library the definition states its own base colour, so the
 * swap is exact. An uploaded pictogram declares nothing, so every fill and
 * stroke that is not part of the glyph is repainted instead — a heuristic, but
 * the only one available without knowing how the file was drawn.
 */
export function recolorSvgMarkup(svg: string, color: string, baseColor?: string): string {
  if (!color) return svg;

  if (baseColor && !isPreservedColor(baseColor)) {
    const escaped = baseColor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return svg.replace(new RegExp(escaped, "gi"), color);
  }

  const attributePaints = Array.from(
    svg.matchAll(/(?:fill|stroke)\s*=\s*(["'])(.*?)\1/gi),
    (match) => match[2]
  );
  const stylesheetPaints = Array.from(
    svg.matchAll(/(?:fill|stroke)\s*:\s*([^;}]+)/gi),
    (match) => match[1].trim()
  );
  const hasChromaticPaint = [...attributePaints, ...stylesheetPaints].some(
    (value) => !isPreservedColor(value)
  );

  // Black is normally useful as an outline and therefore stays untouched on
  // a coloured pictogram. A black-only pictogram is different: black *is* its
  // ground colour (and may even be the SVG default, with no fill attribute).
  // In that case it must follow the colour selected by the user too.
  const shouldRepaint = (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!isPreservedColor(normalized)) return true;
    return !hasChromaticPaint && ["black", "#000", "#000000"].includes(normalized);
  };

  let recolored = svg
    .replace(
      /(fill|stroke)(\s*=\s*)(["'])(.*?)\3/gi,
      (match, attribute, separator, quote, value) =>
        shouldRepaint(value) ? `${attribute}${separator}${quote}${color}${quote}` : match
    )
    .replace(
      /(fill|stroke)(\s*:\s*)([^;}]+)/gi,
      (match, property, separator, value) =>
        shouldRepaint(value) ? `${property}${separator}${color}` : match
    );

  if (!hasChromaticPaint) {
    recolored = recolored.replace(/<svg\b([^>]*)>/i, (root, attributes) => {
      const hasInheritedFill = /\bfill\s*=|\bstyle\s*=\s*(["'])[^"']*\bfill\s*:/i.test(attributes);
      return hasInheritedFill ? root : `<svg${attributes} fill="${color}">`;
    });
  }

  return recolored;
}

const svgToDataUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

/**
 * Source for a pictogram drawn in a chosen colour. Uploaded pictograms live as
 * files, so their markup has to be fetched before it can be repainted; if that
 * fails the original artwork is used rather than showing nothing.
 */
export async function buildRecoloredIconSource(
  type: IconType,
  color: string,
  definitions: Record<string, SafetyIconDefinition> = SAFETY_ICONS
): Promise<string> {
  const definition = definitions[type];
  if (!definition || !color) return getIconImageSource(type, definitions);

  if (definition.svg) {
    return svgToDataUrl(recolorSvgMarkup(definition.svg, color, definition.color));
  }

  if (definition.imageUrl) {
    if (!definition.imageUrl.toLowerCase().includes(".svg")) {
      // A raster pictogram carries no colours to swap.
      return definition.imageUrl;
    }
    try {
      const response = await fetch(definition.imageUrl);
      if (!response.ok) return definition.imageUrl;
      const markup = await response.text();
      return svgToDataUrl(recolorSvgMarkup(markup, color));
    } catch {
      return definition.imageUrl;
    }
  }

  return "";
}

export function getIconImageSource(
  type: IconType,
  definitions: Record<string, SafetyIconDefinition> = SAFETY_ICONS
): string {
  const definition = definitions[type];
  if (!definition) return "";
  if (definition.imageUrl) return definition.imageUrl;
  if (definition.svg) return `data:image/svg+xml;utf8,${encodeURIComponent(definition.svg)}`;
  return "";
}
