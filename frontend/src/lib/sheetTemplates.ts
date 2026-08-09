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
 * Coordinates are expressed in sheet units: the sheet is SHEET_WIDTH ×
 * SHEET_HEIGHT, which is the A-series 1:√2 ratio, so A4 and A3 share one layout.
 */

/** Design width of the sheet, in sheet units. */
export const SHEET_WIDTH = 1600;
/** Design height of the sheet: 1600 / √2, rounded. */
export const SHEET_HEIGHT = 1131;

export type SheetBlockKind =
  | "band" // a coloured bar or pill — the section headings
  | "text" // free text, with optional frame and heading line
  | "numbers" // the emergency numbers, set large
  | "legend" // the auto-built pictogram table
  | "image" // a logo
  | "picto" // a safety pictogram dropped anywhere on the sheet
  | "plan"; // the window the plan is drawn into

/** Which uploaded logo an `image` block shows. */
export type SheetImageKey = "clientLogo" | "studioLogo";

export interface SheetBlock {
  id: string;
  kind: SheetBlockKind;
  /** Name shown in the studio's block list. */
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;

  // ── Content ──────────────────────────────────────────────────────────────
  /** Title bar text. Empty or absent means no title bar. */
  title?: string;
  /** Body text. Line breaks are kept, long lines wrap inside the block. */
  text?: string;
  imageKey?: SheetImageKey;
  /** For `picto` blocks: which safety pictogram is shown. */
  iconType?: string;

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
    description:
      "Feuille normalisée : bandeau rouge, consignes incendie / évacuation / prévention à gauche, plan au centre, identité et légende à droite."
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
      label: "Plan (fenêtre)",
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

export function createSheetBlocks(
  template: SheetTemplateKey,
  context: SheetTemplateContext = {}
): SheetBlock[] {
  switch (template) {
    case "nfx08070":
    default:
      return createNfx08070Blocks(context);
  }
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
export function createFreeTextBlock(index: number): SheetBlock {
  return {
    id: `text-${Date.now()}-${index}`,
    kind: "text",
    label: `Texte ${index}`,
    x: SHEET_WIDTH / 2 - 150,
    y: SHEET_HEIGHT / 2 - 30,
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

/** The plan window of a layout, if the template has one. */
export function findPlanBlock(blocks: SheetBlock[]): SheetBlock | null {
  return blocks.find((block) => block.kind === "plan") ?? null;
}
