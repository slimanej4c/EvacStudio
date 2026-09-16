export type IconType = string;

export interface SafetyIconDefinition {
  type: IconType;
  label: string;
  originalLabel?: string;
  customLabel?: string;
  customLabelScope?: "plan" | "all";
  color: string;
  svg?: string;
  imageUrl?: string;
  fileName?: string;
  /** Standard/category metadata supplied by the server-side catalogue registry. */
  standardKey?: string;
  standardLabel?: string;
  categoryKey?: string;
  categoryLabel?: string;
  subcategoryKey?: string;
  subcategoryLabel?: string;
  /** True only for SVG files uploaded by a user and safe to remove from the library. */
  deletable?: boolean;
  /** Hidden from the library toolbar and icon selection modals (used for legacy compatibility aliases). */
  hiddenFromLibrary?: boolean;
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
  "direction",
  "sens de circulation",
  "acces pompiers",
  "vous etes ici",
  "issue finale",
  "issue de secours",
  "issue",
  "sortie",
  "porte de secours",
  "porte de sortie",
  "escalier",
  "stair",
  "home",
  "maison",
  "personne",
  "person",
  "running man",
  "bonhomme",
  "evacuation",
];

const stripAccents = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const normalizeOrientationText = (value: string) =>
  stripAccents(value).replace(/[^a-z0-9]+/g, " ").trim();

const pictogramLeafKey = (value: string) => {
  const leaf = String(value || "").replace(/\\/g, "/").split(/[/:]/).pop() || "";
  return stripAccents(leaf.replace(/\.[^.]+$/, ""))
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
};

/**
 * Default and previously saved templates predate the standard/category
 * catalogue hierarchy. Their short keys must keep resolving even when the SVG
 * moves to another directory. Targets are deliberately identified by standard
 * plus filename stem rather than by the current full media path.
 */
const LEGACY_TEMPLATE_PICTOGRAM_TARGETS: Record<
  string,
  { standardKey: string; fileStem: string }
> = {
  "10": { standardKey: "other", fileStem: "10" },
  "11": { standardKey: "other", fileStem: "11" },
  "15-118": { standardKey: "other", fileStem: "15-18" },
  "15-18": { standardKey: "other", fileStem: "15-18" },
  air: { standardKey: "other", fileStem: "air" },
  alarme_incendie: { standardKey: "nfx08070", fileStem: "dm" },
  "cheminement evacuation": { standardKey: "other", fileStem: "cheminement evacuation" },
  direction: { standardKey: "other", fileStem: "direction" },
  "ear-svgrepo-com": { standardKey: "other", fileStem: "ear-svgrepo-com" },
  "evacuation-2": { standardKey: "other", fileStem: "evacuation-2" },
  "evacuation-3": { standardKey: "other", fileStem: "evacuation-3" },
  evacuation1: { standardKey: "other", fileStem: "evacuation1" },
  exticnteur: { standardKey: "nfx08070", fileStem: "lutte_ext" },
  extincteur: { standardKey: "nfx08070", fileStem: "lutte_ext" },
  Extincteur: { standardKey: "nfx08070", fileStem: "lutte_ext" },
  fire: { standardKey: "other", fileStem: "fire" },
  icon_10_clean_safe: { standardKey: "nfx08070", fileStem: "dm" },
  icon_10_transparent: { standardKey: "nfx08070", fileStem: "dm" },
  "Déclencheur manuel d’alarme incendie": { standardKey: "nfx08070", fileStem: "dm" },
  icon_11_clean_safe: { standardKey: "other", fileStem: "icon_11_clean_safe" },
  icon_12_clean_safe: { standardKey: "other", fileStem: "icon_12_clean_safe" },
  icon_13_clean_safe: { standardKey: "other", fileStem: "icon_13_clean_safe" },
  icon_14_clean_safe: { standardKey: "nfx08070", fileStem: "rassemblement" },
  icon_15_clean_safe: { standardKey: "other", fileStem: "icon_15_clean_safe" },
  "Issue finale - panneau complet": { standardKey: "nfx08070", fileStem: "is_d" },
  "Issue finale": { standardKey: "nfx08070", fileStem: "is_d" },
  issue_de_secours: { standardKey: "nfx08070", fileStem: "is_d" },
  "mege-phone": { standardKey: "other", fileStem: "mege-phone" },
  Pharmacie: { standardKey: "nfx08070", fileStem: "pharma" },
  point_rassemblement: { standardKey: "nfx08070", fileStem: "rassemblement" },
  "Point de rassemblement": { standardKey: "nfx08070", fileStem: "rassemblement" },
  "Porte coupe-feu": { standardKey: "nfx08070", fileStem: "pcf" },
  ria: { standardKey: "nfx08070", fileStem: "ria" },
  telephone_rouge_final_corrige: { standardKey: "other", fileStem: "telephone_rouge_final_corrige" },
  "Téléphone de sécurité incendie": { standardKey: "nfx08070", fileStem: "tel-urgence" },
  telephone_vert: { standardKey: "other", fileStem: "telephone_vert" },
  "urgence-01": { standardKey: "other", fileStem: "urgence-01" },
  "urgence-02": { standardKey: "other", fileStem: "urgence-02" },
  "urgence-03": { standardKey: "other", fileStem: "urgence-03" },
  "urgence-05": { standardKey: "other", fileStem: "urgence-05" },
  "urgence-sourds": { standardKey: "other", fileStem: "urgence-sourds" },
};

