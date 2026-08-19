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

  // ── Content ──────────────────────────────────────────────────────────────
  /** Title bar text. Empty or absent means no title bar. */
  title?: string;
  /** Body text. Line breaks are kept, long lines wrap inside the block. */
  text?: string;
  imageKey?: SheetImageKey;
  /** For `picto` blocks: which safety pictogram is shown. */
  iconType?: string;
  /** Geometry used by blocks created with the sheet drawing tools. */
  shapeType?: SheetShapeKind;
  shapePoints?: SheetShapePoint[];
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

  const instructionPanel = (
    id: string,
    label: string,
    title: string,
    subtitle: string,
    body: string,
    x: number,
    y: number,
    panelWidth: number,
    panelHeight: number
  ): SheetBlock => ({
    id,
    kind: "text",
    label,
    x,
    y,
    width: panelWidth,
    height: panelHeight,
    rotation: 0,
    visible: true,
    title: `${title}\n${subtitle}`,
    titleColor: text,
    titleFontSize: 13,
    titleHeight: 46,
    titleAlign: "center",
    titleRule: true,
    text: body,
    fill: paper,
    stroke: purple,
    strokeWidth: 2,
    color: text,
    fontSize: 10.5,
    fontStyle: "bold",
    align: "left",
    verticalAlign: "top",
    lineHeight: 1.16,
    padding: 10
  });

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
      text: "🚭  CHAMBRE NON-FUMEUR · NICHTRAUCHER-ZIMMER\nNON-SMOKING ROOM · HABITACIÓN PARA NO FUMADORES",
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

    instructionPanel(
      "room-fr-instructions",
      "Consigne incendie en français",
      "🇫🇷  CONSIGNE D'INCENDIE",
      "Conduite à tenir en cas d'incendie",
      "EN CAS D'INCENDIE DANS VOTRE CHAMBRE :\n• Gardez votre sang-froid, ne criez pas « Au feu ».\n\nEN CAS D'AUDITION DU SIGNAL D'ALARME :\n• Quittez rapidement les lieux.\n• Fermez si possible la fenêtre.\n• Refermez votre porte en sortant et gagnez la sortie sans affolement.\n\nSI VOUS NE POUVEZ MAÎTRISER LE FEU :\n• Quittez la chambre en fermant porte et fenêtre.\n• Prévenez le garçon d'étage ou la direction.",
      48,
      1034,
      448,
      236
    ),
    instructionPanel(
      "room-en-instructions",
      "Special instructions in English",
      "🇬🇧  SPECIAL INSTRUCTIONS",
      "What to do in case of fire",
      "IN CASE OF FIRE IN YOUR ROOM:\n• Keep your calm, do not shout « Fire ».\n\nIF YOU HEAR THE FIRE ALARM:\n• Leave your room as quickly as possible.\n• If possible, close the window.\n• Close the door behind you and leave the hotel without panic by the nearest staircase.\n\nIF YOU CANNOT PUT OUT THE FIRE:\n• Leave the room and windows behind you.\n• Report the fire to staff or management.",
      48,
      1284,
      448,
      244
    ),
    instructionPanel(
      "room-de-instructions",
      "Spezialanweisung auf Deutsch",
      "🇩🇪  SPEZIALANWEISUNG",
      "Wie Sie sich im Falle eines Brandes verhalten",
      "IM FALLE EINES BRANDES IM ZIMMER:\n• Bleiben Sie ruhig, rufen Sie nicht « Feuer ».\n\nBEI ERTÖNEN DES ALARMSIGNALS:\n• Verlassen Sie Ihr Zimmer unverzüglich.\n• Schliessen Sie das Fenster, wenn möglich.\n• Schliessen Sie Ihre Tür beim Herausgehen und benutzen Sie die nächste Treppe.\n\nWENN SIE DEM FEUER NICHT HERR WERDEN:\n• Verlassen Sie Ihr Zimmer und schliessen Sie Tür und Fenster.\n• Benachrichtigen Sie das Personal.",
      635,
      1034,
      448,
      236
    ),
    instructionPanel(
      "room-es-instructions",
      "Consigna especial en español",
      "🇪🇸  CONSIGNA ESPECIAL",
      "Conducta a respetar en caso de incendio",
      "EN CASO DE INCENDIO EN SU HABITACIÓN:\n• Mantenga la sangre fría sin gritar « Fuego ».\n\nEN CASO DE QUE OIGA LA SEÑAL DE ALARMA:\n• Abandone su habitación lo antes posible.\n• Cierre, si puede, la ventana.\n• Cierre su puerta al salir y diríjase a la salida por la escalera más cercana.\n\nSI NO PUEDE DOMINAR EL FUEGO:\n• Salga cerrando la puerta y la ventana.\n• Avise al personal o a la dirección.",
      635,
      1284,
      448,
      244
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

export function createSheetBlocks(
  template: SheetTemplateKey,
  context: SheetTemplateContext = {}
): SheetBlock[] {
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
  size = 44
): SheetBlock {
  return {
    id: `picto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "picto",
    label,
    iconType,
    x: Math.round(x - size / 2),
    y: Math.round(y - size / 2),
    width: size,
    height: size,
    rotation: 0,
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
