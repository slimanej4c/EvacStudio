import finalSheetTemplateStatesData from "./finalSheetTemplateStates.json";

/**
 * Sheet templates — the printed sheet described as data instead of as canvas
 * drawing code.
 *
 * The old export built the whole sheet with imperative `context.fillRect` calls
 * inside the editor, so the only way to move anything was a slider in a modal.
 * Here the sheet is a list of blocks with a position, a size and a style: the
 * studio can render them on the Konva stage, the user drags them with the mouse,
 * and the export is a capture of that same stage. One model, no divergence
 * between what you see and what you print.
 *
 * Coordinates are expressed in sheet units. Landscape templates use
 * SHEET_WIDTH × SHEET_HEIGHT; portrait templates swap those axes. Both keep the
 * A-series 1:√2 ratio, so A4 and A3 share the same layouts.
 */

/** Design width of the sheet, in sheet units. */
export const SHEET_WIDTH = 1600;
/** Design height of the sheet: 1600 / √2, rounded. */
export const SHEET_HEIGHT = 1131;
/** Portrait A-series design dimensions used by room-instruction sheets. */
export const PORTRAIT_SHEET_WIDTH = SHEET_HEIGHT;
export const PORTRAIT_SHEET_HEIGHT = SHEET_WIDTH;

export type SheetBlockKind =
  | "background" // a locked full-sheet template image, drawn behind the plan
  | "band" // a coloured bar or pill — the section headings
  | "text" // free text, with optional frame and heading line
  | "numbers" // the emergency numbers, set large
  | "legend" // the auto-built pictogram table
  | "image" // a logo
  | "picto" // a safety pictogram dropped anywhere on the sheet
  | "shape" // a line, rectangle, circle or free path drawn on the sheet
  | "plan"; // the window the plan is drawn into

export type SheetShapeKind =
  | "line"
  | "rect"
  | "circle"
  | "zone"
  | "polyline"
  | "polygon_zone"
  | "free_polygon_zone"
  | "curve_polygon_zone";

export interface SheetShapePoint {
  /** Position normalised inside the block (0 = left/top, 1 = right/bottom). */
  x: number;
  y: number;
}

/** Which uploaded logo an `image` block shows. */
export type SheetImageKey = string;

export interface SheetBlock {
  id: string;
  kind: SheetBlockKind;
  /** For `plan` blocks: identifies if this is the main plan or a secondary inset plan. */
  planSlot?: "main" | "secondary" | "tertiary";
  /** Name shown in the studio's block list. */
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  /** Prevents accidental movement/resizing while keeping the block selectable. */
  locked?: boolean;
  /** Independent editor group. Members are selected and moved together. */
  objectGroupId?: string;

  // ── Content ──────────────────────────────────────────────────────────────
  /** Title bar text. Empty or absent means no title bar. */
  title?: string;
  /** Body text. Line breaks are kept, long lines wrap inside the block. */
  text?: string;
  imageKey?: SheetImageKey;
  /** For `picto` blocks: which safety pictogram is shown. */
  iconType?: string;
  /** Mirror the pictogram artwork without changing its frame geometry. */
  flipX?: boolean;
  flipY?: boolean;
  /** Geometry used by blocks created with the sheet drawing tools. */
  shapeType?: SheetShapeKind;
  shapePoints?: SheetShapePoint[];
  /** Optional Bézier handles, normalised inside the shape block by segment. */
  shapeControlPoints?: Record<number, SheetShapePoint>;
  shapeClosed?: boolean;
  shapeStraightSegments?: number[];
  shapeTension?: number;
  fillOpacity?: number;

  // ── Style ────────────────────────────────────────────────────────────────
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  /** Body text colour. */
  color?: string;
  fontSize?: number;
  /** Konva font style: "normal", "bold", "italic", "italic bold". */
  fontStyle?: string;
  align?: "left" | "center" | "right";
  /** Vertical placement of the body inside the block. */
  verticalAlign?: "top" | "middle" | "bottom";
  lineHeight?: number;
  letterSpacing?: number;
  padding?: number;
  /** Draw the body in capitals, as regulatory notices are set. */
  uppercase?: boolean;

  titleFill?: string;
  titleColor?: string;
  titleFontSize?: number;
  titleHeight?: number;
  titleAlign?: "left" | "center" | "right";
  titleLetterSpacing?: number;
  /** Rule under the heading — the ruled tables, not the coloured pills. */
  titleRule?: boolean;
}

export const SHEET_TEMPLATES = {
  nfx08070: {
    label: "NF X08-070",
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
    description:
      "Feuille normalisée : bandeau rouge, consignes incendie / évacuation / prévention à gauche, plan au centre, identité et légende à droite."
  },
  intervention_multiniveaux: {
    label: "Intervention multi-niveaux",
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
    description:
      "Feuille d'intervention inspirée du modèle fourni : bandeau rouge, grande composition de plusieurs niveaux, identité et légende à droite."
  },
  evacuation_consigne_gauche: {
    label: "Évacuation avec consignes",
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
    description:
      "Feuille d'évacuation à bandeau vert : consignes à gauche, plan au centre, identité et légende à droite."
  },
  consignes_chambre: {
    label: "Consignes de chambre",
    width: PORTRAIT_SHEET_WIDTH,
    height: PORTRAIT_SHEET_HEIGHT,
    description:
      "Feuille portrait pour hôtel ou hébergement : plan, légende, point de rassemblement et consignes multilingues."
  },
  official_a2_pay_pi: {
    label: "Officiel A2 PAY PI",
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
    paper: "a2",
    description: "Template officiel A2 paysage éditable : bandeau intervention et grande zone de plan."
  },
  official_a3_pe_pay: {
    label: "Officiel A3 PE PAY",
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
    paper: "a3",
    description: "Template officiel A3 paysage PE editable."
  },
  official_a3_pi_pay: {
    label: "Officiel A3 PI PAY",
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
    paper: "a3",
    description: "Template officiel A3 paysage PI editable."
  },
  official_a3_pi_port: {
    label: "Officiel A3 PI PORT",
    width: PORTRAIT_SHEET_WIDTH,
    height: PORTRAIT_SHEET_HEIGHT,
    paper: "a3",
    description: "Template officiel A3 portrait PI editable."
  },
  official_a3_pe_ph_por: {
    label: "Officiel A3 PE PH POR",
    width: PORTRAIT_SHEET_WIDTH,
    height: PORTRAIT_SHEET_HEIGHT,
    paper: "a3",
    description: "Template officiel A3 portrait PE PH editable."
  },
  official_ph_pe_a3_pay: {
    label: "Officiel PH PE A3 PAY",
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
    paper: "a3",
    description: "Template officiel A3 paysage PH PE editable."
  },
  official_ph_pi_a3_pay: {
    label: "Officiel PH PI A3 PAY",
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
    paper: "a3",
    description: "Template officiel A3 paysage PH PI editable."
  },
  official_pi_a3_ph_por: {
    label: "Officiel PI A3 PH POR",
    width: PORTRAIT_SHEET_WIDTH,
    height: PORTRAIT_SHEET_HEIGHT,
    paper: "a3",
    description: "Template officiel A3 portrait PI PH editable."
  },
  official_psi_a3_ph_pay: {
    label: "Officiel PSI A3 PH PAY",
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
    paper: "a3",
    description: "Template officiel A3 paysage PSI PH editable."
  },
  official_psi_ph_a3_por: {
    label: "Officiel PSI PH A3 POR",
    width: PORTRAIT_SHEET_WIDTH,
    height: PORTRAIT_SHEET_HEIGHT,
    paper: "a3",
    description: "Template officiel A3 portrait PSI PH editable."
  },
  official_pe_a3_port: {
    label: "Officiel PE A3 PORT",
    width: PORTRAIT_SHEET_WIDTH,
    height: PORTRAIT_SHEET_HEIGHT,
    paper: "a3",
    description: "Template officiel A3 portrait PE editable."
  },
  official_pi_a2_port: {
    label: "Officiel PI A2 PORT",
    width: PORTRAIT_SHEET_WIDTH,
    height: PORTRAIT_SHEET_HEIGHT,
    paper: "a2",
    description: "Template officiel A2 portrait PI editable."
  }
} as const;

export type SheetTemplateKey = keyof typeof SHEET_TEMPLATES;

// ── NF X08-070 default copy ──────────────────────────────────────────────────

const NF_EVACUATION_TEXT = [
  "1 - SI L'INCENDIE SE DECLARE CHEZ VOUS ET VOUS NE POUVEZ PAS L'ETEINDRE IMMEDIATEMENT :",
  "- EVACUEZ LES LIEUX ;",
  "- FERMEZ LA PORTE DE VOTRE APPARTEMENT ;",
  "- PRENDRE LA SORTIE LA PLUS PROCHE.",
  "",
  "2 - SI L'INCENDIE EST AU DESSOUS DE VOTRE PALIER :",
  "- RESTEZ CHEZ VOUS ;",
  "- FERMEZ LA PORTE DE VOTRE APPARTEMENT ET MOUILLEZ-LA ;",
  "- MANIFESTEZ-VOUS A VOTRE FENETRE.",
  "",
  "3 - SI L'INCENDIE EST AU DESSUS DE VOTRE PALIER :",
  "- PRENDRE LA SORTIE LA PLUS PROCHE.",
  "",
  "NE PAS UTILISER LES ASCENSEURS."
].join("\n");

const NF_PREVENTION_TEXT = [
  "EN CAS DE FUMEES, BAISSEZ-VOUS. L'AIR FRAIS EST PRES DU SOL.",
  "N'ENTREZ JAMAIS DANS LA FUMEE.",
  "N'ENCOMBREZ PAS LES PALIERS ET LES CIRCULATIONS.",
  "EN CAS D'INCENDIE, VEILLEZ A FERMER LES PORTES ET FENETRES DERRIERE VOUS, POUR LIMITER LA PROPAGATION DES FLAMMES."
].join("\n\n");

/** Palette of the normative sheet. Every block references it, so recolouring one
 *  entry in the studio only touches the blocks the user picked. */
export const NF_COLORS = {
  red: "#ed1c24",
  green: "#00a651",
  yellow: "#ffd500",
  /** The PREVENTION heading is the muted olive of the printed plate. */
  olive: "#b0aa00",
  text: "#1a1a1a",
  paper: "#ffffff",
  rule: "#1a1a1a"
} as const;

export interface SheetTemplateContext {
  /** Banner title. */
  planTitle?: string;
  /** Site address, one line per row. */
  siteName?: string;
}