export function withLegacyTemplatePictogramAliases(
  definitions: Record<IconType, SafetyIconDefinition>,
): Record<IconType, SafetyIconDefinition> {
  const result = { ...definitions };
  const catalogueDefinitions = Object.values(definitions).filter(
    (definition) => Boolean(definition.standardKey && definition.fileName),
  );

  Object.entries(LEGACY_TEMPLATE_PICTOGRAM_TARGETS).forEach(([alias, target]) => {
    const match = catalogueDefinitions.find((definition) => (
      definition.standardKey === target.standardKey
      && pictogramLeafKey(definition.fileName || "") === pictogramLeafKey(target.fileStem)
    ));
    if (!match) return;
    // A real server definition already registered under the old key wins if not an alias.
    if (result[alias]?.standardKey && !result[alias]?.hiddenFromLibrary) return;
    result[alias] = { ...match, type: alias, hiddenFromLibrary: true };
  });

  return result;
}

/**
 * Filters and deduplicates pictograms for presentation in the library toolbar
 * and icon selection modals. Hides backward-compatibility aliases and ensures that each
 * pictogram artwork appears exactly once per standard and category folder.
 */
export function getLibraryVisibleIcons(
  definitions: Record<IconType, SafetyIconDefinition>
): SafetyIconDefinition[] {
  const rawIcons = Object.values(definitions);
  const seenKeys = new Set<string>();
  const result: SafetyIconDefinition[] = [];

  // Sort so canonical catalogue definitions (e.g. 'nfx08070:...' or 'other:...') come first
  const sorted = [...rawIcons].sort((a, b) => {
    const aIsCanonical = a.type.includes(":") ? 1 : 0;
    const bIsCanonical = b.type.includes(":") ? 1 : 0;
    return bIsCanonical - aIsCanonical;
  });

  for (const icon of sorted) {
    if (icon.hiddenFromLibrary) continue;
    if (icon.type in LEGACY_TEMPLATE_PICTOGRAM_TARGETS) continue;

    const fileStem = icon.fileName ? pictogramLeafKey(icon.fileName) : null;
    const dedupKey = fileStem && icon.standardKey
      ? `${icon.standardKey}:${icon.categoryKey || ""}:${fileStem}`
      : `${icon.standardKey || "general"}:${icon.categoryKey || "uncategorized"}:${icon.type}`;

    if (seenKeys.has(dedupKey)) {
      continue;
    }
    seenKeys.add(dedupKey);
    result.push(icon);
  }

  return result;
}

/**
 * These NF X 08-070 signs carry a fixed, readable left/right meaning on the
 * printed sheet. They must therefore stay upright when “Vous êtes ici” turns
 * the plan, even though their category or label contains evacuation/issue.
 */
const FIXED_UPRIGHT_ICON_KEYS = new Set(["eas", "is_d", "is_g"]);
const FIXED_UPRIGHT_ICON_LABELS = new Set([
  "espace d attente securise",
  "issue de secours droite",
  "issue de secours gauche",
]);
const DIRECTIONAL_ICON_KEYS = new Set(["chemin", "is_fleche", "is_fleche_diag"]);

export function isFixedUprightIcon(
  type: IconType,
  definitions: Record<IconType, SafetyIconDefinition> = SAFETY_ICONS
): boolean {
  const definition = definitions[type];
  const typeKey = pictogramLeafKey(type);
  const fileKey = pictogramLeafKey(definition?.fileName ?? "");
  const label = normalizeOrientationText(definition?.label ?? "");
  return FIXED_UPRIGHT_ICON_KEYS.has(typeKey)
    || FIXED_UPRIGHT_ICON_KEYS.has(fileKey)
    || FIXED_UPRIGHT_ICON_LABELS.has(label);
}

/** True when the pictogram carries a direction and must follow the plan. */
export function isDirectionalIcon(
  type: IconType,
  definitions: Record<IconType, SafetyIconDefinition> = SAFETY_ICONS
): boolean {
  const definition = definitions[type];
  if (isFixedUprightIcon(type, definitions)) return false;

  const typeKey = pictogramLeafKey(type);
  const fileKey = pictogramLeafKey(definition?.fileName ?? "");
  if (DIRECTIONAL_ICON_KEYS.has(typeKey) || DIRECTIONAL_ICON_KEYS.has(fileKey)) {
    return true;
  }

  // Only inspect the pictogram's leaf identifiers. Server types and filenames
  // include category paths such as "01-evacuation"; reading the complete path
  // made every sign in that folder rotate, including EAS.
  const haystack = normalizeOrientationText(
    `${typeKey} ${definition?.label ?? ""} ${fileKey}`
  );
  return DIRECTIONAL_ICON_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

/** The pictogram whose rotation defines the plan's reading direction. */
export const YOU_ARE_HERE_KEYWORD = "vous etes ici";
const YOU_ARE_HERE_KEYS = new Set(["vous_ici", "vous_etes_ici"]);

export function isYouAreHereIcon(
  type: IconType,
  definitions: Record<IconType, SafetyIconDefinition> = SAFETY_ICONS
): boolean {
  const definition = definitions[type];
  const typeKey = pictogramLeafKey(type);
  const fileKey = pictogramLeafKey(definition?.fileName ?? "");
  const identity = normalizeOrientationText(`${typeKey} ${definition?.label ?? ""} ${fileKey}`);
  return YOU_ARE_HERE_KEYS.has(typeKey)
    || YOU_ARE_HERE_KEYS.has(fileKey)
    || identity.includes(YOU_ARE_HERE_KEYWORD);
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
/** Approximation écran unique du rouge de sécurité NF X 08-070 (RAL 3020). */
export const SAFETY_RED = "#C1121C";
export const LEADER_COLOR_RED = SAFETY_RED;
export const LEADER_COLOR_GREEN = "#00a651";
export const LEADER_COLOR_BLUE = "#3046b8";
export const LEADER_COLOR_YELLOW = "#ffd500";
export const LEADER_COLOR_DARK = "#222222";

/** Exact pictogram name (normalised) → leader colour. Single source of truth. */
const PICTOGRAM_LEADER_COLORS: Record<string, string> = {
  // ROUGE — #C1121C
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
  options?: {
    leaderColor?: string | null;
    iconColor?: string | null;
    label?: string;
    definitions?: Record<IconType, SafetyIconDefinition>;
  }
): string {
  if (options?.leaderColor && options.leaderColor.trim()) return options.leaderColor.trim();
  if (options?.iconColor && options.iconColor.trim()) return options.iconColor.trim();
  const normalised = normalisePictoName(`${iconType}`);
  if (PICTOGRAM_LEADER_COLORS[normalised]) return PICTOGRAM_LEADER_COLORS[normalised];
  const labelNorm = normalisePictoName(`${options?.label ?? options?.definitions?.[iconType]?.label ?? ""}`);
  if (PICTOGRAM_LEADER_COLORS[labelNorm]) return PICTOGRAM_LEADER_COLORS[labelNorm];
  // Last-resort substring match against the table keys (handles trailing
  // qualifiers like "à préciser" or double spaces in the source file names).
  for (const key of Object.keys(PICTOGRAM_LEADER_COLORS)) {
    if (normalised.includes(key) || labelNorm.includes(key)) return PICTOGRAM_LEADER_COLORS[key];
  }
  const defColor = options?.definitions?.[iconType]?.color;
  if (defColor && defColor !== "#ffffff" && defColor !== "transparent") return defColor;
  return LEADER_COLOR_DARK;
}

/** Back-compat alias kept for any external caller; routes to the central table. */
export function inferPictogramColor(type: IconType, label?: string): string {
  return getIconLeaderColor(type, { label });
}

/**
 * A pictogram colour override is deliberately limited to the value produced by
 * the editor's colour controls. Old clipboard/template data can contain values
 * such as `transparent` or `none`; treating those as a real repaint makes the
 * SVG disappear on the white sheet. An invalid value therefore means "keep the
 * original artwork".
 */
export function normalizePictogramColorOverride(color?: string | null): string {
  const normalized = color?.trim().toLowerCase() ?? "";
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : "";
}

export const SAFETY_ICONS: Record<IconType, SafetyIconDefinition> = {
  extincteur: {
    type: "extincteur",
    label: "Extincteur",
    color: SAFETY_RED,
    hiddenFromLibrary: true,
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="35" y="30" width="30" height="55" rx="5" fill="${SAFETY_RED}" stroke="white" stroke-width="4"/>
      <path d="M42 20H58M50 20V30" stroke="white" stroke-width="5" stroke-linecap="round"/>
      <path d="M58 20C65 20 70 25 70 32C70 36 67 40 62 42" stroke="white" stroke-width="4" stroke-linecap="round"/>
      <rect x="42" y="40" width="16" height="8" rx="2" fill="white"/>
      <line x1="50" y1="55" x2="50" y2="75" stroke="white" stroke-width="3"/>
    </svg>`
  },
  ria: {
    type: "ria",
    label: "RIA",
    color: SAFETY_RED,
    hiddenFromLibrary: true,
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="15" width="70" height="70" rx="8" fill="${SAFETY_RED}" stroke="white" stroke-width="4"/>
      <circle cx="50" cy="50" r="22" stroke="white" stroke-width="5" fill="none"/>
      <path d="M35 50H65M50 35V65" stroke="white" stroke-width="4"/>
      <circle cx="50" cy="50" r="10" fill="white"/>
    </svg>`
  },
  issue_de_secours: {
    type: "issue_de_secours",
    label: "Issue de secours",
    color: "#22c55e", // Green
    hiddenFromLibrary: true,
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
    color: SAFETY_RED,
    hiddenFromLibrary: true,
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="15" width="70" height="70" rx="8" fill="${SAFETY_RED}" stroke="white" stroke-width="4"/>
      <circle cx="50" cy="45" r="16" fill="white"/>
      <rect x="42" y="62" width="16" height="16" rx="2" fill="white"/>
      <path d="M42 45H58" stroke="${SAFETY_RED}" stroke-width="4"/>
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
    label: "Point de rassemblement",
    color: "#22c55e",
    hiddenFromLibrary: true,
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

// Immediate canonical key fallbacks before catalog API responses load
SAFETY_ICONS["nfx08070:03-lutte:3a-extincteurs:lutte_ext"] = {
  ...SAFETY_ICONS.extincteur,
  type: "nfx08070:03-lutte:3a-extincteurs:lutte_ext",
  fileName: "lutte_ext.svg",
  standardKey: "nfx08070",
  hiddenFromLibrary: false,
};
SAFETY_ICONS["nfx08070:01-evacuation:is_d"] = {
  ...SAFETY_ICONS.issue_de_secours,
  type: "nfx08070:01-evacuation:is_d",
  fileName: "is_d.svg",
  standardKey: "nfx08070",
  hiddenFromLibrary: false,
};
SAFETY_ICONS["nfx08070:01-evacuation:rassemblement"] = {
  ...SAFETY_ICONS.point_rassemblement,
  type: "nfx08070:01-evacuation:rassemblement",
  fileName: "rassemblement.svg",
  standardKey: "nfx08070",
  hiddenFromLibrary: false,
};
SAFETY_ICONS["nfx08070:02-alerte:dm"] = {
  ...SAFETY_ICONS.alarme_incendie,
  type: "nfx08070:02-alerte:dm",
  fileName: "dm.svg",
  standardKey: "nfx08070",
  hiddenFromLibrary: false,
};
SAFETY_ICONS["nfx08070:03-lutte:ria"] = {
  ...SAFETY_ICONS.ria,
  type: "nfx08070:03-lutte:ria",
  fileName: "ria.svg",
  standardKey: "nfx08070",
  hiddenFromLibrary: false,
};
SAFETY_ICONS["nfx08070:00-reperage:vous-ici"] = {
  type: "nfx08070:00-reperage:vous-ici",
  label: "Vous êtes ici",
  color: "#0b4e82",
  fileName: "vous-ici.svg",
  standardKey: "nfx08070",
  hiddenFromLibrary: false,
};
SAFETY_ICONS["nfx08070:06-eau:poteau"] = {
  type: "nfx08070:06-eau:poteau",
  label: "Poteau d’incendie",
  color: "#0b4e82",
  fileName: "poteau.svg",
  standardKey: "nfx08070",
  hiddenFromLibrary: false,
};
SAFETY_ICONS["nfx08070:13-fluides:coupure-gaz"] = {
  type: "nfx08070:13-fluides:coupure-gaz",
  label: "Coupure gaz",
  color: "#ffd500",
  fileName: "coupure-gaz.svg",
  standardKey: "nfx08070",
  hiddenFromLibrary: false,
};
SAFETY_ICONS["nfx08070:12-elec:coupure-bt"] = {
  type: "nfx08070:12-elec:coupure-bt",
  label: "Coupure électricité basse tension",
  color: "#ffd500",
  fileName: "coupure-bt.svg",
  standardKey: "nfx08070",
  hiddenFromLibrary: false,
};
SAFETY_ICONS["nfx08070:03-lutte:barrage-gene"] = {
  type: "nfx08070:03-lutte:barrage-gene",
  label: "Barrage général",
  color: "#dc2626",
  fileName: "barrage-gene.svg",
  standardKey: "nfx08070",
  hiddenFromLibrary: false,
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

/**
 * Traced/cleaned SVGs rarely keep their paper and white glyphs at exactly
 * `#ffffff`: antialiasing produces values such as `#fefefe`, `#fafbfc` or
 * `#fdeeef`. Repainting those pixels turns the complete viewport into a solid
 * square and erases the symbol. Treat every very-light RGB colour as white
 * while still allowing genuinely coloured pale artwork to be replaced.
 */
function isNearWhiteColor(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    const digits = hex[1];
    const expanded = digits.length === 3
      ? digits.split("").map((digit) => `${digit}${digit}`).join("")
      : digits;
    if (expanded.length === 8 && Number.parseInt(expanded.slice(6, 8), 16) === 0) return true;
    const red = Number.parseInt(expanded.slice(0, 2), 16);
    const green = Number.parseInt(expanded.slice(2, 4), 16);
    const blue = Number.parseInt(expanded.slice(4, 6), 16);
    return Math.min(red, green, blue) >= 218;
  }

  const rgb = normalized.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?))?\s*\)$/
  );
  if (!rgb) return false;
  if (rgb[4] !== undefined && Number(rgb[4]) === 0) return true;
  return Math.min(Number(rgb[1]), Number(rgb[2]), Number(rgb[3])) >= 218;
}