export interface SheetPlanPlacement {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface FinalSheetTemplateState {
  blocks: SheetBlock[];
  planPlacement: SheetPlanPlacement;
}

const FINAL_SHEET_TEMPLATE_STATES = (
  finalSheetTemplateStatesData as unknown as {
    templates: Record<SheetTemplateKey, FinalSheetTemplateState>;
  }
).templates;

const FINAL_TEMPLATE_TITLE_BLOCK_IDS: Record<SheetTemplateKey, string> = {
  nfx08070: "nf-banner",
  intervention_multiniveaux: "intervention-banner",
  evacuation_consigne_gauche: "evac-green-banner",
  consignes_chambre: "room-title",
  official_a2_pay_pi: "official_a2_pay_pi-title",
  official_a3_pe_pay: "official_a3_pe_pay-modern-landscape-header-title",
  official_a3_pi_pay: "official_a3_pi_pay-header",
  official_a3_pi_port: "official_a3_pi_port-header",
  official_a3_pe_ph_por: "official_a3_pe_ph_por-pe-02-bandeau-plan-de-securite-incendie",
  official_ph_pe_a3_pay: "official_ph_pe_a3_pay-pe-landscape-header-title",
  official_ph_pi_a3_pay: "official_ph_pi_a3_pay-header",
  official_pi_a3_ph_por: "official_pi_a3_ph_por-pi-portrait-title",
  official_psi_ph_a3_por: "official_psi_ph_a3_por-psi-header",
  official_psi_a3_ph_pay: "official_psi_a3_ph_pay-header",
  official_pe_a3_port: "official_pe_a3_port-modern-header-title",
  official_pi_a2_port: "official_pi_a2_port-header",
};

const FINAL_TEMPLATE_SITE_BLOCKS: Partial<Record<
  SheetTemplateKey,
  { id: string; fallback: string }
>> = {
  nfx08070: { id: "nf-site", fallback: "" },
  intervention_multiniveaux: {
    id: "intervention-site",
    fallback: "NOM ET ADRESSE DU SITE",
  },
  evacuation_consigne_gauche: {
    id: "evac-green-site",
    fallback: "NOM ET ADRESSE DU SITE",
  },
};

/**
 * Immutable studio-approved templates exported on 23 August 2026. Their
 * geometry and pictogram choices are versioned with Git, while the few fields
 * that belong to the current plan remain dynamic.
 */
function createFinalSheetBlocks(
  template: SheetTemplateKey,
  context: SheetTemplateContext
): SheetBlock[] | null {
  const finalState = FINAL_SHEET_TEMPLATE_STATES[template];
  if (!finalState) return null;

  const blocks = JSON.parse(JSON.stringify(finalState.blocks)) as SheetBlock[];
  const titleBlockId = FINAL_TEMPLATE_TITLE_BLOCK_IDS[template];
  const siteBlock = FINAL_TEMPLATE_SITE_BLOCKS[template];

  return blocks.map((block) => {
    if (context.planTitle && block.id === titleBlockId) {
      return { ...block, text: context.planTitle };
    }
    if (siteBlock && block.id === siteBlock.id) {
      return { ...block, text: context.siteName || siteBlock.fallback };
    }
    return block;
  });
}

export function createSheetPlanPlacement(template: SheetTemplateKey): SheetPlanPlacement {
  const placement = FINAL_SHEET_TEMPLATE_STATES[template]?.planPlacement;
  return placement
    ? { ...placement }
    : { scale: 100, offsetX: 0, offsetY: 0 };
}

/**
 * The NF X08-070 sheet as blocks, laid out like the printed plate: a rounded red
 * banner, a narrow instruction column on the left whose headings are coloured
 * pills, the plan filling the rest of the page, and the client's identity and
 * the legend floating over it on the right.
 */
export function createNfx08070Blocks(context: SheetTemplateContext = {}): SheetBlock[] {
  const leftX = 20;
  const leftW = 330;
  // The boxed emergency numbers are inset from the column, as on the plate.
  const boxX = leftX + 26;
  const boxW = leftW - 52;
  const rightW = 320;
  const rightX = SHEET_WIDTH - 20 - rightW;

  /** A section heading: a coloured pill, white capitals, centred. */
  const pill = (
    id: string,
    label: string,
    y: number,
    fill: string,
    color = "#ffffff"
  ): SheetBlock => ({
    id,
    kind: "band",
    label: `Titre ${label}`,
    x: leftX,
    y,
    width: leftW,
    height: 36,
    rotation: 0,
    visible: true,
    text: label,
    fill,
    cornerRadius: 18,
    color,
    fontSize: 22,
    fontStyle: "bold",
    align: "center",
    verticalAlign: "middle",
    lineHeight: 1,
    letterSpacing: 1,
    padding: 8,
    uppercase: true
  });

  /** Free copy under a heading: centred, no frame. */
  const copy = (
    id: string,
    label: string,
    y: number,
    height: number,
    text: string,
    fontSize: number
  ): SheetBlock => ({
    id,
    kind: "text",
    label,
    x: leftX,
    y,
    width: leftW,
    height,
    rotation: 0,
    visible: true,
    text,
    color: NF_COLORS.text,
    fontSize,
    fontStyle: "bold",
    align: "center",
    verticalAlign: "top",
    lineHeight: 1.35,
    letterSpacing: 0,
    padding: 4,
    uppercase: true
  });

  /**
   * A boxed emergency number: the number itself as the heading, set large in the
   * box's colour, and the "state the exact place" reminder under it.
   */
  const numberBox = (
    id: string,
    label: string,
    y: number,
    numbers: string,
    accent: string
  ): SheetBlock => ({
    id,
    kind: "numbers",
    label,
    x: boxX,
    y,
    width: boxW,
    height: 92,
    rotation: 0,
    visible: true,
    title: numbers,
    titleColor: accent,
    titleFontSize: 30,
    titleHeight: 44,
    titleAlign: "center",
    text: "EN PRECISANT LE LIEU EXACT DE L'ACCIDENT.",
    fill: NF_COLORS.paper,
    stroke: accent,
    strokeWidth: 2,
    cornerRadius: 6,
    color: NF_COLORS.text,
    fontSize: 11.5,
    fontStyle: "bold",
    align: "center",
    verticalAlign: "top",
    lineHeight: 1.3,
    padding: 8,
    uppercase: true
  });

  return [
    {
      id: "nf-banner",
      kind: "band",
      label: "Bandeau titre",
      x: 10,
      y: 8,
      width: SHEET_WIDTH - 20,
      height: 70,
      rotation: 0,
      visible: true,
      text: context.planTitle || "PLAN DE SECURITE INCENDIE",
      fill: NF_COLORS.red,
      cornerRadius: 6,
      color: "#ffffff",
      fontSize: 40,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      letterSpacing: 2,
      lineHeight: 1,
      padding: 10,
      uppercase: true
    },
    {
      id: "nf-conformity",
      kind: "text",
      label: "Mention de conformité",
      x: 22,
      y: 56,
      width: 430,
      height: 18,
      rotation: 0,
      visible: true,
      text: "CONFORME A LA NF X08-070 ET ARRETE DU 19/06/2015",
      color: "#ffffff",
      fontSize: 10.5,
      fontStyle: "bold",
      align: "left",
      verticalAlign: "middle",
      lineHeight: 1.2,
      padding: 0,
      uppercase: true
    },

    // ── Left column: the regulatory notices ─────────────────────────────────
    pill("nf-fire-title", "INCENDIE", 100, NF_COLORS.red),
    copy(
      "nf-fire",
      "Appel des secours",
      146,
      44,
      "VEUILLEZ APPELER LES SERVICES DE SECOURS EN COMPOSANT LE :",
      12
    ),
    numberBox("nf-fire-numbers", "Numéros pompiers", 196, "18 ou 112", NF_COLORS.red),

    pill("nf-evacuation-title", "EVACUATION", 300, NF_COLORS.green),
    copy("nf-evacuation", "Consigne évacuation", 346, 262, NF_EVACUATION_TEXT, 11.5),

    copy("nf-medical-title", "Titre accident ou malaise", 616, 24, "ACCIDENT OU MALAISE", 14),
    numberBox("nf-medical-numbers", "Numéros SAMU", 646, "15 ou 118", NF_COLORS.green),

    {
      id: "nf-deaf",
      kind: "text",
      label: "Numéro 114",
      x: boxX,
      y: 748,
      width: boxW,
      height: 72,
      rotation: 0,
      visible: true,
      text: "Numéro d'urgence pour les personnes ayant des soucis à entendre ou à parler.",
      fill: NF_COLORS.paper,
      stroke: NF_COLORS.red,
      strokeWidth: 1.5,
      cornerRadius: 6,
      color: NF_COLORS.red,
      fontSize: 11.5,
      fontStyle: "normal",
      align: "center",
      verticalAlign: "middle",
      lineHeight: 1.3,
      padding: 8
    },

    pill("nf-prevention-title", "PREVENTION", 832, NF_COLORS.olive),
    copy("nf-prevention", "Prévention", 878, 178, NF_PREVENTION_TEXT, 11.5),

    {
      id: "nf-studio-logo",
      kind: "image",
      label: "Logo studio",
      imageKey: "studioLogo",
      x: leftX,
      y: 1056,
      width: 220,
      height: 66,
      rotation: 0,
      visible: true
    },

    // ── The plan: the whole area right of the notices ───────────────────────
    // No rule around it — on the plate the drawing sits straight on the paper,
    // and the identity and legend float over this same area.
    {
      id: "nf-plan",
      kind: "plan",
      planSlot: "main",
      label: "Plan principal (fenêtre)",
      x: leftX + leftW + 24,
      y: 96,
      width: SHEET_WIDTH - 20 - (leftX + leftW + 24),
      height: SHEET_HEIGHT - 96 - 20,
      rotation: 0,
      visible: true,
      fill: NF_COLORS.paper,
      stroke: NF_COLORS.rule,
      strokeWidth: 0,
      cornerRadius: 0
    },

    // ── Right: identity at the top, legend at the bottom ────────────────────
    {
      id: "nf-client-logo",
      kind: "image",
      label: "Logo client",
      imageKey: "clientLogo",
      x: rightX + 30,
      y: 104,
      width: rightW - 60,
      height: 100,
      rotation: 0,
      visible: true
    },
    {
      id: "nf-site",
      kind: "text",
      label: "Adresse du site",
      x: rightX - 20,
      y: 218,
      width: rightW + 40,
      height: 66,
      rotation: 0,
      visible: true,
      text: context.siteName || "",
      color: NF_COLORS.text,
      fontSize: 21,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "top",
      lineHeight: 1.35,
      padding: 0,
      uppercase: true
    },
    {
      id: "nf-legend",
      kind: "legend",
      label: "Légende",
      x: rightX,
      y: 715,
      width: rightW,
      height: 392,
      rotation: 0,
      visible: true,
      title: "LEGENDE",
      titleColor: NF_COLORS.text,
      titleFontSize: 17,
      titleHeight: 34,
      titleAlign: "center",
      titleLetterSpacing: 0.5,
      titleRule: true,
      fill: NF_COLORS.paper,
      stroke: NF_COLORS.rule,
      strokeWidth: 1.5,
      color: NF_COLORS.text,
      fontSize: 11,
      padding: 8
    }
  ];
}

/**
 * Intervention sheet based on the supplied multi-level reference. The plan
 * window deliberately remains one large surface: users can import and arrange
 * several floor plans freely in Plan seul, then the complete composition is
 * fitted here without duplicating or detaching any of its pictograms.
 */
export function createInterventionMultiniveauxBlocks(
  context: SheetTemplateContext = {}
): SheetBlock[] {
  const red = "#f20d0d";
  const grey = "#9b9b9b";
  const text = "#1a1a1a";
  const paper = "#ffffff";
  const rightX = 1288;
  const rightW = 284;

  const levelBand = (id: string, label: string, x: number, y: number, width = 170): SheetBlock => ({
    id,
    kind: "band",
    label: `Niveau ${label}`,
    x,
    y,
    width,
    height: 36,
    rotation: 0,
    visible: true,
    text: label,
    fill: grey,
    stroke: "#777777",
    strokeWidth: 1,
    color: "#ffffff",
    fontSize: 18,
    fontStyle: "bold",
    align: "center",
    verticalAlign: "middle",
    letterSpacing: 0.5,
    padding: 5,
    uppercase: true
  });

  return [
    {
      id: "intervention-banner",
      kind: "band",
      label: "Bandeau Plan d'intervention",
      x: 8,
      y: 8,
      width: SHEET_WIDTH - 16,
      height: 72,
      rotation: 0,
      visible: true,
      text: context.planTitle || "PLAN D'INTERVENTION",
      fill: red,
      color: "#ffffff",
      fontSize: 43,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      letterSpacing: 1.2,
      lineHeight: 1,
      padding: 8,
      uppercase: true
    },
    {
      id: "intervention-conformity",
      kind: "text",
      label: "Mention de conformité",
      x: 14,
      y: 57,
      width: 470,
      height: 18,
      rotation: 0,
      visible: true,
      text: "CONFORME À LA NF X08-070 ET ARRÊTÉ DU 19/06/2015",
      color: "#ffffff",
      fontSize: 9.5,
      fontStyle: "normal",
      align: "left",
      verticalAlign: "middle",
      lineHeight: 1,
      padding: 0,
      uppercase: true
    },

    // The whole multi-plan composition lives here. Imported plans, their
    // pictograms, zones and labels therefore retain their existing grouping.
    {
      id: "intervention-plan",
      kind: "plan",
      planSlot: "main",
      label: "Composition des niveaux (fenêtre)",
      x: 26,
      y: 98,
      width: 1238,
      height: SHEET_HEIGHT - 120,
      rotation: 0,
      visible: true,
      fill: paper,
      stroke: "#d4d4d4",
      strokeWidth: 0,
      cornerRadius: 0
    },

    // Editable level markers reproduce the three captions in the reference.
    levelBand("intervention-level-minus-2", "NIVEAU -2", 70, 730, 150),
    levelBand("intervention-level-minus-1", "NIVEAU -1", 555, 1052, 165),

    // Right identity / legend column.
    {
      id: "intervention-client-logo",
      kind: "image",
      label: "Logo client",
      imageKey: "clientLogo",
      x: rightX + 22,
      y: 112,
      width: rightW - 44,
      height: 108,
      rotation: 0,
      visible: true
    },
    {
      id: "intervention-site",
      kind: "text",
      label: "Nom et adresse du site",
      x: rightX,
      y: 228,
      width: rightW,
      height: 112,
      rotation: 0,
      visible: true,
      text: context.siteName || "NOM ET ADRESSE DU SITE",
      color: text,
      fontSize: 18,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "top",
      lineHeight: 1.25,
      padding: 4,
      uppercase: true
    },
    {
      id: "intervention-right-level",
      kind: "band",
      label: "Niveau principal",
      x: rightX + 15,
      y: 354,
      width: rightW - 30,
      height: 38,
      rotation: 0,
      visible: true,
      text: "REZ-DE-CHAUSSÉE",
      fill: grey,
      stroke: "#777777",
      strokeWidth: 1,
      color: "#ffffff",
      fontSize: 17,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      padding: 5,
      uppercase: true
    },
    {
      id: "intervention-legend",
      kind: "legend",
      label: "Légende intervention",
      x: rightX + 20,
      y: 410,
      width: rightW - 40,
      height: 492,
      rotation: 0,
      visible: true,
      title: "LÉGENDE",
      titleColor: text,
      titleFontSize: 18,
      titleHeight: 36,
      titleAlign: "center",
      titleLetterSpacing: 0.5,
      titleRule: true,
      fill: paper,
      stroke: "#777777",
      strokeWidth: 1.5,
      color: text,
      fontSize: 10.5,
      padding: 7
    },
    {
      id: "intervention-studio-logo",
      kind: "image",
      label: "Logo créateur",
      imageKey: "studioLogo",
      x: rightX + 14,
      y: 928,
      width: rightW - 28,
      height: 158,
      rotation: 0,
      visible: true
    }
  ];
}

/**
 * Evacuation sheet based on the supplied green-header reference. Instructions
 * remain independent editable blocks while the real plan and all of its
 * annotations stay together in the central plan window.
 */
export function createEvacuationConsigneGaucheBlocks(
  context: SheetTemplateContext = {}
): SheetBlock[] {
  const green = "#07951a";
  const red = "#f11818";
  const yellow = "#ffd82f";
  const grey = "#969696";
  const text = "#171717";
  const paper = "#ffffff";
  const leftX = 18;
  const leftW = 292;
  const rightX = 1320;
  const rightW = 252;

  const instructionTitle = (
    id: string,
    label: string,
    y: number,
    fill: string,
    color = "#ffffff"
  ): SheetBlock => ({
    id,
    kind: "band",
    label: `Titre ${label}`,
    x: leftX,
    y,
    width: leftW,
    height: 34,
    rotation: 0,
    visible: true,
    text: label,
    fill,
    cornerRadius: 17,
    color,
    fontSize: 22,
    fontStyle: "bold",
    align: "left",
    verticalAlign: "middle",
    lineHeight: 1,
    letterSpacing: 0.5,
    padding: 15,
    uppercase: true
  });

  const instructionCopy = (
    id: string,
    label: string,
    y: number,
    height: number,
    value: string
  ): SheetBlock => ({
    id,
    kind: "text",
    label,
    x: leftX + 4,
    y,
    width: leftW - 8,
    height,
    rotation: 0,
    visible: true,
    text: value,
    color: text,
    fontSize: 11.5,
    fontStyle: "bold",
    align: "center",
    verticalAlign: "top",
    lineHeight: 1.24,
    padding: 4,
    uppercase: true
  });

  return [
    {
      id: "evac-green-banner",
      kind: "band",
      label: "Bandeau Plan d'évacuation",
      x: 8,
      y: 12,
      width: SHEET_WIDTH - 16,
      height: 72,
      rotation: 0,
      visible: true,
      text: context.planTitle || "PLAN D'ÉVACUATION",
      fill: green,
      color: "#ffffff",
      fontSize: 42,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      letterSpacing: 1.2,
      lineHeight: 1,
      padding: 8,
      uppercase: true
    },
    {
      id: "evac-green-header-picto",
      kind: "picto",
      label: "Pictogramme sortie du bandeau",
      iconType: "issue_de_secours",
      x: 488,
      y: 18,
      width: 58,
      height: 58,
      rotation: 0,
      visible: true
    },
    {
      id: "evac-green-conformity",
      kind: "text",
      label: "Mention de conformité",
      x: 1270,
      y: 56,
      width: 300,
      height: 18,
      rotation: 0,
      visible: true,
      text: "CONFORME À LA NORME NF X08-070",
      color: "#ffffff",
      fontSize: 9.5,
      fontStyle: "normal",
      align: "right",
      verticalAlign: "middle",
      padding: 0,
      uppercase: true
    },

    instructionTitle("evac-green-fire-title", "INCENDIE", 132, red),
    instructionCopy(
      "evac-green-fire-copy",
      "Consigne incendie",
      174,
      176,
      "EN CAS D'INCENDIE, GARDEZ VOTRE CALME ET DÉCLENCHEZ LE BOÎTIER LE PLUS PROCHE.\n\nATTAQUEZ LE FOYER PAR LA BASE AU MOYEN DES EXTINCTEURS SANS PRENDRE DE RISQUES.\n\nDANS LA CHALEUR ET LA FUMÉE, BAISSEZ-VOUS, L'AIR FRAIS EST PRÈS DU SOL.\n\nAPPEL D'URGENCE : 18 OU 112"
    ),
    instructionTitle("evac-green-evacuation-title", "ÉVACUATION", 360, green),
    instructionCopy(
      "evac-green-evacuation-copy",
      "Consigne évacuation",
      402,
      156,
      "À L'AUDITION DU SIGNAL OU SUR ORDRE D'UN RESPONSABLE, FERMEZ LES PORTES ET LES FENÊTRES.\n\nSUIVEZ LES INDICATIONS DU GUIDE OU DIRIGEZ-VOUS VERS LES SORTIES LES PLUS PROCHES.\n\nN'UTILISEZ PAS LES ASCENSEURS. MONTE-CHARGES S'ILS EXISTENT.\n\nNE REVENEZ PAS EN ARRIÈRE SANS Y AVOIR ÉTÉ INVITÉ."
    ),
    instructionTitle("evac-green-prevention-title", "PRÉVENTION", 568, yellow, text),
    instructionCopy(
      "evac-green-prevention-copy",
      "Consigne prévention",
      610,
      128,
      "FERMEZ FENÊTRES ET PORTES EN QUITTANT LES LIEUX.\n\nN'ENCOMBREZ PAS LE MATÉRIEL INCENDIE, LES ISSUES ET LES CIRCULATIONS.\n\nIL EST FORMELLEMENT INTERDIT DE FUMER ET DE VAPOTER."
    ),
    {
      id: "evac-green-assembly-box",
      kind: "text",
      label: "Point de rassemblement",
      x: leftX + 6,
      y: 758,
      width: leftW - 12,
      height: 90,
      rotation: 0,
      visible: true,
      text: "POINT DE RASSEMBLEMENT :",
      fill: paper,
      stroke: green,
      strokeWidth: 1.5,
      color: text,
      fontSize: 12,
      fontStyle: "normal",
      align: "right",
      verticalAlign: "top",
      lineHeight: 1.2,
      padding: 12,
      uppercase: true
    },
    {
      id: "evac-green-assembly-picto",
      kind: "picto",
      label: "Pictogramme point de rassemblement",
      iconType: "point_rassemblement",
      x: leftX + 16,
      y: 770,
      width: 66,
      height: 66,
      rotation: 0,
      visible: true
    },
    {
      id: "evac-green-114",
      kind: "text",
      label: "Numéro d'urgence 114",
      x: leftX + 6,
      y: 860,
      width: leftW - 12,
      height: 90,
      rotation: 0,
      visible: true,
      text: "114\nNUMÉRO D'URGENCE POUR LES PERSONNES AYANT DES SOUCIS À ENTENDRE OU À PARLER.",
      fill: paper,
      stroke: red,
      strokeWidth: 1.5,
      color: red,
      fontSize: 12,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      lineHeight: 1.2,
      padding: 8,
      uppercase: true
    },
    {
      id: "evac-green-studio-logo",
      kind: "image",
      label: "Logo créateur",
      imageKey: "studioLogo",
      x: leftX + 18,
      y: 978,
      width: leftW - 36,
      height: 116,
      rotation: 0,
      visible: true
    },

    // Central plan, including every pictogram, zone and text already attached
    // to it in the editor.
    {
      id: "evac-green-plan",
      kind: "plan",
      planSlot: "main",
      label: "Plan d'évacuation (fenêtre)",
      x: 340,
      y: 350,
      width: 950,
      height: 590,
      rotation: 0,
      visible: true,
      fill: paper,
      stroke: "#d4d4d4",
      strokeWidth: 0,
      cornerRadius: 0
    },
    {
      id: "evac-green-level",
      kind: "band",
      label: "Niveau du plan",
      x: 740,
      y: 956,
      width: 180,
      height: 38,
      rotation: 0,
      visible: true,
      text: "NIVEAU -2",
      fill: grey,
      stroke: "#777777",
      strokeWidth: 1,
      color: "#ffffff",
      fontSize: 18,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      padding: 5,
      uppercase: true
    },

    // Client identity and automatic legend on the right.
    {
      id: "evac-green-client-logo",
      kind: "image",
      label: "Logo client",
      imageKey: "clientLogo",
      x: 1145,
      y: 140,
      width: 300,
      height: 108,
      rotation: 0,
      visible: true
    },
    {
      id: "evac-green-site",
      kind: "text",
      label: "Nom et adresse du site",
      x: 1125,
      y: 252,
      width: 340,
      height: 94,
      rotation: 0,
      visible: true,
      text: context.siteName || "NOM ET ADRESSE DU SITE",
      color: text,
      fontSize: 18,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "top",
      lineHeight: 1.25,
      padding: 2,
      uppercase: true
    },
    {
      id: "evac-green-legend",
      kind: "legend",
      label: "Légende évacuation",
      x: rightX,
      y: 470,
      width: rightW,
      height: 450,
      rotation: 0,
      visible: true,
      title: "LÉGENDE",
      titleColor: text,
      titleFontSize: 18,
      titleHeight: 36,
      titleAlign: "center",
      titleLetterSpacing: 0.5,
      titleRule: true,
      fill: paper,
      stroke: "#777777",
      strokeWidth: 1.5,
      color: text,
      fontSize: 10.5,
      padding: 7
    }
  ];
}

/** Portrait hotel / accommodation evacuation sheet from the supplied room
 * instruction reference. The four language panels are editable independently,
 * as are the level, footer fields, logos and assembly-point wording. */
export function createConsignesChambreBlocks(
  context: SheetTemplateContext = {}
): SheetBlock[] {
  const width = PORTRAIT_SHEET_WIDTH;
  const height = PORTRAIT_SHEET_HEIGHT;
  const purple = "#312783";
  const green = "#079447";
  const text = "#171717";
  const paper = "#ffffff";

  const instructionElements = (
    language: "fr" | "en" | "de" | "es",
    label: string,
    flag: string,
    title: string,
    subtitle: string,
    body: string,
    x: number,
    y: number
  ): SheetBlock[] => [
    {
      id: `room-${language}-flag`,
      kind: "text",
      label: `Drapeau - ${label}`,
      x: x - 9,
      y: y - 3,
      width: 80,
      height: 60,
      rotation: 0,
      visible: true,
      text: flag,
      color: text,
      fontSize: 33.5,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      lineHeight: 1.3,
      padding: 6,
      uppercase: false,
    },
    {
      id: `room-${language}-frame`,
      kind: "shape",
      label: `Cadre - ${label}`,
      x: x + 2,
      y: y + 3,
      width: 447,
      height: 239,
      rotation: 0,
      visible: true,
      shapeType: "rect",
      shapePoints: [],
      shapeClosed: false,
      shapeStraightSegments: [],
      stroke: "#010305",
      strokeWidth: 1,
    },
    {
      id: `room-${language}-title-rule`,
      kind: "shape",
      label: `Séparateur du titre - ${label}`,
      x: x + 33,
      y: y + 57,
      width: 385.9530970485757,
      height: 4,
      rotation: 0,
      visible: true,
      shapeType: "polyline",
      shapePoints: [
        { x: -0.05161290322580639, y: 0.4999999999999858 },
        { x: 1.0483870967741937, y: 0.4999999999999858 },
      ],
      shapeClosed: false,
      shapeStraightSegments: [],
      shapeTension: 0,
      stroke: "#081121",
      strokeWidth: 2,
      fillOpacity: 0,
    },
    {
      id: `room-${language}-title`,
      kind: "text",
      label: `Titre - ${label}`,
      x: x + 68,
      y: y - 2,
      width: 300,
      height: 39,
      rotation: 0,
      visible: true,
      text: ` ${title} `,
      color: text,
      fontSize: 14,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      lineHeight: 1.3,
      padding: 6,
      uppercase: false,
    },
    {
      id: `room-${language}-subtitle`,
      kind: "text",
      label: `Sous-titre - ${label}`,
      x: x + 23,
      y: y + 28,
      width: 432,
      height: 26,
      rotation: 0,
      visible: true,
      text: subtitle,
      color: text,
      fontSize: 17,
      fontStyle: "normal",
      align: "center",
      verticalAlign: "middle",
      lineHeight: 1.3,
      padding: 6,
      uppercase: false,
    },
    {
      id: `room-${language}-body`,
      kind: "text",
      label: `Texte - ${label}`,
      x: x + 15,
      y: y + 57,
      width: 446,
      height: 188,
      rotation: 0,
      visible: true,
      text: body,
      color: text,
      fontSize: 9,
      fontStyle: "bold",
      align: "left",
      verticalAlign: "middle",
      lineHeight: 1.3,
      padding: 6,
      uppercase: false,
    },
  ];

  return [
    {
      id: "room-client-logo",
      kind: "image",
      label: "Logo client",
      imageKey: "clientLogo",
      x: 52,
      y: 22,
      width: 330,
      height: 118,
      rotation: 0,
      visible: true
    },
    {
      id: "room-title",
      kind: "band",
      label: "Titre Consignes de chambre",
      x: 440,
      y: 30,
      width: width - 470,
      height: 72,
      rotation: 0,
      visible: true,
      text: context.planTitle || "CONSIGNES DE CHAMBRE",
      fill: purple,
      color: "#ffffff",
      fontSize: 34,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      letterSpacing: 0.5,
      lineHeight: 1,
      padding: 8,
      uppercase: true
    },

    // Upper half: the live plan with every existing annotation attached.
    {
      id: "room-plan",
      kind: "plan",
      planSlot: "main",
      label: "Plan des chambres (fenêtre)",
      x: 54,
      y: 154,
      width: width - 108,
      height: 665,
      rotation: 0,
      visible: true,
      fill: paper,
      stroke: "#d4d4d4",
      strokeWidth: 0,
      cornerRadius: 0
    },
    {
      id: "room-level",
      kind: "band",
      label: "Niveau du plan",
      x: 744,
      y: 598,
      width: 230,
      height: 42,
      rotation: 0,
      visible: true,
      text: "NIVEAU 1",
      fill: paper,
      color: purple,
      fontSize: 24,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      padding: 4,
      uppercase: true
    },
    {
      id: "room-legend",
      kind: "legend",
      label: "Légende chambre",
      x: 490,
      y: 646,
      width: 410,
      height: 276,
      rotation: 0,
      visible: true,
      title: "LÉGENDE",
      titleColor: purple,
      titleFontSize: 19,
      titleHeight: 38,
      titleAlign: "left",
      titleLetterSpacing: 0.5,
      titleRule: false,
      fill: paper,
      stroke: purple,
      strokeWidth: 3,
      color: text,
      fontSize: 10.5,
      padding: 8
    },
    {
      id: "room-studio-logo",
      kind: "image",
      label: "Logo créateur",
      imageKey: "studioLogo",
      x: 900,
      y: 785,
      width: 185,
      height: 120,
      rotation: 0,
      visible: true
    },

    // Lower instruction plate and its two top notices.
    {
      id: "room-instruction-frame",
      kind: "text",
      label: "Cadre des consignes",
      x: 24,
      y: 932,
      width: width - 48,
      height: 622,
      rotation: 0,
      visible: true,
      text: "",
      fill: paper,
      stroke: purple,
      strokeWidth: 14,
      color: text,
      fontSize: 12,
      padding: 0
    },
    {
      id: "room-no-smoking",
      kind: "text",
      label: "Chambre non-fumeur",
      x: 48,
      y: 952,
      width: 510,
      height: 64,
      rotation: 0,
      visible: true,
      text: "🚭  Chambre non-fumeur - Nichtraucher-Zimmer\nNon-smoking room - Habitación para no fumadores",
      fill: paper,
      color: text,
      fontSize: 12.5,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      lineHeight: 1.2,
      padding: 6
    },
    {
      id: "room-assembly",
      kind: "text",
      label: "Point de rassemblement",
      x: 585,
      y: 952,
      width: 498,
      height: 64,
      rotation: 0,
      visible: true,
      text: "POINT DE RASSEMBLEMENT",
      fill: paper,
      color: text,
      fontSize: 13,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      padding: 6,
      uppercase: true
    },
    {
      id: "room-assembly-picto",
      kind: "picto",
      label: "Pictogramme point de rassemblement",
      iconType: "point_rassemblement",
      x: 596,
      y: 958,
      width: 52,
      height: 52,
      rotation: 0,
      visible: true
    },

    ...instructionElements(
      "fr",
      "Consigne incendie en français",
      "🇫🇷 ",
      "CONSIGNE D'INCENDIE",
      "Conduite à tenir en cas d'incendie",
      "EN CAS D'INCENDIE DANS VOTRE CHAMBRE :\n- Gardez votre sang-froid, ne criez pas « Au feu ».\n\nEN CAS D'AUDITION DU SIGNAL D'ALARME DONNANT\nL'ORDRE D'ÉVACUATION DE L'HÔTEL :\n- Quittez votre chambre dans les plus brefs délais.\n- Fermez si possible la fenêtre.\n- Refermez votre porte en sortant et gagnez la sortie\nsans affolement en empruntant l'escalier le plus proche.\n\nSI VOUS NE POUVEZ MAÎTRISER LE FEU :\n- Quittez votre chambre en prenant soin de fermer\nla porte et la fenêtre.\n- Prévenez le garçon d'étage ou la direction.",
      48,
      1034
    ),
    ...instructionElements(
      "en",
      "Special instructions in English",
      "🇬🇧 ",
      "SPECIAL INSTRUCTIONS",
      "What to do in case of fire",
      "IN CASE OF FIRE IN YOUR ROOM :\n- Keep calm, do not shout « Fire ».\n\nIF YOU HEAR THE FIRE ALARM REQUIRING\nTHE EVACUATION OF THE HOTEL :\n- Leave your room as quickly as possible.\n- If possible, close the window.\n- Close the door behind you and leave the hotel without\npanic, by the nearest staircase.\n\nIF YOU CANNOT PUT OUT THE FIRE :\n- Leave your room, making sure to close the door\nand the window.\n- Report the fire to your floor attendant or to management.",
      48,
      1284
    ),
    ...instructionElements(
      "de",
      "Spezialanweisung auf Deutsch",
      "🇩🇪 ",
      "SPEZIALANWEISUNG",
      "Wie Sie sich im Falle eines Brandes verhalten",
      "IM FALLE EINES BRANDES IM ZIMMER :\n- Bleiben Sie ruhig, rufen Sie nicht « Feuer ».\n\nBEI ERTÖNEN DES ALARMSIGNALS, WELCHES DEN BEFEHL\nZUR RÄUMUNG DES HOTELS GIBT :\n- Verlassen Sie Ihr Zimmer unverzüglich.\n- Schließen Sie das Fenster, wenn möglich.\n- Schließen Sie Ihre Tür beim Herausgehen und begeben Sie sich\nohne Aufregung zum Ausgang, indem Sie die nächstgelegene\nTreppe benutzen.\n\nWENN SIE DEM FEUER NICHT HERR WERDEN KÖNNEN :\n- Verlassen Sie Ihr Zimmer und achten Sie darauf,\nTür und Fenster zu schließen.\n- Benachrichtigen Sie den Etagendiener oder die Geschäftsleitung.",
      635,
      1034
    ),
    ...instructionElements(
      "es",
      "Consigna especial en español",
      "🇪🇸 ",
      "CONSIGNA ESPECIAL",
      "Conducta a respetar en caso de incendio",
      "EN CASO DE INCENDIO EN SU HABITACIÓN :\n- Mantenga la sangre fría sin gritar « Fuego ».\n\nEN CASO DE QUE OIGA LA SEÑAL DE ALARMA,\nADVIRTIENDO LA EVACUACIÓN DEL HOTEL :\n- Abandone su habitación lo antes posible.\n- Cierre, si puede, la ventana.\n- Cierre su puerta al salir. Vaya a la salida, sin precipitarse,\npor la escalera que esté más cerca.\n\nSI NO PUEDE DOMINAR EL FUEGO :\n- Salga de su habitación cuidando de cerrar\nla puerta y la ventana.\n- Advierta al responsable de la planta o a la dirección.",
      635,
      1284
    ),
    {
      id: "room-centre-instructions",
      kind: "text",
      label: "Illustrations centrales",
      x: 510,
      y: 1034,
      width: 110,
      height: 494,
      rotation: 0,
      visible: true,
      text: "SORTIE\n\n→\n\nFERMEZ LA PORTE\n\n✕\nASCENSEUR\n\nPRÉVENEZ LE PERSONNEL",
      fill: paper,
      stroke: purple,
      strokeWidth: 2,
      color: text,
      fontSize: 12,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      lineHeight: 1.7,
      padding: 6,
      uppercase: true
    },

    // Editable production information along the bottom edge.
    {
      id: "room-footer-creator",
      kind: "text",
      label: "Concepteur",
      x: 30,
      y: height - 36,
      width: 350,
      height: 28,
      rotation: 0,
      visible: true,
      text: "Concepteur :",
      color: "#555555",
      fontSize: 12,
      align: "left",
      verticalAlign: "middle",
      padding: 2
    },
    {
      id: "room-footer-reference",
      kind: "text",
      label: "Numéro du plan",
      x: 390,
      y: height - 36,
      width: 360,
      height: 28,
      rotation: 0,
      visible: true,
      text: "N° du plan :",
      color: "#555555",
      fontSize: 12,
      align: "center",
      verticalAlign: "middle",
      padding: 2
    },
    {
      id: "room-footer-date",
      kind: "text",
      label: "Date du plan",
      x: 760,
      y: height - 36,
      width: 340,
      height: 28,
      rotation: 0,
      visible: true,
      text: "Date :",
      color: "#555555",
      fontSize: 12,
      align: "right",
      verticalAlign: "middle",
      padding: 2
    }
  ];
}

/**
 * Replaces the former all-in-one language panels with the independent elements
 * used by the corrected German section: flag, frame, heading, subtitle, rule
 * and body. Existing German elements and every unrelated custom item remain
 * untouched.
 */
export function upgradeConsignesChambreIndependentTextElements(
  blocks: SheetBlock[]
): SheetBlock[] {
  const canonical = createConsignesChambreBlocks();
  const legacyLanguages: Record<string, "fr" | "en" | "de" | "es"> = {
    "room-fr-instructions": "fr",
    "room-en-instructions": "en",
    "room-de-instructions": "de",
    "room-es-instructions": "es",
  };
  const inserted = new Set<string>();
  const upgraded: SheetBlock[] = [];

  blocks.forEach((block) => {
    const language = legacyLanguages[block.id];
    if (language) {
      if (!inserted.has(language)) {
        canonical
          .filter((item) => item.id.startsWith(`room-${language}-`))
          .forEach((item) => upgraded.push(JSON.parse(JSON.stringify(item)) as SheetBlock));
        inserted.add(language);
      }
      return;
    }

    if (
      block.id === "room-no-smoking"
      && block.text?.includes("CHAMBRE NON-FUMEUR · NICHTRAUCHER-ZIMMER")
    ) {
      const corrected = canonical.find((item) => item.id === "room-no-smoking");
      upgraded.push({ ...block, text: corrected?.text ?? block.text });
      return;
    }

    upgraded.push(block);
  });

  return upgraded;
}

export function createSheetBlocks(
  template: SheetTemplateKey,
  context: SheetTemplateContext = {}
): SheetBlock[] {
  const finalBlocks = createFinalSheetBlocks(template, context);
  if (finalBlocks) return finalBlocks;

  if (template.startsWith("official_")) {
    return createOfficialEditableBlocks(template, context);
  }

  switch (template) {
    case "consignes_chambre":
      return createConsignesChambreBlocks(context);
    case "evacuation_consigne_gauche":
      return createEvacuationConsigneGaucheBlocks(context);
    case "intervention_multiniveaux":
      return createInterventionMultiniveauxBlocks(context);
    case "nfx08070":
    default:
      return createNfx08070Blocks(context);
  }
}

function createOfficialEditableBlocks(
  template: SheetTemplateKey,
  context: SheetTemplateContext = {}
): SheetBlock[] {
  const config = SHEET_TEMPLATES[template];
  const portrait = config.width < config.height;
  const label = config.label.toUpperCase();
  const isEvacuation = label.includes(" PE");
  const isSecurity = label.includes("PSI");
  const title = context.planTitle || (isSecurity ? "PLAN DE SECURITE INCENDIE" : isEvacuation ? "PLAN D'EVACUATION" : "PLAN D'INTERVENTION");
  const accent = isSecurity || !isEvacuation ? "#e50909" : "#07951a";
  const secondary = isSecurity ? "#f2c400" : isEvacuation ? "#e50909" : "#737373";
  const sheetW = config.width;
  const sheetH = config.height;

  if (template === "official_a2_pay_pi") {
    return createOfficialBlankInterventionBlocks(template, title, sheetW, sheetH, accent);
  }

  if (template === "official_psi_ph_a3_por") {
    return createOfficialPsiPortraitBlocks(template, title, sheetW, sheetH);
  }

  if (template === "official_a3_pe_ph_por") {
    return createOfficialEvacuationPortraitFromPsiBlocks(
      template,
      createOfficialPsiPortraitBlocks(template, title, sheetW, sheetH),
      title
    );
  }

  if (template === "official_ph_pe_a3_pay") {
    return createOfficialEvacuationLandscapeBlocks(template, title, sheetW, sheetH);
  }

  if (template === "official_pi_a3_ph_por") {
    return createOfficialInterventionPortraitBlocks(template, title, sheetW, sheetH);
  }

  if (template === "official_pe_a3_port") {
    return createOfficialEvacuationModernPortraitBlocks(template, title, sheetW, sheetH);
  }

  if (template === "official_a3_pe_pay") {
    return createOfficialEvacuationModernLandscapeFromPortraitBlocks(
      template,
      createOfficialEvacuationModernPortraitBlocks(
        "official_pe_a3_port",
        title,
        PORTRAIT_SHEET_WIDTH,
        PORTRAIT_SHEET_HEIGHT
      ),
      sheetW,
      sheetH
    );
  }

  return portrait
    ? createOfficialPortraitBlocks(template, title, label, sheetW, sheetH, accent, secondary)
    : createOfficialLandscapeBlocks(template, title, label, sheetW, sheetH, accent, secondary);
}

function createOfficialBlankInterventionBlocks(
  template: string,
  title: string,
  sheetW: number,
  sheetH: number,
  accent: string
): SheetBlock[] {
  return [
    {
      id: `${template}-header`,
      kind: "band",
      label: "Bandeau principal",
      x: 0,
      y: 0,
      width: sheetW,
      height: 126,
      rotation: 0,
      visible: true,
      fill: accent,
      color: "#ffffff",
      text: "",
      fontSize: 18,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      padding: 0
    },
    {
      id: `${template}-title`,
      kind: "text",
      label: "Titre principal",
      x: 245,
      y: 17,
      width: sheetW - 490,
      height: 92,
      rotation: 0,
      visible: true,
      text: title,
      color: "#ffffff",
      fontSize: 70,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      lineHeight: 1,
      letterSpacing: 0,
      padding: 0,
      uppercase: true
    },
    {
      id: `${template}-plan`,
      kind: "plan",
      planSlot: "main",
      label: "Zone du plan",
      x: 42,
      y: 166,
      width: sheetW - 84,
      height: sheetH - 230,
      rotation: 0,
      visible: true,
      fill: "#ffffff",
      strokeWidth: 0
    }
  ];
}

function createOfficialLandscapeBlocks(
  template: string,
  title: string,
  label: string,
  sheetW: number,
  sheetH: number,
  accent: string,
  secondary: string
): SheetBlock[] {
  const hasLeftConsignes = label.includes("PE") || label.includes("PSI");
  const leftW = hasLeftConsignes ? 330 : 0;
  const planX = hasLeftConsignes ? leftW + 34 : 48;
  const planY = 160;
  const legendW = 300;
  const planW = sheetW - planX - 42;
  const planH = sheetH - planY - 58;
  return [
    {
      id: `${template}-header`,
      kind: "band",
      label: "Bandeau principal",
      x: 0,
      y: 0,
      width: sheetW,
      height: 126,
      rotation: 0,
      visible: true,
      fill: accent,
      color: "#ffffff",
      text: title,
      fontSize: 60,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      letterSpacing: 0,
      padding: 8,
      uppercase: true
    },
    ...(hasLeftConsignes ? createOfficialConsigneColumn(template, 16, 152, leftW, sheetH - 176, accent, secondary) : []),
    {
      id: `${template}-identity`,
      kind: "text",
      label: "Identification",
      x: planX,
      y: 138,
      width: planW - legendW - 28,
      height: 34,
      rotation: 0,
      visible: true,
      text: "Site / niveau / zone",
      color: "#222222",
      fontSize: 18,
      fontStyle: "bold",
      align: "left",
      verticalAlign: "middle",
      padding: 0
    },
    {
      id: `${template}-plan`,
      kind: "plan",
      planSlot: "main",
      label: "Zone du plan",
      x: planX,
      y: planY,
      width: planW,
      height: planH,
      rotation: 0,
      visible: true,
      fill: "#ffffff",
      strokeWidth: 0
    },
    {
      id: `${template}-legend`,
      kind: "legend",
      label: "Legende",
      x: sheetW - legendW - 38,
      y: sheetH - 320,
      width: legendW,
      height: 260,
      rotation: 0,
      visible: true,
      title: "LEGENDE",
      titleColor: "#1a1a1a",
      titleFontSize: 16,
      titleHeight: 34,
      titleAlign: "center",
      titleRule: true,
      fill: "#ffffff",
      stroke: "#1a1a1a",
      strokeWidth: 1,
      color: "#1a1a1a",
      fontSize: 11,
      padding: 8
    },
    {
      id: `${template}-client-logo`,
      kind: "image",
      label: "Logo client",
      imageKey: "clientLogo",
      x: sheetW - 230,
      y: 146,
      width: 170,
      height: 70,
      rotation: 0,
      visible: true
    }
  ];
}

/**
 * Editable reconstruction of the supplied "FOND PH PE A3 PAY" plate.
 *
 * The PDF stores the landscape artwork on a portrait page rotated by 90°.
 * Coordinates below describe the corrected, upright 1600 × 1131 studio sheet.
 * The plan remains one large block on the right while every notice, heading,
 * pictogram and logo in the left column stays independently editable.
 */
function createOfficialEvacuationLandscapeBlocks(
  template: string,
  title: string,
  sheetW: number,
  sheetH: number
): SheetBlock[] {
  const green = "#019501";
  const red = "#ff0000";
  const yellow = "#f8d731";
  const black = "#111111";
  const paper = "#ffffff";
  const displayTitle = title === "PLAN D'EVACUATION"
    ? "PLAN D'ÉVACUATION"
    : title;

  const textBlock = (
    id: string,
    label: string,
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    options: Partial<SheetBlock> = {}
  ): SheetBlock => ({
    id: `${template}-pe-landscape-${id}`,
    kind: "text",
    label,
    x,
    y,
    width,
    height,
    rotation: 0,
    visible: true,
    text,
    color: black,
    fontSize: 10.5,
    fontStyle: "bold",
    align: "center",
    verticalAlign: "top",
    lineHeight: 1.14,
    padding: 0,
    uppercase: true,
    ...options,
  });

  const pictogram = (
    id: string,
    label: string,
    iconType: string,
    x: number,
    y: number,
    width: number,
    height: number,
    color?: string
  ): SheetBlock => ({
    id: `${template}-pe-landscape-${id}`,
    kind: "picto",
    label,
    iconType,
    x,
    y,
    width,
    height,
    rotation: 0,
    visible: true,
    color,
  });

  const heading = (
    id: string,
    label: string,
    y: number,
    fill: string,
    color: string,
    iconType?: string
  ): SheetBlock[] => [
    {
      id: `${template}-pe-landscape-${id}-heading`,
      kind: "band",
      label: `Bandeau ${label}`,
      x: 65,
      y,
      width: 261,
      height: 30,
      rotation: 0,
      visible: true,
      text: label,
      fill,
      cornerRadius: 15,
      color,
      fontSize: 27,
      fontStyle: "bold",
      align: "left",
      verticalAlign: "middle",
      lineHeight: 1,
      padding: 23,
      uppercase: true,
    },
    ...(iconType ? [pictogram(
      `${id}-heading-icon`,
      `Pictogramme ${label}`,
      iconType,
      281,
      y + 3,
      24,
      24,
      fill
    )] : []),
  ];

  const framedBox = (
    id: string,
    label: string,
    x: number,
    y: number,
    width: number,
    height: number,
    stroke: string
  ): SheetBlock => ({
    id: `${template}-pe-landscape-${id}`,
    kind: "shape",
    label,
    x,
    y,
    width,
    height,
    rotation: 0,
    visible: true,
    shapeType: "rect",
    fill: paper,
    fillOpacity: 0,
    stroke,
    strokeWidth: 1,
  });

  return [
    {
      id: `${template}-pe-landscape-reference-layout`,
      kind: "plan",
      planSlot: "main",
      label: "Zone principale du plan",
      x: 340,
      y: 132,
      width: sheetW - 395,
      height: sheetH - 180,
      rotation: 0,
      visible: true,
      fill: paper,
      strokeWidth: 0,
    },
    {
      id: `${template}-pe-landscape-header-background`,
      kind: "band",
      label: "Bandeau Plan d'évacuation",
      x: 54,
      y: 43,
      width: sheetW - 122,
      height: 68,
      rotation: 0,
      visible: true,
      text: "",
      fill: green,
      color: paper,
      padding: 0,
    },
    pictogram(
      "header-exit",
      "Sortie dans le bandeau",
      "issue_de_secours",
      528,
      48,
      50,
      56,
      green
    ),
    textBlock(
      "header-title",
      "Titre principal",
      displayTitle || "PLAN D'ÉVACUATION",
      574,
      47,
      590,
      58,
      {
        color: paper,
        fontSize: 51,
        align: "center",
        verticalAlign: "middle",
        lineHeight: 1,
      }
    ),
    textBlock(
      "conformity",
      "Mention de conformité",
      "CONFORME A LA NORME NF X08-070",
      sheetW - 270,
      91,
      200,
      12,
      {
        color: paper,
        fontSize: 6.5,
        fontStyle: "normal",
        align: "right",
        verticalAlign: "middle",
        lineHeight: 1,
      }
    ),

    ...heading("fire", "INCENDIE", 159, red, paper, "extincteur"),
    textBlock(
      "fire-copy",
      "Consignes incendie",
      "EN CAS D'INCENDIE, GARDEZ VOTRE CALME ET\nDÉCLENCHEZ LE BOÎTIER LE PLUS PROCHE.\n\nATTAQUEZ LE FOYER PAR LA BASE AU MOYEN\nDES EXTINCTEURS SANS PRENDRE DE\nRISQUES.\n\nDANS LA CHALEUR ET LA FUMÉE,\nBAISSEZ-VOUS, L'AIR FRAIS EST PRÈS DU\nSOL.",
      67,
      201,
      257,
      111,
      { fontSize: 10.3, lineHeight: 1.12 }
    ),
    pictogram(
      "fire-phone",
      "Téléphone d'urgence incendie",
      "telephone_rouge_final_corrige",
      79,
      312,
      34,
      38,
      red
    ),
    textBlock(
      "fire-call-label",
      "Libellé appel d'urgence",
      "Appel d'urgence :",
      110,
      318,
      106,
      14,
      { fontSize: 11.2, align: "left", verticalAlign: "middle", uppercase: false }
    ),
    textBlock(
      "fire-numbers",
      "Numéros pompiers",
      "18 ou 112",
      214,
      318,
      83,
      14,
      { color: red, fontSize: 11.2, align: "left", verticalAlign: "middle", uppercase: false }
    ),
    textBlock(
      "fire-security",
      "Service de sécurité",
      "ou le service de sécurité :",
      110,
      333,
      190,
      14,
      { fontSize: 11.2, align: "left", verticalAlign: "middle", uppercase: false }
    ),

    ...heading("evacuation", "ÉVACUATION", 370, green, paper, "issue_de_secours"),
    textBlock(
      "evacuation-copy",
      "Consignes évacuation",
      "À L'AUDITION DU SIGNAL OU SUR ORDRE D'UN\nRESPONSABLE, FERMEZ LES PORTES ET LES\nFENÊTRES.\n\nSUIVEZ LES INDICATIONS DU GUIDE OU\nDIRIGEZ-VOUS VERS LES SORTIES LES PLUS\nPROCHES.\n\nN'UTILISEZ PAS LES ASCENSEURS OU\nMONTE-CHARGES S'ILS EXISTENT.\n\nNE REVENEZ PAS EN ARRIÈRE SANS\nY AVOIR ÉTÉ INVITÉ.",
      67,
      406,
      257,
      142,
      { fontSize: 10.3, lineHeight: 1.12 }
    ),

    ...heading("prevention", "PRÉVENTION", 568, yellow, black),
    textBlock(
      "prevention-copy",
      "Consignes prévention",
      "FERMEZ FENÊTRES ET PORTES EN\nQUITTANT LES LIEUX.\n\nN'ENCOMBREZ PAS LE MATÉRIEL\nINCENDIE, LES ISSUES ET LES\nCIRCULATIONS.\n\nIL EST FORMELLEMENT INTERDIT DE FUMER\nET DE VAPOTER.",
      67,
      616,
      257,
      100,
      { fontSize: 10.3, lineHeight: 1.12 }
    ),

    framedBox("assembly-frame", "Cadre point de rassemblement", 76, 758, 239, 85, green),
    pictogram(
      "assembly",
      "Point de rassemblement",
      "point_rassemblement",
      86,
      771,
      59,
      59,
      green
    ),
    textBlock(
      "assembly-copy",
      "Libellé point de rassemblement",
      "POINT DE RASSEMBLEMENT :",
      149,
      770,
      157,
      28,
      { fontSize: 10.4, fontStyle: "normal", align: "left", verticalAlign: "middle" }
    ),
    framedBox("deaf-frame", "Cadre urgence 114", 76, 852, 239, 86, red),
    pictogram(
      "deaf",
      "Urgence personnes malentendantes",
      "urgence-sourds",
      86,
      865,
      59,
      59,
      red
    ),
    textBlock(
      "deaf-copy",
      "Appel d'urgence 114",
      "Numéro d'urgence pour les\npersonnes ayant des soucis\nà entendre ou à parler.",
      153,
      869,
      151,
      51,
      {
        color: red,
        fontSize: 10.7,
        fontStyle: "normal",
        align: "center",
        verticalAlign: "middle",
        lineHeight: 1.12,
        uppercase: false,
      }
    ),
    {
      id: `${template}-pe-landscape-studio-logo`,
      kind: "image",
      label: "Logo studio",
      imageKey: "studioLogo",
      x: 101,
      y: 953,
      width: 188,
      height: 80,
      rotation: 0,
      visible: true,
    },
  ];
}

/**
 * Editable reconstruction of the supplied "FOND PI A3 PH POR" plate.
 * The reference contains only the red regulatory header and a large, clear
 * portrait window for the intervention plan: no legend and no client logo.
 */
function createOfficialInterventionPortraitBlocks(
  template: string,
  title: string,
  sheetW: number,
  sheetH: number
): SheetBlock[] {
  const red = "#ff0000";
  const paper = "#ffffff";

  return [
    {
      id: `${template}-pi-portrait-reference-layout`,
      kind: "plan",
      planSlot: "main",
      label: "Zone principale du plan",
      x: 46,
      y: 185,
      width: sheetW - 92,
      height: sheetH - 231,
      rotation: 0,
      visible: true,
      fill: paper,
      strokeWidth: 0,
    },
    {
      id: `${template}-pi-portrait-header-background`,
      kind: "band",
      label: "Bandeau Plan d'intervention",
      x: 46,
      y: 100,
      width: sheetW - 92,
      height: 67,
      rotation: 0,
      visible: true,
      text: "",
      fill: red,
      color: paper,
      padding: 0,
    },
    {
      id: `${template}-pi-portrait-title`,
      kind: "text",
      label: "Titre principal",
      x: 302,
      y: 107,
      width: 574,
      height: 51,
      rotation: 0,
      visible: true,
      text: title || "PLAN D'INTERVENTION",
      color: paper,
      fontSize: 45,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      lineHeight: 1,
      padding: 0,
      uppercase: true,
    },
    {
      id: `${template}-pi-portrait-conformity`,
      kind: "text",
      label: "Mention de conformité",
      x: sheetW - 246,
      y: 145,
      width: 190,
      height: 11,
      rotation: 0,
      visible: true,
      text: "CONFORME A LA NORME NF X08-070",
      color: paper,
      fontSize: 7,
      fontStyle: "normal",
      align: "right",
      verticalAlign: "middle",
      lineHeight: 1,
      padding: 0,
      uppercase: true,
    },
  ];
}

/**
 * Editable reconstruction of the supplied modern "PE A3 PORT" plate.
 * Its large central plan is framed by a blueprint-green masthead and four
 * compact information panels along the bottom edge.
 */
function createOfficialEvacuationModernPortraitBlocks(
  template: string,
  title: string,
  sheetW: number,
  sheetH: number
): SheetBlock[] {
  const headerGreen = "#0b8c37";
  const darkGreen = "#025f21";
  const red = "#d90005";
  const blue = "#012e7e";
  const paper = "#ffffff";
  const black = "#111111";
  const displayTitle = title === "PLAN D'EVACUATION"
    ? "PLAN D’ÉVACUATION"
    : title;

  const textBlock = (
    id: string,
    label: string,
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    options: Partial<SheetBlock> = {}
  ): SheetBlock => ({
    id: `${template}-modern-${id}`,
    kind: "text",
    label,
    x,
    y,
    width,
    height,
    rotation: 0,
    visible: true,
    text,
    color: black,
    fontSize: 10,
    fontStyle: "normal",
    align: "left",
    verticalAlign: "top",
    lineHeight: 1.12,
    padding: 0,
    ...options,
  });

  const panel = (
    id: string,
    label: string,
    x: number,
    y: number,
    width: number,
    height: number,
    stroke: string,
    radius = 6
  ): SheetBlock => ({
    id: `${template}-modern-${id}`,
    kind: "band",
    label,
    x,
    y,
    width,
    height,
    rotation: 0,
    visible: true,
    text: "",
    fill: paper,
    stroke,
    strokeWidth: 1,
    cornerRadius: radius,
    padding: 0,
  });

  const band = (
    id: string,
    label: string,
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
    options: Partial<SheetBlock> = {}
  ): SheetBlock => ({
    id: `${template}-modern-${id}`,
    kind: "band",
    label,
    x,
    y,
    width,
    height,
    rotation: 0,
    visible: true,
    text,
    fill,
    color: paper,
    fontSize: 27,
    fontStyle: "bold",
    align: "left",
    verticalAlign: "middle",
    lineHeight: 1,
    padding: 62,
    uppercase: true,
    ...options,
  });

  const pictogram = (
    id: string,
    label: string,
    iconType: string,
    x: number,
    y: number,
    width: number,
    height: number,
    color?: string
  ): SheetBlock => ({
    id: `${template}-modern-${id}`,
    kind: "picto",
    label,
    iconType,
    x,
    y,
    width,
    height,
    rotation: 0,
    visible: true,
    color,
  });

  const line = (
    id: string,
    label: string,
    x: number,
    y: number,
    width: number,
    height: number,
    stroke: string
  ): SheetBlock => ({
    id: `${template}-modern-${id}`,
    kind: "shape",
    label,
    x,
    y,
    width,
    height,
    rotation: 0,
    visible: true,
    shapeType: "line",
    shapePoints: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
    stroke,
    strokeWidth: 1,
  });

  const roundIcon = (
    id: string,
    label: string,
    symbol: string,
    x: number,
    y: number,
    fill: string
  ): SheetBlock[] => [
    {
      id: `${template}-modern-${id}-circle`,
      kind: "shape",
      label: `Fond ${label}`,
      x,
      y,
      width: 38,
      height: 38,
      rotation: 0,
      visible: true,
      shapeType: "circle",
      fill,
      fillOpacity: 1,
      strokeWidth: 0,
    },
    textBlock(`${id}-symbol`, label, symbol, x, y + 1, 38, 36, {
      color: paper,
      fontSize: 21,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      lineHeight: 1,
    }),
  ];

  return [
    {
      id: `${template}-modern-portrait-reference-layout`,
      kind: "plan",
      planSlot: "main",
      label: "Zone principale du plan",
      x: 30,
      y: 170,
      width: sheetW - 60,
      height: 1020,
      rotation: 0,
      visible: true,
      fill: paper,
      strokeWidth: 0,
    },

    // Masthead.
    band("header", "Bandeau Plan d'évacuation", "", 0, 26, sheetW, 122, headerGreen, {
      padding: 0,
    }),
    textBlock("header-title", "Titre principal", displayTitle || "PLAN D’ÉVACUATION", 125, 42, 881, 88, {
      color: paper,
      fontSize: 70,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      lineHeight: 1,
      uppercase: true,
    }),

    // Main lower panels.
    panel("fire-panel", "Cadre Incendie", 13, 1221, 479, 279, red),
    band("fire-heading", "Bandeau Incendie", "INCENDIE", 13, 1221, 479, 51, red),
    pictogram("fire-heading-icon", "Pictogramme incendie", "extincteur", 26, 1227, 39, 39, red),

    line("fire-column-rule", "Séparateur Incendie", 257, 1285, 1, 196, red),
    line("fire-row-1", "Séparateur consigne incendie", 29, 1359, 216, 1, red),
    line("fire-row-2", "Séparateur consigne incendie", 29, 1427, 216, 1, red),
    pictogram("alarm", "Déclencheur manuel", "alarme_incendie", 32, 1290, 47, 47, red),
    textBlock("calm-title", "Gardez votre calme", "GARDEZ\nVOTRE CALME", 92, 1289, 145, 34, {
      color: red, fontSize: 13, fontStyle: "bold", lineHeight: 1.02, uppercase: true,
    }),
    textBlock("calm-copy", "Déclencher le boîtier", "En cas d'incendie,\ndéclenchez le boîtier\nle plus proche.", 92, 1324, 145, 32, {
      fontSize: 9, lineHeight: 1.08,
    }),
    pictogram("extinguisher", "Extincteur", "extincteur", 32, 1368, 47, 47, red),
    textBlock("attack-title", "Attaquez le feu", "ATTAQUEZ\nLE FEU", 92, 1366, 145, 32, {
      color: red, fontSize: 13, fontStyle: "bold", lineHeight: 1.02, uppercase: true,
    }),
    textBlock("attack-copy", "Attaquer le foyer", "Attaquez le foyer à la base\nau moyen des extincteurs\nsans prendre de risques.", 92, 1399, 145, 29, {
      fontSize: 8.6, lineHeight: 1.05,
    }),
    pictogram("smoke-air", "Air frais au sol", "air", 32, 1437, 47, 47, red),
    textBlock("smoke-title", "Baissez-vous", "BAISSEZ-VOUS", 92, 1436, 145, 20, {
      color: red, fontSize: 13, fontStyle: "bold", uppercase: true,
    }),
    textBlock("smoke-copy", "Conduite dans les fumées", "Dans la chaleur et la fumée,\nbaissez-vous, l'air frais est\nprès du sol.", 92, 1456, 145, 31, {
      fontSize: 8.6, lineHeight: 1.05,
    }),

    panel("emergency-panel", "Cadre Appel d'urgence", 273, 1284, 207, 202, red, 5),
    band("emergency-heading", "Bandeau Appel d'urgence", "APPEL D’URGENCE", 273, 1284, 207, 27, red, {
      fontSize: 13,
      align: "center",
      padding: 2,
      cornerRadius: 4,
    }),
    pictogram("phone-18", "Téléphone pompiers", "telephone_rouge_final_corrige", 283, 1322, 34, 34, red),
    textBlock("number-18", "Numéro pompiers", "18", 326, 1317, 55, 43, {
      color: red, fontSize: 35, fontStyle: "bold", align: "center", verticalAlign: "middle", lineHeight: 1,
    }),
    textBlock("label-18", "Libellé pompiers", "POMPIERS", 389, 1333, 77, 18, {
      color: red, fontSize: 10, fontStyle: "bold", verticalAlign: "middle", uppercase: true,
    }),
    line("emergency-row-1", "Séparateur numéro d'urgence", 282, 1363, 189, 1, red),
    pictogram("phone-114", "Urgence SMS 114", "urgence-sourds", 283, 1371, 34, 34, red),
    textBlock("number-114", "Numéro SMS", "114", 321, 1367, 65, 43, {
      color: red, fontSize: 32, fontStyle: "bold", align: "center", verticalAlign: "middle", lineHeight: 1,
    }),
    textBlock("label-114", "Libellé SMS", "SMS", 389, 1383, 77, 18, {
      color: red, fontSize: 10, fontStyle: "bold", verticalAlign: "middle", uppercase: true,
    }),
    line("emergency-row-2", "Séparateur numéro d'urgence", 282, 1417, 189, 1, red),
    pictogram("phone-112", "Téléphone urgences européennes", "telephone_rouge_final_corrige", 283, 1424, 34, 34, red),
    textBlock("number-112", "Numéro européen", "112", 321, 1421, 65, 43, {
      color: red, fontSize: 31, fontStyle: "bold", align: "center", verticalAlign: "middle", lineHeight: 1,
    }),
    textBlock("label-112", "Libellé urgences européennes", "URGENCES\nEUROPÉENNES", 389, 1427, 79, 33, {
      color: red, fontSize: 9.2, fontStyle: "bold", verticalAlign: "middle", lineHeight: 1.02, uppercase: true,
    }),
    textBlock("security-service", "Service de sécurité", "ou le service de sécurité", 300, 1463, 153, 17, {
      fontSize: 9.2, align: "center", verticalAlign: "middle",
    }),

    panel("evacuation-panel", "Cadre Évacuation", 501, 1221, 614, 279, darkGreen),
    band("evacuation-heading", "Bandeau Évacuation", "ÉVACUATION", 501, 1221, 614, 51, darkGreen),
    pictogram("evacuation-heading-icon", "Sortie de secours", "issue_de_secours", 515, 1226, 42, 42, darkGreen),
    line("evacuation-column-rule", "Séparateur Évacuation", 821, 1291, 1, 177, darkGreen),
    line("evacuation-left-row", "Séparateur consigne Évacuation", 515, 1373, 294, 1, darkGreen),
    line("evacuation-right-row", "Séparateur consigne Évacuation", 833, 1373, 268, 1, darkGreen),
    pictogram("listen", "Écoutez le signal", "mege-phone", 518, 1299, 52, 52, darkGreen),
    textBlock("listen-title", "Écoutez", "ÉCOUTEZ", 578, 1301, 220, 20, {
      color: darkGreen, fontSize: 13, fontStyle: "bold", uppercase: true,
    }),
    textBlock("listen-copy", "Consigne du signal", "À l'audition du signal ou sur ordre d'un responsable,\nfermez les portes et les fenêtres.", 578, 1323, 220, 39, {
      fontSize: 9.2, lineHeight: 1.14,
    }),
    pictogram("directions", "Suivre les indications", "direction", 518, 1390, 52, 52, darkGreen),
    textBlock("directions-title", "Dirigez-vous", "DIRIGEZ-VOUS", 578, 1392, 220, 20, {
      color: darkGreen, fontSize: 13, fontStyle: "bold", uppercase: true,
    }),
    textBlock("directions-copy", "Suivre le guide", "Suivez les indications du guide\nou dirigez-vous vers les sorties les plus proches.", 578, 1414, 220, 39, {
      fontSize: 9.2, lineHeight: 1.14,
    }),
    pictogram("no-lift", "Ne pas utiliser les ascenseurs", "urgence-03", 838, 1299, 52, 52, darkGreen),
    textBlock("no-lift-title", "Interdiction des ascenseurs", "N’UTILISEZ PAS LES ASCENSEURS", 900, 1313, 197, 20, {
      color: darkGreen, fontSize: 11.3, fontStyle: "bold", uppercase: true,
    }),
    textBlock("no-lift-copy", "Monte-charges", "ou monte-charges s'ils existent.", 900, 1337, 197, 23, {
      fontSize: 9.2,
    }),
    pictogram("no-return", "Ne pas revenir en arrière", "evacuation-3", 838, 1390, 52, 52, darkGreen),
    textBlock("no-return-title", "Ne revenez pas en arrière", "NE REVENEZ PAS EN ARRIÈRE", 900, 1405, 197, 20, {
      color: darkGreen, fontSize: 11.3, fontStyle: "bold", uppercase: true,
    }),
    textBlock("no-return-copy", "Sans invitation", "sans y avoir été invité.", 900, 1429, 197, 23, {
      fontSize: 9.2,
    }),

    // Prevention strip.
    panel("prevention-panel", "Cadre Prévention", 13, 1508, 564, 75, blue),
    band("prevention-heading", "Bandeau Prévention", "PRÉVENTION", 13, 1508, 564, 27, blue, {
      fontSize: 18,
      padding: 61,
    }),
    pictogram("prevention-heading-icon", "Prévention", "alarme_incendie", 28, 1510, 24, 24, blue),
    line("prevention-column-1", "Séparateur Prévention", 190, 1542, 1, 35, blue),
    line("prevention-column-2", "Séparateur Prévention", 392, 1542, 1, 35, blue),
    ...roundIcon("close", "Fermez portes et fenêtres", "▦", 29, 1540, blue),
    textBlock("close-copy", "Fermer portes et fenêtres", "FERMEZ\nfenêtres et portes\nen quittant les lieux.", 73, 1541, 109, 38, {
      fontSize: 8.1, lineHeight: 1.04,
    }),
    ...roundIcon("clear", "Dégager le matériel incendie", "♨", 205, 1540, blue),
    textBlock("clear-copy", "Ne pas encombrer", "N’ENCOMBREZ PAS\nle matériel incendie,\nles issues et les circulations.", 249, 1541, 136, 38, {
      fontSize: 7.8, lineHeight: 1.04,
    }),
    ...roundIcon("no-smoking", "Interdiction de fumer", "≠", 407, 1540, blue),
    textBlock("no-smoking-copy", "Interdiction de fumer", "IL EST INTERDIT\nde fumer\net de vapoter.", 451, 1541, 112, 38, {
      fontSize: 8.1, lineHeight: 1.04,
    }),

    // Assembly strip.
    panel("assembly-panel", "Cadre Point de rassemblement", 586, 1508, 529, 75, darkGreen),
    pictogram("assembly", "Point de rassemblement", "point_rassemblement", 612, 1517, 55, 55, darkGreen),
    textBlock("assembly-title", "Point de rassemblement", "POINT DE RASSEMBLEMENT :", 693, 1521, 384, 25, {
      color: darkGreen,
      fontSize: 15,
      fontStyle: "bold",
      verticalAlign: "middle",
      uppercase: true,
    }),
    line("assembly-line", "Ligne du point de rassemblement", 693, 1559, 400, 1, darkGreen),
  ];
}

/**
 * Landscape counterpart of the modern PE A3 portrait sheet.
 *
 * The supplied A3 PE PAY plate uses exactly the same visual language and
 * notices as PE A3 PORT, but stacks its four information panels down the left
 * edge.  Taking the portrait blocks as input keeps the chosen pictograms,
 * colours and copy in one source of truth. It also lets the editor convert the
 * user's latest corrected PE A3 PORT draft instead of falling back to an older
 * generic landscape composition.
 */
export function createOfficialEvacuationModernLandscapeFromPortraitBlocks(
  template: string,
  sourceBlocks: SheetBlock[],
  sheetW = SHEET_WIDTH,
  sheetH = SHEET_HEIGHT
): SheetBlock[] {
  const panelX = 13;
  const panelW = 305;
  const planX = 328;
  const planY = 148;
  const planW = sheetW - planX - 14;
  const planH = sheetH - planY - 13;
  const fireInteriorY = 222;
  const fireXScale = panelW / 479;
  const fireYScale = 321 / 202;
  const horizontalPoints: SheetShapePoint[] = [
    { x: 0, y: 0.5 },
    { x: 1, y: 0.5 },
  ];

  const keyOf = (block: SheetBlock) => block.id.match(/-modern-(.+)$/)?.[1] ?? "";
  const outputId = (key: string, index: number) =>
    key === "portrait-reference-layout"
      ? `${template}-modern-landscape-reference-layout`
      : `${template}-modern-landscape-${key || `extra-${index + 1}`}`;
  const placed = (
    block: SheetBlock,
    key: string,
    index: number,
    geometry: Partial<SheetBlock>
  ): SheetBlock => ({
    ...JSON.parse(JSON.stringify(block)),
    ...geometry,
    id: outputId(key, index),
  });

  const fixedGeometry: Record<string, Partial<SheetBlock>> = {
    header: { x: 0, y: 25, width: sheetW, height: 117 },
    "header-title": { x: 350, y: 42, width: 900, height: 82, fontSize: 70 },

    "fire-panel": { x: panelX, y: 151, width: panelW, height: 405 },
    "fire-heading": { x: panelX, y: 151, width: panelW, height: 65 },
    "fire-heading-icon": { x: 26, y: 158, width: 40, height: 40 },

    "evacuation-panel": { x: panelX, y: 562, width: panelW, height: 296 },
    "evacuation-heading": { x: panelX, y: 562, width: panelW, height: 55, padding: 62 },
    "evacuation-heading-icon": { x: 26, y: 569, width: 41, height: 41 },
    "evacuation-column-rule": {
      x: 26, y: 680, width: 279, height: 1, shapePoints: horizontalPoints,
    },
    "evacuation-left-row": {
      x: 26, y: 738, width: 279, height: 1, shapePoints: horizontalPoints,
    },
    "evacuation-right-row": {
      x: 26, y: 796, width: 279, height: 1, shapePoints: horizontalPoints,
    },
    listen: { x: 26, y: 625, width: 47, height: 47 },
    "listen-title": { x: 84, y: 625, width: 220, height: 18 },
    "listen-copy": { x: 84, y: 645, width: 220, height: 29, fontSize: 8.8 },
    directions: { x: 26, y: 683, width: 47, height: 47 },
    "directions-title": { x: 84, y: 683, width: 220, height: 18 },
    "directions-copy": { x: 84, y: 703, width: 220, height: 29, fontSize: 8.8 },
    "no-lift": { x: 26, y: 741, width: 47, height: 47 },
    "no-lift-title": { x: 84, y: 744, width: 220, height: 18 },
    "no-lift-copy": { x: 84, y: 764, width: 220, height: 23, fontSize: 8.8 },
    "no-return": { x: 26, y: 799, width: 47, height: 47 },
    "no-return-title": { x: 84, y: 802, width: 220, height: 18 },
    "no-return-copy": { x: 84, y: 822, width: 220, height: 23, fontSize: 8.8 },

    "prevention-panel": { x: panelX, y: 864, width: panelW, height: 156 },
    "prevention-heading": { x: panelX, y: 864, width: panelW, height: 40, padding: 61 },
    "prevention-heading-icon": { x: 26, y: 870, width: 28, height: 28 },
    "prevention-column-1": {
      x: 26, y: 942, width: 279, height: 1, shapePoints: horizontalPoints,
    },
    "prevention-column-2": {
      x: 26, y: 982, width: 279, height: 1, shapePoints: horizontalPoints,
    },
    "close-circle": { x: 26, y: 908, width: 32, height: 32 },
    "close-symbol": { x: 26, y: 909, width: 32, height: 30, fontSize: 18 },
    "close-copy": { x: 69, y: 908, width: 236, height: 32 },
    "clear-circle": { x: 26, y: 948, width: 32, height: 32 },
    "clear-symbol": { x: 26, y: 949, width: 32, height: 30, fontSize: 18 },
    "clear-copy": { x: 69, y: 948, width: 236, height: 32 },
    "no-smoking-circle": { x: 26, y: 988, width: 32, height: 32 },
    "no-smoking-symbol": { x: 26, y: 989, width: 32, height: 30, fontSize: 18 },
    "no-smoking-copy": { x: 69, y: 988, width: 236, height: 32 },

    "assembly-panel": { x: panelX, y: 1027, width: panelW, height: 42 },
    assembly: { x: 26, y: 1031, width: 34, height: 34 },
    "assembly-title": {
      x: 68, y: 1034, width: 160, height: 23, fontSize: 10, verticalAlign: "middle",
    },
    "assembly-line": {
      x: 213, y: 1054, width: 92, height: 1, shapePoints: horizontalPoints,
    },
  };

  return sourceBlocks.flatMap((source, index) => {
    const block = JSON.parse(JSON.stringify(source)) as SheetBlock;
    const key = keyOf(block);

    if (key === "portrait-reference-layout" || block.kind === "plan") {
      return [placed(block, "portrait-reference-layout", index, {
        label: "Zone principale du plan",
        x: planX,
        y: planY,
        width: planW,
        height: planH,
        visible: true,
      })];
    }

    const fixed = fixedGeometry[key];
    if (fixed) return [placed(block, key, index, fixed)];

    // The Incendie panel keeps the portrait composition (instructions on the
    // left, emergency numbers on the right) and only grows vertically.
    if (block.x < 500 && block.y >= 1284 && block.y < 1505) {
      const verticalRule = block.kind === "shape" && block.width <= 2 && block.height > 20;
      const horizontalRule = block.kind === "shape" && block.height <= 2 && block.width > 20;
      const geometry: Partial<SheetBlock> = {
        x: panelX + (block.x - 13) * fireXScale,
        y: fireInteriorY + (block.y - 1284) * fireYScale,
        width: block.kind === "picto" ? block.width : block.width * fireXScale,
        height: block.kind === "picto" || block.kind === "text"
          ? block.height
          : block.height * fireYScale,
      };
      if (verticalRule) geometry.height = 311;
      if (horizontalRule) geometry.height = 1;
      return [placed(block, key, index, geometry)];
    }

    // Preserve any extra item that the user added to PE A3 PORT. Known blocks
    // above receive the exact reference layout; extras follow their containing
    // area proportionally so they are not lost during the conversion.
    if (block.y >= 1200 && block.y < 1505 && block.x >= 490) {
      return [placed(block, key, index, {
        x: panelX + (block.x - 501) * (panelW / 614),
        y: 562 + (block.y - 1221) * (296 / 279),
        width: block.width * (panelW / 614),
        height: block.height * (296 / 279),
      })];
    }
    if (block.y >= 1505 && block.x < 585) {
      return [placed(block, key, index, {
        x: panelX + (block.x - 13) * (panelW / 564),
        y: 864 + (block.y - 1508) * (156 / 75),
        width: block.width * (panelW / 564),
        height: block.height * (156 / 75),
      })];
    }
    if (block.y >= 1505 && block.x >= 580) {
      return [placed(block, key, index, {
        x: panelX + (block.x - 586) * (panelW / 529),
        y: 1027 + (block.y - 1508) * (42 / 75),
        width: block.width * (panelW / 529),
        height: block.height * (42 / 75),
      })];
    }
    if (block.y < 160) {
      return [placed(block, key, index, {
        x: block.x * (sheetW / PORTRAIT_SHEET_WIDTH),
        y: block.y,
        width: block.width * (sheetW / PORTRAIT_SHEET_WIDTH),
        height: block.height,
      })];
    }
    if (block.y < 1220) {
      return [placed(block, key, index, {
        x: planX + (block.x - 30) * (planW / (PORTRAIT_SHEET_WIDTH - 60)),
        y: planY + (block.y - 170) * (planH / 1020),
        width: block.width * (planW / (PORTRAIT_SHEET_WIDTH - 60)),
        height: block.height * (planH / 1020),
      })];
    }

    return [];
  });
}

/**
 * Editable reconstruction of the supplied "FOND PSI PH A3 POR" plate.
 *
 * The reference deliberately leaves most of the portrait page to the plan and
 * groups the regulatory copy in a compact footer.  Every heading, paragraph,
 * number box, logo and pictogram remains an independent sheet block so the
 * studio can move, resize, recolour or replace it without flattening the PDF.
 */
function createOfficialPsiPortraitBlocks(
  template: string,
  title: string,
  sheetW: number,
  sheetH: number
): SheetBlock[] {
  const red = "#f51b27";
  const green = "#00a651";
  const yellow = "#ffd400";
  const blue = "#4169bd";
  const textColor = "#171717";
  const paper = "#ffffff";
  const footerY = 1334;
  const headerTitle = title === "PLAN DE SECURITE INCENDIE"
    ? "PLAN DE SÉCURITÉ INCENDIE"
    : title;

  const textBlock = (
    id: string,
    label: string,
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    options: Partial<SheetBlock> = {}
  ): SheetBlock => ({
    id: `${template}-psi-${id}`,
    kind: "text",
    label,
    x,
    y,
    width,
    height,
    rotation: 0,
    visible: true,
    text,
    color: textColor,
    fontSize: 10,
    fontStyle: "bold",
    align: "left",
    verticalAlign: "top",
    lineHeight: 1.18,
    padding: 0,
    uppercase: true,
    ...options
  });

  const pictogram = (
    id: string,
    label: string,
    iconType: string,
    x: number,
    y: number,
    width: number,
    height: number,
    color?: string
  ): SheetBlock => ({
    id: `${template}-psi-${id}`,
    kind: "picto",
    label,
    iconType,
    x,
    y,
    width,
    height,
    rotation: 0,
    visible: true,
    color
  });

  const heading = (
    id: string,
    label: string,
    x: number,
    width: number,
    fill: string,
    color = "#ffffff"
  ): SheetBlock[] => [
    {
      id: `${template}-psi-${id}-shape`,
      kind: "shape",
      label: `Fond ${label}`,
      x,
      y: footerY,
      width,
      height: 20,
      rotation: 0,
      visible: true,
      shapeType: "polygon_zone",
      shapePoints: [
        { x: 0.015, y: 0 },
        { x: 1, y: 0 },
        { x: 0.955, y: 1 },
        { x: 0, y: 1 }
      ],
      fill,
      fillOpacity: 1,
      strokeWidth: 0
    },
    textBlock(`${id}-title`, `Titre ${label}`, label, x, footerY, width, 20, {
      color,
      fontSize: 17,
      align: "center",
      verticalAlign: "middle",
      lineHeight: 1,
      padding: 1
    })
  ];

  const separator = (id: string, x: number): SheetBlock => ({
    id: `${template}-psi-${id}`,
    kind: "shape",
    label: "Séparateur de consignes",
    x,
    y: footerY + 27,
    width: 1,
    height: 166,
    rotation: 0,
    visible: true,
    shapeType: "line",
    shapePoints: [
      { x: 0.5, y: 0 },
      { x: 0.5, y: 1 }
    ],
    stroke: "#555555",
    strokeWidth: 1
  });

  return [
    // The plan is intentionally the largest object on the page.  The header
    // and the compact instruction footer are rendered over the white sheet.
    {
      id: `${template}-psi-reference-layout`,
      kind: "plan",
      planSlot: "main",
      label: "Zone principale du plan",
      x: 60,
      y: 190,
      width: sheetW - 120,
      height: footerY - 208,
      rotation: 0,
      visible: true,
      fill: paper,
      strokeWidth: 0
    },
    {
      id: `${template}-psi-header`,
      kind: "band",
      label: "Bandeau Plan de sécurité incendie",
      x: 60,
      y: 71,
      width: sheetW - 120,
      height: 74,
      rotation: 0,
      visible: true,
      text: headerTitle || "PLAN DE SÉCURITÉ INCENDIE",
      fill: red,
      cornerRadius: 7,
      color: "#ffffff",
      fontSize: 52,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      lineHeight: 1,
      padding: 8,
      uppercase: true
    },
    textBlock(
      "conformity",
      "Mention de conformité",
      "CONFORME A LA NF X08-070 ET ARRETE DU 19/06/2015",
      72,
      132,
      370,
      10,
      {
        color: "#ffffff",
        fontSize: 5.6,
        verticalAlign: "middle",
        lineHeight: 1
      }
    ),
    pictogram(
      "header-exit",
      "Sortie dans le bandeau",
      "cheminement evacuation",
      sheetW - 156,
      78,
      55,
      55,
      red
    ),
    {
      id: `${template}-psi-instruction-band`,
      kind: "band",
      label: "Bandeau Consignes de sécurité",
      x: 60,
      y: 156,
      width: sheetW - 120,
      height: 26,
      rotation: 0,
      visible: true,
      text: "CONSIGNES DE SÉCURITÉ",
      fill: red,
      cornerRadius: 5,
      color: "#ffffff",
      fontSize: 18,
      fontStyle: "bold",
      align: "left",
      verticalAlign: "middle",
      lineHeight: 1,
      padding: 10,
      uppercase: true
    },

    // Bottom headings and the two fine vertical rules from the reference.
    ...heading("fire-heading", "INCENDIE", 97, 244, red),
    ...heading("evacuation-heading", "ÉVACUATION", 347, 437, green),
    ...heading("prevention-heading", "PRÉVENTION", 800, 244, yellow, textColor),
    separator("fire-separator", 332),
    separator("prevention-separator", 799),

    // ── INCENDIE ──────────────────────────────────────────────────────────
    textBlock(
      "fire-call",
      "Appel des services de secours",
      "VEUILLEZ APPELER LES SERVICES DE SECOURS\nEN COMPOSANT LE :",
      98,
      footerY + 27,
      226,
      29,
      { fontSize: 9.4 }
    ),
    pictogram(
      "fire-phone",
      "Téléphone incendie",
      "telephone_rouge_final_corrige",
      98,
      footerY + 61,
      30,
      30
    ),
    textBlock("fire-numbers", "Numéros pompiers", "112            18", 130, footerY + 61, 194, 32, {
      fill: paper,
      stroke: red,
      strokeWidth: 1.5,
      cornerRadius: 4,
      color: red,
      fontSize: 18,
      align: "center",
      verticalAlign: "middle",
      lineHeight: 1,
      padding: 2
    }),
    pictogram("fire-number-phone", "Combiné téléphone", "telephone_rouge_final_corrige", 221, footerY + 67, 18, 18),
    textBlock(
      "fire-location",
      "Précision de l'appel",
      "EN PRÉCISANT LE LIEU EXACT DE L'ACCIDENT",
      130,
      footerY + 95,
      194,
      14,
      { fontSize: 7.4, align: "center", lineHeight: 1 }
    ),
    {
      id: `${template}-psi-studio-logo`,
      kind: "image",
      label: "Logo studio",
      imageKey: "studioLogo",
      x: 112,
      y: footerY + 112,
      width: 188,
      height: 70,
      rotation: 0,
      visible: true
    },
    textBlock(
      "update",
      "Mise à jour du plan",
      "Mise à jour n° 1 - Date et n° du plan :",
      98,
      footerY + 184,
      226,
      12,
      {
        color: "#777777",
        fontSize: 5.6,
        fontStyle: "normal",
        align: "center",
        verticalAlign: "middle",
        uppercase: false
      }
    ),

    // ── ÉVACUATION ────────────────────────────────────────────────────────
    pictogram("evacuation-home", "Évacuation du logement", "evacuation1", 348, footerY + 27, 36, 36, green),
    textBlock(
      "evacuation-home-copy",
      "Incendie déclaré chez vous",
      "1- SI L'INCENDIE SE DÉCLARE CHEZ VOUS\nET QUE VOUS NE POUVEZ L'ÉTEINDRE\nIMMÉDIATEMENT :\n- ÉVACUEZ LES LIEUX ;\n- FERMEZ LA PORTE DE VOTRE APPARTEMENT ;\n- PRENDRE LA SORTIE LA PLUS PROCHE",
      388,
      footerY + 25,
      190,
      91,
      { fontSize: 8.6, lineHeight: 1.13 }
    ),
    pictogram("evacuation-below", "Incendie au-dessous du palier", "evacuation-2", 348, footerY + 121, 36, 36, green),
    textBlock(
      "evacuation-below-copy",
      "Incendie au-dessous du palier",
      "2- SI L'INCENDIE EST AU DESSOUS DE\nVOTRE PALIER :\n- RESTEZ CHEZ VOUS ;\n- FERMEZ LA PORTE DE VOTRE APPARTEMENT ET MOUILLEZ-LA ;\n- MANIFESTEZ VOUS À VOTRE FENÊTRE.",
      388,
      footerY + 118,
      190,
      78,
      { fontSize: 8.2, lineHeight: 1.12 }
    ),
    pictogram(
      "evacuation-above",
      "Incendie au-dessus du palier",
      "cheminement evacuation",
      566,
      footerY + 27,
      36,
      36,
      green
    ),
    textBlock(
      "evacuation-above-copy",
      "Incendie au-dessus du palier",
      "3- SI L'INCENDIE EST AU DESSUS\nDE VOTRE PALIER :\n- PRENDRE LA SORTIE\n  LA PLUS PROCHE",
      606,
      footerY + 25,
      172,
      62,
      { fontSize: 8.6, lineHeight: 1.14 }
    ),
    pictogram("no-lift", "Ne pas utiliser les ascenseurs", "11", 566, footerY + 88, 36, 36),
    textBlock(
      "no-lift-copy",
      "Interdiction d'utiliser l'ascenseur",
      "NE PAS UTILISER LES ASCENSEURS",
      606,
      footerY + 94,
      172,
      24,
      { fontSize: 8.8, verticalAlign: "middle" }
    ),
    pictogram("first-aid", "Premiers secours", "Pharmacie", 566, footerY + 132, 36, 36, green),
    textBlock(
      "medical-title",
      "Accident ou malaise",
      "ACCIDENT OU MALAISE",
      606,
      footerY + 126,
      172,
      14,
      { fontSize: 8.8, align: "center", lineHeight: 1 }
    ),
    textBlock("medical-numbers", "Numéros médicaux", "112            15", 606, footerY + 141, 172, 28, {
      fill: paper,
      stroke: green,
      strokeWidth: 1.4,
      cornerRadius: 4,
      color: green,
      fontSize: 16,
      align: "center",
      verticalAlign: "middle",
      lineHeight: 1,
      padding: 2
    }),
    pictogram("medical-phone", "Téléphone médical", "telephone_vert", 681, footerY + 146, 17, 17),
    textBlock(
      "medical-location",
      "Précision de l'appel médical",
      "EN PRÉCISANT LE LIEU EXACT DE L'ACCIDENT",
      606,
      footerY + 170,
      172,
      11,
      { fontSize: 5.8, align: "center", lineHeight: 1 }
    ),
    pictogram("deaf", "Urgence personnes malentendantes", "ear-svgrepo-com", 566, footerY + 169, 33, 33, blue),
    textBlock(
      "deaf-copy",
      "Appel d'urgence 114",
      "APPEL D'URGENCE\nPOUR PERSONNES\nMALENTENDANTES",
      606,
      footerY + 181,
      95,
      34,
      { fontSize: 7.4, lineHeight: 1.08 }
    ),
    textBlock("deaf-number", "Numéro 114", "114", 708, footerY + 185, 68, 27, {
      fill: paper,
      stroke: blue,
      strokeWidth: 1.3,
      cornerRadius: 4,
      color: blue,
      fontSize: 16,
      align: "center",
      verticalAlign: "middle",
      lineHeight: 1,
      padding: 2
    }),

    // ── PRÉVENTION ────────────────────────────────────────────────────────
    textBlock(
      "smoke-copy",
      "Conduite à tenir dans les fumées",
      "EN CAS DE FUMÉES, BAISSEZ VOUS.\nL'AIR FRAIS EST PRÈS DU SOL.",
      842,
      footerY + 42,
      194,
      38,
      { fontSize: 8.8, lineHeight: 1.15 }
    ),
    pictogram(
      "smoke",
      "Danger des fumées",
      "cheminement evacuation",
      810,
      footerY + 80,
      34,
      34,
      yellow
    ),
    textBlock(
      "smoke-warning",
      "Interdiction d'entrer dans la fumée",
      "N'ENTREZ JAMAIS DANS LA FUMÉE.",
      850,
      footerY + 84,
      186,
      27,
      { fontSize: 8.8, verticalAlign: "middle" }
    ),
    textBlock(
      "circulation",
      "Dégagement des circulations",
      "N'ENCOMBREZ PAS LES PALIERS\nET LES CIRCULATIONS",
      842,
      footerY + 116,
      194,
      38,
      { fontSize: 8.8, lineHeight: 1.15 }
    ),
    pictogram("fire-door", "Fermeture des portes coupe-feu", "Porte coupe-feu", 810, footerY + 158, 34, 34),
    textBlock(
      "fire-door-copy",
      "Limiter la propagation des flammes",
      "EN CAS D'INCENDIE, VEILLEZ À FERMER\nLES PORTES ET FENÊTRES DERRIÈRE\nVOUS, POUR LIMITER LA PROPAGATION\nDES FLAMMES.",
      850,
      footerY + 156,
      186,
      56,
      { fontSize: 8.2, lineHeight: 1.12 }
    )
  ];
}

/**
 * Builds the supplied PE PH A3 portrait sheet from the proven PSI portrait
 * composition. Passing a user's saved PSI blocks preserves the exact spacing,
 * typography and manual styling they already corrected; only the regulatory
 * differences visible on the PE reference are applied.
 */
export function createOfficialEvacuationPortraitFromPsiBlocks(
  template: string,
  sourceBlocks: SheetBlock[],
  title = "PLAN D'ÉVACUATION"
): SheetBlock[] {
  const green = "#00a650";
  const red = "#ed1c24";
  const yellow = "#fddd04";
  const textColor = "#171717";
  const paper = "#ffffff";
  const footerY = 1334;
  const fold = (value?: string) => (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const slug = (value: string) => fold(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "bloc";

  const converted: SheetBlock[] = [];

  sourceBlocks.forEach((source, index) => {
    const block = JSON.parse(JSON.stringify(source)) as SheetBlock;
    const identity = fold([
      block.id,
      block.label,
      block.text,
      block.iconType,
      block.imageKey,
    ].filter(Boolean).join(" "));

    // These PSI-only items are replaced or deliberately absent in the PE
    // reference. The studio logo and update line are reinserted in Prévention.
    if (
      (block.kind === "image" && block.imageKey === "studioLogo") ||
      identity.includes("mise a jour du plan") ||
      identity.includes("ne pas utiliser les ascenseurs") ||
      identity.includes("urgence-03") ||
      identity.includes("interdiction d'utiliser l'ascenseur") ||
      identity.includes("interdiction d'entrer dans la fumee") ||
      identity.includes("degagement des circulations")
    ) {
      return;
    }

    const isMainPlan = block.kind === "plan" && (block.planSlot === "main" || !block.planSlot);
    block.id = isMainPlan
      ? `${template}-pe-reference-layout`
      : `${template}-pe-${String(index + 1).padStart(2, "0")}-${slug(block.label || block.kind)}`;

    if (isMainPlan) {
      block.label = "Zone principale du plan";
    } else if (block.kind === "band" && identity.includes("bandeau plan")) {
      Object.assign(block, {
        label: "Bandeau Plan d'évacuation",
        text: title || "PLAN D'ÉVACUATION",
        fill: green,
        color: paper,
      });
    } else if (block.kind === "band" && identity.includes("consignes de securite")) {
      Object.assign(block, {
        text: "CONSIGNES DE SÉCURITÉ",
        fill: green,
        color: paper,
      });
    } else if (identity.includes("mention de conformite")) {
      Object.assign(block, {
        text: "CONFORME A LA NF X08-070",
        color: paper,
      });
    } else if (identity.includes("sortie dans le bandeau")) {
      block.color = green;
    } else if (block.kind === "shape" && identity.includes("separateur de consignes")) {
      block.x = block.x < 600 ? 332 : 799;
    }

    const headingText = fold(block.text).trim();
    const isFooterHeadingShape = block.kind === "shape"
      && Math.abs(block.y - footerY) <= 12
      && block.height <= 32;
    if (isFooterHeadingShape) {
      if (block.x < 330) {
        Object.assign(block, { x: 97, y: footerY, width: 218, height: 20, fill: red, fillOpacity: 1 });
      } else if (block.x < 790) {
        Object.assign(block, { x: 347, y: footerY, width: 436, height: 20, fill: green, fillOpacity: 1 });
      } else {
        Object.assign(block, { x: 815, y: footerY, width: 218, height: 20, fill: yellow, fillOpacity: 1 });
      }
    } else if (block.kind === "text" && Math.abs(block.y - footerY) <= 12) {
      if (headingText === "incendie") {
        Object.assign(block, { text: "INCENDIE", x: 97, y: footerY, width: 218, height: 20, color: paper });
      } else if (headingText === "evacuation") {
        Object.assign(block, { text: "EVACUATION", x: 347, y: footerY, width: 436, height: 20, color: paper });
      } else if (headingText === "prevention") {
        Object.assign(block, { text: "PREVENTION", x: 815, y: footerY, width: 218, height: 20, color: textColor });
      }
    }

    if (identity.includes("incendie declare chez vous")) {
      Object.assign(block, {
        text: "1- SI L'INCENDIE SE DÉCLARE CHEZ VOUS\nET QUE VOUS NE POUVEZ L'ÉTEINDRE\nIMMÉDIATEMENT :\n- ÉVACUEZ LES LIEUX ;\n- FERMEZ LA PORTE DE VOTRE APPARTEMENT ;\n- SORTEZ PAR L'ISSUE DE SECOURS LA PLUS PROCHE.",
        fontSize: Math.max(8.6, block.fontSize ?? 0),
      });
    } else if (identity.includes("incendie au-dessous du palier")) {
      block.text = "2- SI L'INCENDIE EST AU DESSOUS DE\nVOTRE PALIER :\n- RESTEZ CHEZ VOUS ;\n- FERMEZ LA PORTE DE VOTRE APPARTEMENT ET MOUILLEZ-LA ;\n- MANIFESTEZ VOUS À VOTRE FENÊTRE.";
    } else if (identity.includes("incendie au-dessus du palier")) {
      block.text = "3- SI L'INCENDIE EST AU DESSUS\nDE VOTRE PALIER :\n- SORTEZ PAR L'ISSUE DE SECOURS\nLA PLUS PROCHE ET METTEZ VOUS À L'ABRI.";
    } else if (identity.includes("conduite a tenir dans les fumees")) {
      Object.assign(block, {
        x: 847,
        y: footerY + 31,
        width: 186,
        height: 38,
        text: "EN CAS DE FUMÉES, BAISSEZ VOUS.\nL'AIR FRAIS EST PRÈS DU SOL.",
        fontSize: 8.8,
      });
    } else if (identity.includes("danger des fumees") || block.iconType === "urgence-01") {
      Object.assign(block, {
        label: "Danger des fumées",
        iconType: "urgence-01",
        x: 815,
        y: footerY + 32,
        width: 28,
        height: 28,
        color: undefined,
      });
    } else if (identity.includes("fermeture des portes coupe-feu")) {
      Object.assign(block, {
        iconType: "Porte coupe-feu",
        x: 815,
        y: footerY + 72,
        width: 29,
        height: 29,
      });
    } else if (identity.includes("limiter la propagation des flammes")) {
      Object.assign(block, {
        x: 847,
        y: footerY + 70,
        width: 186,
        height: 57,
        text: "EN CAS D'INCENDIE, VEILLEZ À FERMER\nLES PORTES ET FENÊTRES DERRIÈRE\nVOUS, POUR LIMITER LA PROPAGATION\nDES FLAMMES.",
      });
    }

    converted.push(block);
  });

  // The PE reference replaces the PSI logo area in the Incendie column with
  // an extinguisher instruction, and moves the studio identity to Prévention.
  converted.push(
    {
      id: `${template}-pe-fire-extinguisher`,
      kind: "picto",
      label: "Extincteur",
      iconType: "exticnteur",
      x: 98,
      y: footerY + 114,
      width: 30,
      height: 30,
      rotation: 0,
      visible: true,
    },
    {
      id: `${template}-pe-fire-extinguisher-copy`,
      kind: "text",
      label: "Utilisation de l'extincteur",
      x: 130,
      y: footerY + 112,
      width: 194,
      height: 48,
      rotation: 0,
      visible: true,
      text: "ATTAQUER LE FEU AVEC L'EXTINCTEUR LE\nPLUS APPROPRIÉ.",
      color: textColor,
      fontSize: 8.8,
      fontStyle: "bold",
      align: "left",
      verticalAlign: "middle",
      lineHeight: 1.14,
      padding: 0,
      uppercase: true,
    },
    {
      id: `${template}-pe-studio-logo`,
      kind: "image",
      label: "Logo studio",
      imageKey: "studioLogo",
      x: 840,
      y: footerY + 116,
      width: 180,
      height: 65,
      rotation: 0,
      visible: true,
    },
    {
      id: `${template}-pe-update`,
      kind: "text",
      label: "Mise à jour du plan",
      x: 800,
      y: footerY + 184,
      width: 244,
      height: 12,
      rotation: 0,
      visible: true,
      text: "Mise à jour n° 1 - Date et n° du plan :",
      color: "#777777",
      fontSize: 5.6,
      fontStyle: "normal",
      align: "center",
      verticalAlign: "middle",
      lineHeight: 1,
      padding: 0,
      uppercase: false,
    }
  );

  return converted;
}

function createOfficialPortraitBlocks(
  template: string,
  title: string,
  label: string,
  sheetW: number,
  sheetH: number,
  accent: string,
  secondary: string
): SheetBlock[] {
  const topH = 112;
  const consigneH = label.includes("PE") || label.includes("PSI") ? 292 : 0;
  const planY = topH + consigneH + 24;
  const planH = sheetH - planY - 260;
  return [
    {
      id: `${template}-header`,
      kind: "band",
      label: "Bandeau principal",
      x: 0,
      y: 0,
      width: sheetW,
      height: topH,
      rotation: 0,
      visible: true,
      fill: accent,
      color: "#ffffff",
      text: title,
      fontSize: 42,
      fontStyle: "bold",
      align: "center",
      verticalAlign: "middle",
      padding: 8,
      uppercase: true
    },
    ...(consigneH ? createOfficialConsigneColumn(template, 26, 132, sheetW - 52, consigneH, accent, secondary, true) : []),
    {
      id: `${template}-plan`,
      kind: "plan",
      planSlot: "main",
      label: "Zone du plan",
      x: 44,
      y: planY,
      width: sheetW - 88,
      height: Math.max(360, planH),
      rotation: 0,
      visible: true,
      fill: "#ffffff",
      strokeWidth: 0
    },
    {
      id: `${template}-legend`,
      kind: "legend",
      label: "Legende",
      x: 44,
      y: sheetH - 226,
      width: sheetW - 88,
      height: 170,
      rotation: 0,
      visible: true,
      title: "LEGENDE",
      titleColor: "#1a1a1a",
      titleFontSize: 15,
      titleHeight: 30,
      titleAlign: "center",
      titleRule: true,
      fill: "#ffffff",
      stroke: "#1a1a1a",
      strokeWidth: 1,
      color: "#1a1a1a",
      fontSize: 11,
      padding: 8
    },
    {
      id: `${template}-client-logo`,
      kind: "image",
      label: "Logo client",
      imageKey: "clientLogo",
      x: sheetW - 204,
      y: 126,
      width: 150,
      height: 62,
      rotation: 0,
      visible: true
    }
  ];
}

function createOfficialConsigneColumn(
  template: string,
  x: number,
  y: number,
  width: number,
  height: number,
  accent: string,
  secondary: string,
  horizontal = false
): SheetBlock[] {
  const gap = 12;
  const sectionCount = 3;
  const sectionW = horizontal ? (width - gap * 2) / sectionCount : width;
  const sectionH = horizontal ? height : (height - gap * 2) / sectionCount;
  const items = [
    { key: "incendie", title: "INCENDIE", fill: "#e50909", text: "Gardez votre calme\nAttaquez le feu si possible\nAppelez les secours" },
    { key: "evacuation", title: "EVACUATION", fill: accent, text: "Ecoutez le signal\nDirigez-vous vers les sorties\nN'utilisez pas les ascenseurs" },
    { key: "prevention", title: "PREVENTION", fill: secondary, text: "Fermez portes et fenetres\nN'encombrez pas les circulations\nNe revenez pas en arriere" }
  ];

  return items.map((item, index) => ({
    id: `${template}-consigne-${item.key}`,
    kind: "text",
    label: `Consigne ${item.title}`,
    x: horizontal ? x + index * (sectionW + gap) : x,
    y: horizontal ? y : y + index * (sectionH + gap),
    width: sectionW,
    height: sectionH,
    rotation: 0,
    visible: true,
    title: item.title,
    text: item.text,
    titleFill: item.fill,
    titleColor: "#ffffff",
    titleFontSize: horizontal ? 18 : 22,
    titleHeight: horizontal ? 36 : 42,
    titleAlign: "center",
    fill: "#ffffff",
    stroke: item.fill,
    strokeWidth: 1.4,
    cornerRadius: 8,
    color: "#1a1a1a",
    fontSize: horizontal ? 12 : 14,
    fontStyle: "bold",
    align: "left",
    verticalAlign: "top",
    lineHeight: 1.35,
    padding: 12,
    uppercase: true
  }));
}

/**
 * A safety pictogram placed straight on the sheet, at the point that was
 * clicked. Unlike a plan pictogram it is not tied to the drawing, so it can sit
 * in a heading, next to a notice or inside the legend.
 */
export function createPictoBlock(
  iconType: string,
  label: string,
  x: number,
  y: number,
  size: number | { width: number; height: number } = 44
): SheetBlock {
  const width = typeof size === "number" ? size : size.width;
  const height = typeof size === "number" ? size : size.height;
  return {
    id: `picto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "picto",
    label,
    iconType,
    x: Math.round(x - width / 2),
    y: Math.round(y - height / 2),
    width,
    height,
    rotation: 0,
    flipX: false,
    flipY: false,
    visible: true
  };
}

/** A blank text block, dropped in the middle of the sheet. */
export function createFreeTextBlock(
  index: number,
  sheetWidth = SHEET_WIDTH,
  sheetHeight = SHEET_HEIGHT
): SheetBlock {
  return {
    id: `text-${Date.now()}-${index}`,
    kind: "text",
    label: `Texte ${index}`,
    x: sheetWidth / 2 - 150,
    y: sheetHeight / 2 - 30,
    width: 300,
    height: 60,
    rotation: 0,
    visible: true,
    text: "Nouveau texte",
    color: NF_COLORS.text,
    fontSize: 18,
    fontStyle: "bold",
    align: "center",
    verticalAlign: "middle",
    lineHeight: 1.3,
    padding: 6,
    uppercase: false
  };
}

/** All plan windows of a layout. */
export function findPlanBlocks(blocks: SheetBlock[]): SheetBlock[] {
  return blocks.filter((block) => block.kind === "plan");
}

/** The main or first plan window of a layout, if the template has one. */
export function findPlanBlock(blocks: SheetBlock[]): SheetBlock | null {
  return blocks.find((block) => block.kind === "plan" && (block.planSlot === "main" || !block.planSlot)) ?? blocks.find((block) => block.kind === "plan") ?? null;
}