const isPreservedColor = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return RECOLOR_PRESERVED.has(normalized)
    || normalized.startsWith("url(")
    || isNearWhiteColor(normalized);
};

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

const svgMarkupRequests = new Map<string, Promise<string>>();

const definitionUsesSvgFile = (definition: SafetyIconDefinition) =>
  Boolean(
    definition.fileName?.toLowerCase().endsWith(".svg")
    || definition.imageUrl?.split("?", 1)[0].toLowerCase().endsWith(".svg")
    || definition.imageUrl?.toLowerCase().startsWith("data:image/svg+xml")
  );

async function fetchSvgMarkup(imageUrl: string): Promise<string> {
  let pending = svgMarkupRequests.get(imageUrl);
  if (!pending) {
    pending = fetch(imageUrl, { credentials: "include" }).then(async (response) => {
      if (!response.ok) throw new Error(`SVG unavailable (${response.status})`);
      const markup = await response.text();
      if (!/<svg[\s>]/i.test(markup)) throw new Error("Invalid SVG response");
      return markup;
    });
    svgMarkupRequests.set(imageUrl, pending);
  }

  try {
    return await pending;
  } catch (error) {
    // A media session may have expired. Do not permanently cache the failure
    // so a refreshed session can be tried on the next render.
    svgMarkupRequests.delete(imageUrl);
    throw error;
  }
}

/**
 * Browser-renderable source for thumbnails and legends.
 *
 * The media endpoint deliberately serves SVG files as downloads so navigating
 * to one can never execute it as a same-origin document. An <img> combined
 * with `nosniff` therefore cannot display that URL directly. Fetching the
 * validated markup and turning it into a data-image keeps the server policy
 * intact while making the artwork render normally inside the application.
 */
export async function buildIconPreviewSource(
  definition?: SafetyIconDefinition
): Promise<string> {
  if (!definition) return "";
  if (definition.svg) return svgToDataUrl(definition.svg);
  if (!definition.imageUrl) return "";
  if (!definitionUsesSvgFile(definition)) return definition.imageUrl;

  try {
    return svgToDataUrl(await fetchSvgMarkup(definition.imageUrl));
  } catch {
    return definition.imageUrl;
  }
}

/**
 * Makes the SVG viewport follow the exact width and height chosen in the
 * editor. SVG defaults to `meet` (contain), which can leave the artwork at its
 * original proportions even though the pictogram's selection frame changed.
 */
export function makeSvgStretchable(svg: string): string {
  return svg.replace(/<svg\b([^>]*)>/i, (_root, attributes: string) => {
    const withoutAspectRatio = attributes.replace(
      /\s+preserveAspectRatio\s*=\s*(?:"[^"]*"|'[^']*')/gi,
      ""
    );
    return `<svg${withoutAspectRatio} preserveAspectRatio="none">`;
  });
}

/**
 * Source used by pictograms placed on the editable canvas. The SVG fills its
 * outer box exactly; the canvas Transformer keeps that box locked to the
 * artwork's natural aspect ratio during resize.
 */
export async function buildStretchableIconSource(
  type: IconType,
  color = "",
  definitions: Record<string, SafetyIconDefinition> = SAFETY_ICONS
): Promise<string> {
  const definition = definitions[type];
  if (!definition) return "";

  const prepare = (markup: string) =>
    svgToDataUrl(
      makeSvgStretchable(
        color ? recolorSvgMarkup(markup, color, definition.svg ? definition.color : undefined) : markup
      )
    );

  if (definition.svg) return prepare(definition.svg);

  if (definition.imageUrl) {
    if (!definitionUsesSvgFile(definition)) return definition.imageUrl;
    try {
      return prepare(await fetchSvgMarkup(definition.imageUrl));
    } catch {
      return definition.imageUrl;
    }
  }

  return "";
}

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
    if (!definitionUsesSvgFile(definition)) {
      // A raster pictogram carries no colours to swap.
      return definition.imageUrl;
    }
    try {
      const markup = await fetchSvgMarkup(definition.imageUrl);
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
