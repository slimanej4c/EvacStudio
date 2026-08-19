"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/context/AuthContext";
import { useRouter, useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { ArrowLeft, Save, Trash2, Settings, HelpCircle, Loader2, Sparkles, RefreshCw, X, Download, Eye, PanelLeft, PanelRight, Eraser, Circle, Square, Copy, CopyPlus, ClipboardPaste, Minus, Anchor, Undo2, Redo2, Type, AlertTriangle, Check, PaintBucket, Pencil, Waypoints, FileUp, Crop, FlipHorizontal, FlipVertical, RotateCcw, RotateCw, Lock, Unlock, Stamp, Group as GroupIcon, Ungroup, BoxSelect, Layers3, Library } from "lucide-react";
import { CropModal } from "@/components/CropModal";
import { PolygonCropModal } from "@/components/PolygonCropModal";
import { WatermarkModal } from "@/components/WatermarkModal";
import { BrandLogo } from "@/components/BrandLogo";
import LayerPanel, { EditorLayerItem, LayerMoveDirection } from "@/components/LayerPanel";
import { IconType, SAFETY_ICONS, SafetyIconDefinition, getIconImageSource, isYouAreHereIcon, inferPictogramColor } from "@/utils/safetyIcons";
import { CanvasIcon, CanvasShape, CanvasText, CanvasPlanOverlay, CanvasPlanTransform, CanvasMultiSelection, ShapeKind, EraserShape, EraserTarget, PlanCanvasHandle, FONT_OPTIONS, MAIN_PLAN_ID, isPolygonTool, isPolygonShape, pointLabel, shapeWithoutPoint, boundsFromPoints } from "@/components/PlanCanvas";
import { buildApiUrl } from "@/lib/api";
import {
  SHEET_WIDTH,
  SHEET_HEIGHT,
  SHEET_TEMPLATES,
  SheetBlock,
  SheetTemplateKey,
  createSheetBlocks,
  createFreeTextBlock,
  createPictoBlock
} from "@/lib/sheetTemplates";
import type { SheetLegendEntry } from "@/components/SheetBlockNode";
import { createDefaultWatermarkConfig, normalizeWatermarkConfig, WatermarkConfig } from "@/lib/watermark";
import { DEFAULT_STUDIO_LOGO, getStoredStudioLogo, prepareLogoFile, storeStudioLogo } from "@/lib/brandLogos";
import jsPDF from "jspdf";

// Dynamically load PlanCanvas with SSR disabled since Konva depends on the DOM
const PlanCanvas = dynamic(() => import("@/components/PlanCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 h-[calc(100vh-150px)] bg-white flex items-center justify-center border border-slate-200 rounded-2xl">
      <div className="flex flex-col items-center space-y-4">
        <Loader2 className="h-10 w-10 animate-spin text-safety-green" />
        <p className="text-slate-500 text-sm">Chargement de l'éditeur graphique...</p>
      </div>
    </div>
  )
});

const ZoomControls = dynamic(() => import("@/components/ZoomControls"), { ssr: false });
const ExportButtons = dynamic(() => import("@/components/ExportButtons"), { ssr: false });
const IconToolbar = dynamic(() => import("@/components/IconToolbar"), { ssr: false });

// Ceilings a browser canvas can honour. Chrome caps a canvas at 16 384 px a
// side, and a page that has already allocated a few hundred megabytes of canvas
// gets *blank* results instead of errors — which is exactly what a second or
// third large plan used to hit when it was cleaned. Staying well under both
// keeps every plan readable and leaves room for the ones already on the canvas.
const MAX_CANVAS_SIDE = 8192;
const MAX_CANVAS_PIXELS = 24_000_000;

const EXPORT_CANVAS_WIDTH = 1600;
// A-series paper is 1:√2, so A4 and A3 share one design canvas — only the printed
// size and the resulting resolution differ between them.
const EXPORT_PAPER_SIZES = {
  a2: { label: "A2", widthMm: 594, heightMm: 420 },
  a4: { label: "A4", widthMm: 297, heightMm: 210 },
  a3: { label: "A3", widthMm: 420, heightMm: 297 }
} as const;
type ExportPaperFormat = keyof typeof EXPORT_PAPER_SIZES;
interface StoredSheetTemplateVersion {
  id: string;
  template: SheetTemplateKey;
  name: string;
  blocks: SheetBlock[];
  planPlacement: { scale: number; offsetX: number; offsetY: number };
  createdAt: string;
  updatedAt: string;
}
const EXPORT_PAPER_OPTIONS = (Object.keys(EXPORT_PAPER_SIZES) as ExportPaperFormat[]).map((key) => ({
  key,
  label: EXPORT_PAPER_SIZES[key].label
}));
const EXPORT_OFFICIAL_FONDS = {
  none: { label: "Aucun fond officiel", file: "", paper: "a4", orientation: "landscape" },
  a2PayPi: { label: "A2 PAY PI - Fond de plan", file: "/export-fonds/a2-pay-pi-fond-de-plan.pdf", paper: "a2", orientation: "landscape" },
  a3PePay: { label: "A3 PE PAY", file: "/export-fonds/a3-pe-pay.pdf", paper: "a3", orientation: "landscape" },
  a3PiPay: { label: "A3 PI PAY", file: "/export-fonds/a3-pi-pay.pdf", paper: "a3", orientation: "landscape" },
  a3PiPort: { label: "A3 PI PORT", file: "/export-fonds/a3-pi-port.pdf", paper: "a3", orientation: "portrait" },
  fondA3PePhPor: { label: "Fond A3 PE PH POR", file: "/export-fonds/fond-a3-pe-ph-por.pdf", paper: "a3", orientation: "portrait" },
  fondPhPeA3Pay: { label: "FOND PH PE A3 PAY", file: "/export-fonds/fond-ph-pe-a3-pay.pdf", paper: "a3", orientation: "portrait" },
  fondPhPiA3Pay: { label: "FOND PH PI A3 PAY", file: "/export-fonds/fond-ph-pi-a3-pay.pdf", paper: "a3", orientation: "portrait" },
  fondPiA3PhPor: { label: "FOND PI A3 PH POR", file: "/export-fonds/fond-pi-a3-ph-por.pdf", paper: "a3", orientation: "portrait" },
  fondPsiA3PhPay: { label: "FOND PSI A3 PH PAY", file: "/export-fonds/fond-psi-a3-ph-pay.pdf", paper: "a3", orientation: "landscape" },
  fondPsiPhA3Por: { label: "FOND PSI PH A3 POR", file: "/export-fonds/fond-psi-ph-a3-por.pdf", paper: "a3", orientation: "portrait" },
  peA3Port: { label: "PE A3 PORT", file: "/export-fonds/pe-a3-port.pdf", paper: "a3", orientation: "portrait" },
  piA2Port: { label: "PI A2 PORT", file: "/export-fonds/pi-a2-port.pdf", paper: "a2", orientation: "portrait" }
} as const;
type ExportOfficialFondKey = keyof typeof EXPORT_OFFICIAL_FONDS;
const EXPORT_THEMES = {
  nfx08070: {
    label: "NF X08-070 Incendie",
    description: "Norme française officielle (bannière rouge, numéros 18/112, 15/118, 114 et légende)."
  },
  intervention: {
    label: "Plan d'intervention",
    description: "Planche technique pompiers : plan pleine largeur, colonne d'identification et grande légende à droite."
  },
  evacuation: {
    label: "Plan d'évacuation",
    description: "Bandeau vert, consignes à gauche, point de rassemblement, légende à droite et étiquette de niveau."
  },
  modern: {
    label: "Moderne",
    description: "Bandeau vert, cartes sobres et légende latérale."
  },
  consignes: {
    label: "Consignes latérales",
    description: "Colonne rouge/verte à gauche, grand plan à droite."
  },
  ocean: {
    label: "Océan pro",
    description: "Bleu pétrole, turquoise et fond très clair."
  },
  graphite: {
    label: "Graphite or",
    description: "Noir doux, vert signalétique et accents dorés."
  },
  coral: {
    label: "Corail clair",
    description: "Couleurs chaudes, rouge sécurité et vert frais."
  }
} as const;
type ExportTheme = keyof typeof EXPORT_THEMES;

const EXPORT_THEME_PALETTES = {
  nfx08070: {
    sheet: "#ffffff",
    headerStart: "#e10600",
    headerEnd: "#e10600",
    accent: "#ffd500",
    safety: "#e10600",
    intervention: "#00a651",
    // The normative legend is a plain black-ruled table, not a coloured card.
    legend: "#1a1a1a",
    panelTint: "#ffffff",
    chipFill: "#f8fafc",
    text: "#1a1a1a",
    muted: "#555555",
    border: "rgba(0, 0, 0, 0.25)",
    shadow: "rgba(0, 0, 0, 0.12)"
  },
  evacuation: {
    sheet: "#ffffff",
    headerStart: "#3aa935",
    headerEnd: "#3aa935",
    // The PREVENTION pill rather than a signage accent rule.
    accent: "#f5a623",
    safety: "#e10600",
    intervention: "#3aa935",
    legend: "#1a1a1a",
    panelTint: "#ffffff",
    chipFill: "#f1f5f9",
    text: "#1a1a1a",
    muted: "#8b9199",
    border: "rgba(0, 0, 0, 0.25)",
    shadow: "rgba(0, 0, 0, 0.12)"
  },
  intervention: {
    sheet: "#ffffff",
    headerStart: "#e10600",
    headerEnd: "#e10600",
    // The level tag ("REZ-DE-CHAUSSEE") rather than a signage accent rule.
    accent: "#8b9199",
    safety: "#e10600",
    intervention: "#00a651",
    legend: "#1a1a1a",
    panelTint: "#ffffff",
    chipFill: "#f1f5f9",
    text: "#1a1a1a",
    muted: "#555555",
    border: "rgba(0, 0, 0, 0.25)",
    shadow: "rgba(0, 0, 0, 0.12)"
  },
  modern: {
    sheet: "#eef3f0",
    headerStart: "#0d6b41",
    headerEnd: "#168f5a",
    accent: "#f5c518",
    safety: "#c8362c",
    intervention: "#33475b",
    legend: "#168f5a",
    panelTint: "#f4f8f6",
    chipFill: "#f0f5f2",
    text: "#1f2d27",
    muted: "#7d8c85",
    border: "rgba(12, 42, 28, 0.16)",
    shadow: "rgba(12, 42, 28, 0.16)"
  },
  ocean: {
    sheet: "#edf8fa",
    headerStart: "#074b63",
    headerEnd: "#00a7a7",
    accent: "#ffd166",
    safety: "#d62828",
    intervention: "#146c94",
    legend: "#00a896",
    panelTint: "#e8f7f7",
    chipFill: "#dff5f2",
    text: "#12343b",
    muted: "#607d86",
    border: "rgba(7, 75, 99, 0.18)",
    shadow: "rgba(7, 75, 99, 0.18)"
  },
  graphite: {
    sheet: "#f3f4f2",
    headerStart: "#20252b",
    headerEnd: "#48515a",
    accent: "#d9a441",
    safety: "#c92a2a",
    intervention: "#3f6f50",
    legend: "#168f5a",
    panelTint: "#f7f5ef",
    chipFill: "#f1eadb",
    text: "#222831",
    muted: "#70777c",
    border: "rgba(32, 37, 43, 0.18)",
    shadow: "rgba(32, 37, 43, 0.18)"
  },
  coral: {
    sheet: "#fff7f1",
    headerStart: "#b83227",
    headerEnd: "#ff7a45",
    accent: "#20bf6b",
    safety: "#d7263d",
    intervention: "#168f5a",
    legend: "#0e9f6e",
    panelTint: "#fff0e6",
    chipFill: "#ffe7d6",
    text: "#3d2c29",
    muted: "#8b6f69",
    border: "rgba(184, 50, 39, 0.18)",
    shadow: "rgba(184, 50, 39, 0.16)"
  },
  consignes: {
    sheet: "#ffffff",
    headerStart: "#007a3d",
    headerEnd: "#00a651",
    accent: "#f5c518",
    safety: "#e5231b",
    intervention: "#00a651",
    legend: "#00a651",
    panelTint: "#f4f8f6",
    chipFill: "#f0f5f2",
    text: "#1f2d27",
    muted: "#7f8585",
    border: "rgba(12, 42, 28, 0.16)",
    shadow: "rgba(12, 42, 28, 0.16)"
  }
} as const;
type ExportPalette = { [K in keyof typeof EXPORT_THEME_PALETTES.modern]: string };

const EXPORT_CUSTOM_COLOR_FIELDS = [
  { key: "headerStart", label: "Bandeau début" },
  { key: "headerEnd", label: "Bandeau fin" },
  { key: "accent", label: "Ligne accent" },
  { key: "safety", label: "Cadre consignes" },
  { key: "intervention", label: "Cadre intervention" },
  { key: "legend", label: "Cadre légende" },
  { key: "sheet", label: "Fond page" },
  { key: "text", label: "Texte" }
] as const;
type ExportCustomColorKey = typeof EXPORT_CUSTOM_COLOR_FIELDS[number]["key"];

const DEFAULT_EXPORT_CUSTOM_COLORS: Record<ExportCustomColorKey, string> = {
  headerStart: "#0d6b41",
  headerEnd: "#168f5a",
  accent: "#f5c518",
  safety: "#c8362c",
  intervention: "#33475b",
  legend: "#168f5a",
  sheet: "#eef3f0",
  text: "#1f2d27"
};

// Banner title each theme starts from. The normative sheet is a fire-safety
// plan, not an evacuation plan, and says so in its own banner.
const EXPORT_THEME_DEFAULT_TITLES: Record<ExportTheme, string> = {
  nfx08070: "PLAN DE SECURITE INCENDIE",
  intervention: "PLAN D'INTERVENTION",
  evacuation: "PLAN D'EVACUATION",
  modern: "PLAN D'ÉVACUATION",
  consignes: "PLAN D'ÉVACUATION",
  ocean: "PLAN D'ÉVACUATION",
  graphite: "PLAN D'ÉVACUATION",
  coral: "PLAN D'ÉVACUATION"
};

/**
 * True when the title is still one theme's untouched default — switching theme
 * may then replace it. A title the user typed is never overwritten.
 */
const isUntouchedExportTitle = (title: string) => {
  const trimmed = title.trim();
  if (!trimmed) return true;
  return Object.values(EXPORT_THEME_DEFAULT_TITLES).some(
    (preset) => preset.toLowerCase() === trimmed.toLowerCase()
  );
};

// Colour fields actually used by each theme, with the wording of that theme.
// The generic list above describes the "modern" sheet; the normative one has no
// gradient band and names its colours after the regulatory blocks instead.
const EXPORT_THEME_COLOR_FIELDS: Partial<Record<ExportTheme, ReadonlyArray<{ key: ExportCustomColorKey; label: string }>>> = {
  nfx08070: [
    { key: "headerStart", label: "Bandeau titre" },
    { key: "safety", label: "Rouge incendie" },
    { key: "intervention", label: "Vert évacuation" },
    { key: "accent", label: "Jaune prévention" },
    { key: "legend", label: "Cadre légende" },
    { key: "sheet", label: "Fond page" },
    { key: "text", label: "Texte" }
  ],
  intervention: [
    { key: "headerStart", label: "Bandeau titre" },
    { key: "accent", label: "Étiquette niveau" },
    { key: "legend", label: "Cadre légende" },
    { key: "sheet", label: "Fond page" },
    { key: "text", label: "Texte" }
  ],
  evacuation: [
    { key: "headerStart", label: "Bandeau vert" },
    { key: "safety", label: "Rouge incendie" },
    { key: "intervention", label: "Vert évacuation" },
    { key: "accent", label: "Orange prévention" },
    { key: "legend", label: "Cadre légende" },
    { key: "sheet", label: "Fond page" },
    { key: "text", label: "Texte" }
  ]
};

// ── NF X08-070: editable copy ───────────────────────────────────────────────
// The normative sheet carries blocks no other theme has (emergency numbers,
// numbered evacuation steps, prevention notice), so they get their own defaults
// rather than being squeezed into the generic "consignes / intervention" pair.
const NF_DEFAULT_EVACUATION_TEXT = [
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

const NF_DEFAULT_PREVENTION_TEXT = [
  "EN CAS DE FUMEES, BAISSEZ-VOUS. L'AIR FRAIS EST PRES DU SOL.",
  "N'ENTREZ JAMAIS DANS LA FUMEE.",
  "N'ENCOMBREZ PAS LES PALIERS ET LES CIRCULATIONS.",
  "EN CAS D'INCENDIE, VEILLEZ A FERMER LES PORTES ET FENETRES DERRIERE VOUS, POUR LIMITER LA PROPAGATION DES FLAMMES."
].join("\n\n");

const NF_DEFAULTS = {
  conformity: "CONFORME A LA NF X08-070 ET ARRETE DU 19/06/2015",
  fireTitle: "INCENDIE",
  fireIntro: "VEUILLEZ APPELER LES SERVICES DE SECOURS EN COMPOSANT LE :",
  fireNumbers: "18 / 112",
  emergencyNote: "EN PRECISANT LE LIEU EXACT DE L'ACCIDENT.",
  evacuationTitle: "EVACUATION",
  evacuationText: NF_DEFAULT_EVACUATION_TEXT,
  medicalTitle: "ACCIDENT OU MALAISE",
  medicalNumbers: "15 / 118",
  deafText: "Numéro d'urgence pour les personnes ayant des soucis à entendre ou à parler.",
  preventionTitle: "PREVENTION",
  preventionText: NF_DEFAULT_PREVENTION_TEXT,
  legendTitle: "LEGENDE"
} as const;

// ── "Plan d'évacuation": editable copy ──────────────────────────────────────
// Its instruction column is prose, not the numbered NF steps, so it carries its
// own defaults rather than sharing the normative sheet's wording.
const EVAC_DEFAULTS = {
  conformity: "CONFORME A LA NORME NF X08-070",
  fireTitle: "INCENDIE",
  fireText: [
    "EN CAS D'INCENDIE, GARDEZ VOTRE CALME ET DECLENCHEZ LE BOITIER LE PLUS PROCHE.",
    "ATTAQUEZ LE FOYER PAR LA BASE AU MOYEN DES EXTINCTEURS SANS PRENDRE DE RISQUES.",
    "DANS LA CHALEUR ET LA FUMEE, BAISSEZ-VOUS, L'AIR FRAIS EST PRES DU SOL."
  ].join("\n\n"),
  callText: "Appel d'urgence : 18 ou 112\nou le service de sécurité :",
  evacuationTitle: "EVACUATION",
  evacuationText: [
    "A L'AUDITION DU SIGNAL OU SUR ORDRE D'UN RESPONSABLE, FERMEZ LES PORTES ET LES FENETRES.",
    "SUIVEZ LES INDICATIONS DU GUIDE OU DIRIGEZ-VOUS VERS LES SORTIES LES PLUS PROCHES.",
    "N'UTILISEZ PAS LES ASCENSEURS OU MONTE-CHARGES S'ILS EXISTENT.",
    "NE REVENEZ PAS EN ARRIERE SANS Y AVOIR ETE INVITE."
  ].join("\n\n"),
  preventionTitle: "PREVENTION",
  preventionText: [
    "FERMEZ FENETRES ET PORTES EN QUITTANT LES LIEUX.",
    "N'ENCOMBREZ PAS LE MATERIEL INCENDIE, LES ISSUES ET LES CIRCULATIONS.",
    "IL EST FORMELLEMENT INTERDIT DE FUMER ET DE VAPOTER."
  ].join("\n\n"),
  assemblyLabel: "POINT DE RASSEMBLEMENT :"
} as const;

const EXPORT_CANVAS_HEIGHT = 1131; // 1600 / √2, rounded
const ICON_CLIPBOARD_KEY = "securplan:icon-clipboard";
const SHEET_TEMPLATE_STORAGE_KEY = "securplan:sheet-template-versions";
const LEGACY_SHEET_TEMPLATE_STORAGE_PREFIX = "securplan:sheet-template-versions";
const EXPORT_FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const EXPORT_CARD_RADIUS = 10;
const EXPORT_CARD_HEADER_H = 38;
const EXPORT_MARGIN = 30;
const EXPORT_GUTTER = 24;
const EXPORT_SIDE_W = 292;
const EXPORT_HEADER_H = 104;
const EXPORT_FOOTER_H = 44;
const EXPORT_OUTPUT_SCALE = 4;
const EXPORT_STAGE_PIXEL_RATIO = 6;
// Print resolution of an exported file. What matters is the size on paper, not
// the pixel count: capturing a large plan at a fixed ratio gave a hundred-
// megapixel image, and a PDF of several hundred megabytes with it.
const EXPORT_TARGET_DPI = 300;
const EXPORT_MAX_PIXEL_RATIO = 6;

const SVG_EXPORT_PADDING = 8;

const escapeSvgText = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const escapeSvgAttribute = (value: string) =>
  escapeSvgText(value)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const svgNumber = (value: number) =>
  Number.isFinite(value) ? Number(value.toFixed(3)).toString() : "0";

const downloadTextFile = (content: string, filename: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 800);
};

/** Longest edge, in pixels, that fills the given paper at the export's dpi. */
const paperLongEdgePx = (paper: { widthMm: number; heightMm: number }) =>
  (Math.max(paper.widthMm, paper.heightMm) / 25.4) * EXPORT_TARGET_DPI;

/** Capture ratio that brings a region of that size to the wanted long edge. */
const fitPixelRatio = (width: number, height: number, targetLongEdgePx: number) => {
  const longEdge = Math.max(width, height);
  if (!longEdge) return 1;
  return Math.min(EXPORT_MAX_PIXEL_RATIO, Math.max(1, targetLongEdgePx / longEdge));
};
const EXPORT_PREVIEW_STAGE_PIXEL_RATIO = 2;

const PRESET_COLORS = [
  { name: "Vert foncé", hex: "#15803d" },
  { name: "Vert clair", hex: "#22c55e" },
  { name: "Vert sécurité", hex: "#16a34a" },
  { name: "Jaune", hex: "#eab308" },
  { name: "Orange", hex: "#f97316" },
  { name: "Rouge", hex: "#ef4444" },
  { name: "Bleu", hex: "#0284c7" },
  { name: "Cyan", hex: "#06b6d4" },
  { name: "Gris foncé", hex: "#475569" },
  { name: "Gris clair", hex: "#94a3b8" },
  { name: "Noir", hex: "#000000" },
  { name: "Blanc", hex: "#ffffff" },
];

interface EvacuationPlanBackend {
  id: number;
  created_at: string;
  updated_at: string;
  title: string;
  building_name: string;
  floor_name: string;
  background_file: string;
  background_type: "image" | "pdf";
  cleaned_background_file: string | null;
  use_cleaned_background: boolean;
  main_plan_x: number;
  main_plan_y: number;
  main_plan_width: number;
  main_plan_height: number;
  main_plan_locked: boolean;
  main_plan_visible?: boolean;
  main_plan_z_index?: number;
  main_plan_group_id?: string;
  main_plan_grouping_enabled?: boolean;
  watermark_config?: Partial<WatermarkConfig>;
  icons: Array<{
    id: number;
    icon_type: IconType;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    label: string;
    anchor_x: number | null;
    anchor_y: number | null;
    leader_width?: number;
    framed?: boolean;
    flip_x?: boolean;
    color?: string;
    flip_y?: boolean;
    locked?: boolean;
    visible?: boolean;
    z_index?: number;
    group_id?: string;
    object_group_id?: string;
  }>;
  shapes?: Array<{
    id: number;
    shape_type: ShapeKind;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    stroke_width: number;
    color: string;
    fill_color?: string | null;
    fill_opacity?: number | null;
    tension?: number | null;
    control_points?: Record<number, { x: number; y: number }> | null;
    points?: Array<{ x: number; y: number }> | null;
    locked?: boolean;
    visible?: boolean;
    z_index?: number;
    group_id?: string;
    object_group_id?: string;
  }>;
  texts?: Array<{
    id: number;
    text: string;
    x: number;
    y: number;
    font_size: number;
    font_family: string;
    color: string;
    bold: boolean;
    italic: boolean;
    background_color: string | null;
    rotation: number;
    locked?: boolean;
    visible?: boolean;
    z_index?: number;
    group_id?: string;
    object_group_id?: string;
  }>;
  overlays?: Array<{
    id: number;
    image_url: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    label: string;
    locked?: boolean;
    visible?: boolean;
    z_index?: number;
    group_id?: string;
    is_original?: boolean;
    can_revert_original?: boolean;
  }>;
  overlay_ids?: number[];
}

/**
 * Multipart creation used to turn an omitted visibility checkbox into False.
 * Recover only untouched records created by that bug; once a plan has been
 * edited, a hidden main layer is an intentional saved choice and stays hidden.
 */
function isAccidentallyHiddenFreshImport(plan: EvacuationPlanBackend): boolean {
  if (plan.main_plan_visible !== false) return false;
  const createdAt = Date.parse(plan.created_at);
  const updatedAt = Date.parse(plan.updated_at);
  const wasNeverUpdated = Number.isFinite(createdAt)
    && Number.isFinite(updatedAt)
    && updatedAt >= createdAt
    && updatedAt - createdAt <= 1_000;
  const hasUntouchedPlacement = !plan.main_plan_x
    && !plan.main_plan_y
    && !plan.main_plan_width
    && !plan.main_plan_height;
  const hasNoEditorContent = !(plan.icons || []).length
    && !(plan.shapes || []).length
    && !(plan.texts || []).length
    && !(plan.overlays || []).length;
  return wasNeverUpdated && hasUntouchedPlacement && hasNoEditorContent;
}

interface PlanPictogramBackend {
  type: string;
  label: string;
  file_name: string;
  url: string;
  deletable?: boolean;
}

type CleanMethod = "local_plan" | "local_walls" | "grok";

type GrokJobStatus =
  | "pending"
  | "analyzing"
  | "generating"
  | "completed"
  | "failed";

interface GrokJob {
  job_id: number;
  status: GrokJobStatus;
  target_kind?: "main" | "overlay";
  error?: string;
  error_code?: string;
  diagnostic?: string;
  before_image?: string;
  after_image?: string;
  analysis?: Record<string, unknown>;
  generation_prompt?: string;
  model?: string;
}

const GROK_POLL_INTERVAL_MS = 2_000;
const GROK_STATUS_REQUEST_TIMEOUT_MS = 15_000;
const GROK_LAUNCH_REQUEST_TIMEOUT_MS = 30_000;
const GROK_CLIENT_MAX_DURATION_MS = 12 * 60_000;
const GROK_MAX_POLL_ATTEMPTS = Math.ceil(
  GROK_CLIENT_MAX_DURATION_MS / GROK_POLL_INTERVAL_MS,
);

interface CleaningHistoryItem {
  id: number;
  plan: number;
  created_at: string;
  cleaning_method: string;
  title: string;
  image_url: string;
  options: Record<string, unknown>;
}

export default function PlanEditorPage() {
  const { id } = useParams();
  const { loading: authLoading, token, user } = useAuth();
  const router = useRouter();
  
  const [plan, setPlan] = useState<EvacuationPlanBackend | null>(null);
  const [availableIconDefinitions, setAvailableIconDefinitions] = useState<Record<string, SafetyIconDefinition>>(SAFETY_ICONS);
  const [icons, setIcons] = useState<CanvasIcon[]>([]);
  const [shapes, setShapes] = useState<CanvasShape[]>([]);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [shapeTool, setShapeTool] = useState<ShapeKind | null>(null);
  const [shapeStrokeWidth, setShapeStrokeWidth] = useState(3);
  const [shapeColor, setShapeColor] = useState("#3b82f6");
  const [selectedIconId, setSelectedIconId] = useState<string | null>(null);
  const [placementIconType, setPlacementIconType] = useState<IconType | null>(null);
  const [defaultIconSize, setDefaultIconSize] = useState({ width: 40, height: 40 });

  // Free text annotations
  const [texts, setTexts] = useState<CanvasText[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [placementText, setPlacementText] = useState(false);
  
  const [zoom, setZoom] = useState(1.0);
  const [fitSignal, setFitSignal] = useState(0);
  const [canvasRotation, setCanvasRotation] = useState(0);
  const [mode, setMode] = useState<"select" | "pan" | "erase">("select");
  const spaceHeldRef = useRef(false);
  const modeBeforeSpaceRef = useRef<"select" | "pan" | "erase">("select");
  const [leftDockOpen, setLeftDockOpen] = useState(true);
  const [leftDockTab, setLeftDockTab] = useState<"library" | "layers">("library");
  const [rightDockOpen, setRightDockOpen] = useState(true);
  // Default to 100% so the canvas fills the available space and no inert
  // backdrop is left on the right side of the window.
  const [canvasWidthPercent, setCanvasWidthPercent] = useState(100);
  const planCanvasRef = useRef<PlanCanvasHandle>(null);
  const [eraserSize, setEraserSize] = useState(24);
  const [eraserShape, setEraserShape] = useState<EraserShape>("square");
  const [eraserTarget, setEraserTarget] = useState<EraserTarget>("lines");
  const [eraseStrokeCount, setEraseStrokeCount] = useState(0);
  const [undoEraseSignal, setUndoEraseSignal] = useState(0);
  const [resetEraseSignal, setResetEraseSignal] = useState(0);
  // Stroke count undo/redo wants the eraser to be at, so it shares one timeline.
  // The nonce makes two successive requests for the same count distinct values,
  // otherwise React drops the second one and the strokes stay out of step.
  const [eraseStrokeTarget, setEraseStrokeTarget] = useState<{ count: number; nonce: number } | null>(null);
  const eraseTargetNonceRef = useRef(0);
  const requestEraseStrokeTarget = useCallback((count: number) => {
    eraseTargetNonceRef.current += 1;
    setEraseStrokeTarget({ count, nonce: eraseTargetNonceRef.current });
  }, []);
  const [savingErase, setSavingErase] = useState(false);
  const [clipboardHasIcon, setClipboardHasIcon] = useState(() =>
    typeof window !== "undefined" && Boolean(window.localStorage.getItem(ICON_CLIPBOARD_KEY))
  );
  const [loading, setLoading] = useState(true);
  const [planOverlays, setPlanOverlays] = useState<CanvasPlanOverlay[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [areaSelectionMode, setAreaSelectionMode] = useState(false);
  const [multiSelection, setMultiSelection] = useState<CanvasMultiSelection>({
    iconIds: [],
    shapeIds: [],
    textIds: [],
  });
  const [mainPlanTransform, setMainPlanTransform] = useState<CanvasPlanTransform>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const [mainPlanLocked, setMainPlanLocked] = useState(false);
  const [mainPlanVisible, setMainPlanVisible] = useState(true);
  const [mainPlanZIndex, setMainPlanZIndex] = useState(0);
  const [mainPlanGroupId, setMainPlanGroupId] = useState("");
  const [mainPlanGroupingEnabled, setMainPlanGroupingEnabled] = useState(false);
  const [watermarkConfig, setWatermarkConfig] = useState<WatermarkConfig>(() =>
    createDefaultWatermarkConfig()
  );
  const [watermarkDraft, setWatermarkDraft] = useState<WatermarkConfig>(() =>
    createDefaultWatermarkConfig()
  );
  const [watermarkModalOpen, setWatermarkModalOpen] = useState(false);
  const [selectedBatBlock, setSelectedBatBlock] = useState(false);
  // Sheet state lives above the shared history stack because sheet edits use
  // the same Ctrl/Cmd+Z timeline as objects placed directly on the plan.
  const [sheetTemplate, setSheetTemplate] = useState<SheetTemplateKey | "none">("none");
  const [sheetBlocks, setSheetBlocks] = useState<SheetBlock[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [sheetPlanPlacement, setSheetPlanPlacement] = useState({ scale: 100, offsetX: 0, offsetY: 0 });

  const getNextLayerZIndex = () => Math.max(
    mainPlanZIndex,
    ...planOverlays.map((overlay) => overlay.z_index ?? 100),
    ...shapes.map((shape) => shape.z_index ?? 200),
    ...icons.map((icon) => icon.z_index ?? 300),
    ...texts.map((text) => text.z_index ?? 400),
  ) + 10;

  // ── Undo / Redo History Stack (up to 50 steps) ───────────────────────────
  // Regulated pictogram colours first (NF X08-070), then neutrals for the plan's
// own annotations. A free picker sits beside them for anything else.
const ICON_COLOR_SWATCHES = [
  { value: "#e63329", label: "Rouge incendie" },
  { value: "#00a651", label: "Vert évacuation" },
  { value: "#3046b8", label: "Bleu obligation" },
  { value: "#ffd500", label: "Jaune danger" },
  { value: "#f97316", label: "Orange" },
  { value: "#7c3aed", label: "Violet" },
  { value: "#111827", label: "Noir" },
  { value: "#6b7280", label: "Gris" },
] as const;

const MAX_HISTORY_STEPS = 50;
  const [history, setHistory] = useState<
    Array<{
      icons: CanvasIcon[];
      shapes: CanvasShape[];
      texts: CanvasText[];
      overlays: CanvasPlanOverlay[];
      mainPlanTransform: CanvasPlanTransform;
      mainPlanLocked: boolean;
      mainPlanVisible: boolean;
      mainPlanZIndex: number;
      mainPlanGroupId: string;
      mainPlanGroupingEnabled: boolean;
      watermark: WatermarkConfig;
      sheetTemplate: SheetTemplateKey | "none";
      sheetBlocks: SheetBlock[];
      sheetPlanPlacement: { scale: number; offsetX: number; offsetY: number };
      eraseStrokeCount: number;
      signature: string;
    }>
  >([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const historyIndexRef = useRef<number>(-1);
  // Mirrors `history` so undo/redo always read the live stack. Reading the state
  // instead made two quick Ctrl+Z land on the same step: the second press still
  // ran the previous closure.
  const historyRef = useRef<typeof history>([]);
  // How long to wait before snapshotting. Normally immediate; raised while the
  // arrow keys repeat so the whole run collapses into a single undo step.
  const historyDelayRef = useRef(0);
  const NUDGE_HISTORY_COALESCE_MS = 400;
  const isHistoryActionRef = useRef<boolean>(false);
  const pendingHistorySnapshotRef = useRef<(typeof history)[number] | null>(null);
  const historyTimerRef = useRef<number | null>(null);

  const commitHistorySnapshot = useCallback((snapshot: (typeof history)[number]) => {
    const currentIndex = historyIndexRef.current;
    const previous = historyRef.current;
    if (currentIndex >= 0 && previous[currentIndex]?.signature === snapshot.signature) {
      return;
    }

    const validHistory = previous.slice(0, currentIndex + 1);
    const nextHistory = [...validHistory, snapshot].slice(-MAX_HISTORY_STEPS);
    historyRef.current = nextHistory;
    historyIndexRef.current = nextHistory.length - 1;
    setHistory(nextHistory);
    setHistoryIndex(historyIndexRef.current);
    historyDelayRef.current = 0;
  }, []);

  const flushPendingHistorySnapshot = useCallback(() => {
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    const pendingSnapshot = pendingHistorySnapshotRef.current;
    pendingHistorySnapshotRef.current = null;
    if (pendingSnapshot) commitHistorySnapshot(pendingSnapshot);
  }, [commitHistorySnapshot]);

  useEffect(() => {
    if (loading) return;
    if (isHistoryActionRef.current) {
      isHistoryActionRef.current = false;
      return;
    }

    const comparableOverlays = planOverlays.map(({ tempId, url, x, y, width, height, rotation, label, locked, visible, z_index, group_id }) => ({
      tempId, url, x, y, width, height, rotation, label, locked, visible, z_index, group_id,
    }));
    const signature = JSON.stringify({
      icons,
      shapes,
      texts,
      overlays: comparableOverlays,
      mainPlanTransform,
      mainPlanLocked,
      mainPlanVisible,
      mainPlanZIndex,
      mainPlanGroupId,
      mainPlanGroupingEnabled,
      watermark: watermarkConfig,
      sheetTemplate,
      sheetBlocks,
      sheetPlanPlacement,
      eraseStrokeCount,
    });
    const currentSnapshot = {
      icons,
      shapes,
      texts,
      overlays: planOverlays,
      mainPlanTransform,
      mainPlanLocked,
      mainPlanVisible,
      mainPlanZIndex,
      mainPlanGroupId,
      mainPlanGroupingEnabled,
      watermark: watermarkConfig,
      sheetTemplate,
      sheetBlocks,
      sheetPlanPlacement,
      eraseStrokeCount,
      signature,
    };

    // Held down, an arrow key repeats ~30 times a second. Recorded one by one
    // those would fill the whole stack and make a single undo useless, so a run
    // of nudges is coalesced into the one step the user thinks they made.
    pendingHistorySnapshotRef.current = currentSnapshot;
    historyTimerRef.current = window.setTimeout(() => {
      historyTimerRef.current = null;
      const pendingSnapshot = pendingHistorySnapshotRef.current;
      pendingHistorySnapshotRef.current = null;
      if (pendingSnapshot) commitHistorySnapshot(pendingSnapshot);
    }, historyDelayRef.current);
    return () => {
      if (historyTimerRef.current !== null) {
        window.clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
    };
  }, [icons, shapes, texts, planOverlays, mainPlanTransform, mainPlanLocked, mainPlanVisible, mainPlanZIndex, mainPlanGroupId, mainPlanGroupingEnabled, watermarkConfig, sheetTemplate, sheetBlocks, sheetPlanPlacement, eraseStrokeCount, loading, commitHistorySnapshot]);

  const handleUndo = useCallback(() => {
    if (planCanvasRef.current?.undoActiveDrawing()) return;
    // Shape completion and drag updates are snapshot asynchronously. Flush the
    // visible state first so an immediate Ctrl/Cmd+Z always undoes that action,
    // rather than skipping back to an older unrelated one.
    flushPendingHistorySnapshot();
    const index = historyIndexRef.current;
    const stack = historyRef.current;
    if (index <= 0 || !stack[index - 1]) return;
    const target = stack[index - 1];
    isHistoryActionRef.current = true;
    setIcons(target.icons);
    setShapes(target.shapes);
    setTexts(target.texts);
    setPlanOverlays(target.overlays);
    setMainPlanTransform(target.mainPlanTransform);
    setMainPlanLocked(target.mainPlanLocked);
    setMainPlanVisible(target.mainPlanVisible);
    setMainPlanZIndex(target.mainPlanZIndex);
    setMainPlanGroupId(target.mainPlanGroupId);
    setMainPlanGroupingEnabled(target.mainPlanGroupingEnabled);
    setWatermarkConfig(target.watermark);
    setSheetTemplate(target.sheetTemplate ?? "none");
    setSheetBlocks(target.sheetBlocks ?? []);
    setSheetPlanPlacement(target.sheetPlanPlacement ?? { scale: 100, offsetX: 0, offsetY: 0 });
    setSelectedBlockId((currentId) =>
      currentId && target.sheetBlocks?.some((block) => block.id === currentId) ? currentId : null
    );
    requestEraseStrokeTarget(target.eraseStrokeCount ?? 0);
    setAreaSelectionMode(false);
    setMultiSelection({ iconIds: [], shapeIds: [], textIds: [] });
    setSelectedOverlayId(null);
    setSelectedBatBlock(false);
    historyIndexRef.current = index - 1;
    setHistoryIndex(historyIndexRef.current);
  }, [flushPendingHistorySnapshot, requestEraseStrokeTarget]);

  const handleRedo = useCallback(() => {
    flushPendingHistorySnapshot();
    const index = historyIndexRef.current;
    const stack = historyRef.current;
    if (index < 0 || index >= stack.length - 1 || !stack[index + 1]) return;
    const target = stack[index + 1];
    isHistoryActionRef.current = true;
    setIcons(target.icons);
    setShapes(target.shapes);
    setTexts(target.texts);
    setPlanOverlays(target.overlays);
    setMainPlanTransform(target.mainPlanTransform);
    setMainPlanLocked(target.mainPlanLocked);
    setMainPlanVisible(target.mainPlanVisible);
    setMainPlanZIndex(target.mainPlanZIndex);
    setMainPlanGroupId(target.mainPlanGroupId);
    setMainPlanGroupingEnabled(target.mainPlanGroupingEnabled);
    setWatermarkConfig(target.watermark);
    setSheetTemplate(target.sheetTemplate ?? "none");
    setSheetBlocks(target.sheetBlocks ?? []);
    setSheetPlanPlacement(target.sheetPlanPlacement ?? { scale: 100, offsetX: 0, offsetY: 0 });
    setSelectedBlockId((currentId) =>
      currentId && target.sheetBlocks?.some((block) => block.id === currentId) ? currentId : null
    );
    requestEraseStrokeTarget(target.eraseStrokeCount ?? 0);
    setAreaSelectionMode(false);
    setMultiSelection({ iconIds: [], shapeIds: [], textIds: [] });
    setSelectedOverlayId(null);
    setSelectedBatBlock(false);
    historyIndexRef.current = index + 1;
    setHistoryIndex(historyIndexRef.current);
  }, [flushPendingHistorySnapshot, requestEraseStrokeTarget]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextEditingTarget =
        target &&
        (target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          (target.tagName === "INPUT" &&
            ["text", "search", "email", "url", "tel", "password"].includes(
              (target as HTMLInputElement).type
            )));

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (!isTextEditingTarget) {
          e.preventDefault();
          if (e.shiftKey) {
            handleRedo();
          } else {
            handleUndo();
          }
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        if (!isTextEditingTarget) {
          e.preventDefault();
          handleRedo();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo]);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleaningText, setCleaningText] = useState("Traitement OpenCV en cours...");
  const [cleanModalOpen, setCleanModalOpen] = useState(false);
  const [revertConfirmOpen, setRevertConfirmOpen] = useState(false);
  const [cleanMethod, setCleanMethod] = useState<CleanMethod>("local_plan");
  // xAI API key (Grok) — stored per user on the backend, edited from the modal.
  const [xaiApiKey, setXaiApiKey] = useState("");
  const [xaiHasSavedKey, setXaiHasSavedKey] = useState(false);
  const [xaiSettingsUpdatedAt, setXaiSettingsUpdatedAt] = useState<string | null>(null);
  const [xaiSettingsLoading, setXaiSettingsLoading] = useState(false);
  const [xaiKeySaving, setXaiKeySaving] = useState(false);
  const [xaiKeyDeleting, setXaiKeyDeleting] = useState(false);
  const [xaiKeyTesting, setXaiKeyTesting] = useState(false);
  const [xaiKeyStatus, setXaiKeyStatus] = useState("");
  const [xaiKeyConfigOpen, setXaiKeyConfigOpen] = useState(false);
  // Grok cleaning job (analysis + image generation), polled while running.
  const [grokCleaning, setGrokCleaning] = useState(false);
  const [grokJob, setGrokJob] = useState<GrokJob | null>(null);
  const [grokError, setGrokError] = useState("");
  const [grokBackgroundColor, setGrokBackgroundColor] = useState("#FFFFFF");
  const [grokWallColor, setGrokWallColor] = useState("#000000");
  const [grokPreset, setGrokPreset] = useState<"evacuation" | "autocad" | "sketch">("evacuation");
  const grokColorsConflict =
    grokPreset === "sketch" &&
    grokWallColor.trim().toUpperCase() === grokBackgroundColor.trim().toUpperCase();
  const [changingBackground, setChangingBackground] = useState(false);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [polygonCropModalOpen, setPolygonCropModalOpen] = useState(false);
  const [polygonCropMainUrl, setPolygonCropMainUrl] = useState("");
  const [cropping, setCropping] = useState(false);
  const changePlanInputRef = useRef<HTMLInputElement>(null);

  const handleApplyCrop = async (crop: { x: number; y: number; width: number; height: number }) => {
    setCropping(true);
    setSaveStatus("Rognage et repositionnement des éléments...");

    const bgDims = planCanvasRef.current?.getBackgroundDimensions() || { width: 0, height: 0 };
    const displayedWidth = mainPlanTransform.width > 0 ? mainPlanTransform.width : bgDims.width;
    const displayedHeight = mainPlanTransform.height > 0 ? mainPlanTransform.height : bgDims.height;
    const croppedTransform: CanvasPlanTransform = {
      x: mainPlanTransform.x + crop.x * displayedWidth,
      y: mainPlanTransform.y + crop.y * displayedHeight,
      width: Math.max(1, crop.width * displayedWidth),
      height: Math.max(1, crop.height * displayedHeight),
    };

    try {
      const res = await fetch(buildApiUrl(`/api/plans/${id}/crop/`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getPlanAuthHeaders() },
        body: JSON.stringify({ ...crop, normalized: true }),
      });

      if (res.ok) {
        const updatedPlan: EvacuationPlanBackend = await res.json();
        setPlan(updatedPlan);
        setMainPlanTransform(croppedTransform);
        setCropModalOpen(false);
        setSaveStatus("Plan rogné, éléments conservés — sauvegardez le projet");
        window.setTimeout(() => setSaveStatus(""), 3500);
        void fetchCleaningHistory();
      } else {
        const data = await res.json();
        alert(data.error || "Erreur lors du rognage du plan.");
      }
    } catch (err) {
      console.error(err);
      alert("Impossible de joindre le serveur pour le rognage.");
    } finally {
      setCropping(false);
    }
  };

  const handleChangePlanFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setChangingBackground(true);
    setSaveStatus("Changement du plan d'arrière-plan...");
    try {
      const formData = new FormData();
      formData.append("background_file", file);

      const res = await fetch(buildApiUrl(`/api/plans/${id}/change-background/`), {
        method: "POST",
        headers: getPlanAuthHeaders(),
        body: formData,
      });

      if (res.ok) {
        const updatedPlan: EvacuationPlanBackend = await res.json();
        setPlan(updatedPlan);
        setMainPlanTransform({
          x: updatedPlan.main_plan_x || 0,
          y: updatedPlan.main_plan_y || 0,
          width: updatedPlan.main_plan_width || 0,
          height: updatedPlan.main_plan_height || 0,
        });
        setMainPlanVisible(true);
        setSelectedOverlayId(MAIN_PLAN_ID);
        setFitSignal((current) => current + 1);
        setSaveStatus("Plan remplacé avec succès !");
        window.setTimeout(() => setSaveStatus(""), 3500);
        void fetchCleaningHistory();
      } else {
        alert("Erreur lors du remplacement du plan d'arrière-plan.");
      }
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la communication avec le serveur.");
    } finally {
      setChangingBackground(false);
      if (changePlanInputRef.current) changePlanInputRef.current.value = "";
    }
  };

  // Cleaning history (local + Grok), shared across all methods.
  const [cleaningHistory, setCleaningHistory] = useState<CleaningHistoryItem[]>([]);
  const [cleaningHistoryLoading, setCleaningHistoryLoading] = useState(false);
  const [cleaningHistoryApplyingId, setCleaningHistoryApplyingId] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState("");
  // Unsaved-changes guard: a JSON snapshot of icons/shapes/texts captured at the
  // last successful save (and at initial load). Comparing the current state to it
  // tells us whether leaving the editor would discard work.
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [pendingNav, setPendingNav] = useState(false);
  // ── Studio sheet mode ──────────────────────────────────────────────────────
  // "plan" keeps the bare plan on screen, the way the editor has always worked;
  // a template shows the printed sheet around it, editable in place.
  const [keepPlanRatio, setKeepPlanRatio] = useState<boolean>(true);
  const [selectedCleanTargetId, setSelectedCleanTargetId] = useState<string>(MAIN_PLAN_ID);
  const planOverlayInputRef = useRef<HTMLInputElement>(null);
  const [importingOverlays, setImportingOverlays] = useState(false);
  const [sheetReframeMode, setSheetReframeMode] = useState(false);
  const [sheetLogoImages, setSheetLogoImages] = useState<Record<string, HTMLImageElement | null>>({});
  const [sheetLegendImages, setSheetLegendImages] = useState<Record<string, HTMLImageElement>>({});
  const [sheetExporting, setSheetExporting] = useState(false);
  const [storedSheetTemplateVersions, setStoredSheetTemplateVersions] = useState<StoredSheetTemplateVersion[]>([]);
  const [activeSheetTemplateVersionId, setActiveSheetTemplateVersionId] = useState("");
  const pendingTemplateServerSyncRef = useRef<StoredSheetTemplateVersion[] | null>(null);
  const templateServerSyncRunningRef = useRef(false);

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportSaveConfirmOpen, setExportSaveConfirmOpen] = useState(false);
  const [pendingExportAction, setPendingExportAction] = useState<(() => Promise<void>) | null>(null);
  const [exportFormat] = useState<"png" | "pdf">("pdf");
  const [exportTheme, setExportTheme] = useState<ExportTheme>("modern");
  const [exportOfficialFond, setExportOfficialFond] = useState<ExportOfficialFondKey>("none");
  const [exportUseCustomColors, setExportUseCustomColors] = useState(false);
  const [exportCustomColors, setExportCustomColors] = useState<Record<ExportCustomColorKey, string>>(DEFAULT_EXPORT_CUSTOM_COLORS);
  const [exportPaperFormat, setExportPaperFormat] = useState<ExportPaperFormat>("a4");
  const [exporting, setExporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [exportPreviewUrl, setExportPreviewUrl] = useState("");
  const [exportAdjustmentPreviewUrl, setExportAdjustmentPreviewUrl] = useState("");
  const [exportAdjustmentPreviewLoading, setExportAdjustmentPreviewLoading] = useState(false);
  const [exportPlanTitle, setExportPlanTitle] = useState("PLAN D'ÉVACUATION");
  const [exportSiteName, setExportSiteName] = useState("");
  const [exportSafetyText, setExportSafetyText] = useState(
    "INCENDIE\n- Appuyez sur le bouton d'alarme incendie.\n- Appelez les secours et indiquez votre position.\n- Fermez portes et fenêtres sans vous mettre en danger.\n\nEVACUATION\n- Suivez le cheminement indiqué.\n- N'utilisez pas les ascenseurs.\n- Rejoignez le point de rassemblement."
  );
  const [exportInterventionText, setExportInterventionText] = useState(
    "Equipe d'intervention\nResponsable :\nTéléphone :\nPoint de rassemblement :\nMise à jour :"
  );
  const [exportSafetyPanelHeight, setExportSafetyPanelHeight] = useState(400);
  const [exportSafetyFontSize, setExportSafetyFontSize] = useState(17);
  const [exportInterventionPanelHeight, setExportInterventionPanelHeight] = useState(521);
  const [exportInterventionFontSize, setExportInterventionFontSize] = useState(17);
  const [exportLegendPanelHeight, setExportLegendPanelHeight] = useState(943);
  const [exportLegendFontSize, setExportLegendFontSize] = useState(16);
  const [exportPlanScale, setExportPlanScale] = useState(100);
  const [exportPlanAreaScale, setExportPlanAreaScale] = useState(100);
  const [exportPlanRotation, setExportPlanRotation] = useState(0);
  const [exportPlanOffsetX, setExportPlanOffsetX] = useState(0);
  const [exportPlanOffsetY, setExportPlanOffsetY] = useState(0);
  const [exportDisablePlanClipping, setExportDisablePlanClipping] = useState(false);
  // Logos overlaid on the export sheet: the client's brand (left of the header)
  // and our studio's brand (right of the header). Uploaded files are stored as
  // data URLs; the built-in PREV' INC & CIE logo uses its application URL.
  const [exportClientLogo, setExportClientLogo] = useState("");
  const [exportStudioLogo, setExportStudioLogo] = useState(DEFAULT_STUDIO_LOGO);
  const [logoSettingsError, setLogoSettingsError] = useState("");
  // Size and position of each logo, relative to the slot the theme gives it:
  // 100% and (0, 0) is the automatic placement, so a sheet that already looks
  // right is unaffected until one of these is touched.
  const [exportClientLogoScale, setExportClientLogoScale] = useState(100);
  const [exportClientLogoOffsetX, setExportClientLogoOffsetX] = useState(0);
  const [exportClientLogoOffsetY, setExportClientLogoOffsetY] = useState(0);
  const [exportStudioLogoScale, setExportStudioLogoScale] = useState(100);
  const [exportStudioLogoOffsetX, setExportStudioLogoOffsetX] = useState(0);
  const [exportStudioLogoOffsetY, setExportStudioLogoOffsetY] = useState(0);
  // Section visibility: each block can be hidden independently. When a whole
  // column is empty the plan widens to reclaim the space.
  const [exportShowSafety, setExportShowSafety] = useState(true);
  const [exportShowIntervention, setExportShowIntervention] = useState(true);
  const [exportShowLegend, setExportShowLegend] = useState(true);
  // NF X08-070 copy. Every string printed on the normative sheet is editable —
  // the block titles included, since the same layout is used for variants that
  // rename them (« SECOURS », « CONDUITE A TENIR »…).
  const [exportNfConformity, setExportNfConformity] = useState<string>(NF_DEFAULTS.conformity);
  const [exportNfFireTitle, setExportNfFireTitle] = useState<string>(NF_DEFAULTS.fireTitle);
  const [exportNfFireIntro, setExportNfFireIntro] = useState<string>(NF_DEFAULTS.fireIntro);
  const [exportNfFireNumbers, setExportNfFireNumbers] = useState<string>(NF_DEFAULTS.fireNumbers);
  const [exportNfEmergencyNote, setExportNfEmergencyNote] = useState<string>(NF_DEFAULTS.emergencyNote);
  const [exportNfEvacuationTitle, setExportNfEvacuationTitle] = useState<string>(NF_DEFAULTS.evacuationTitle);
  const [exportNfEvacuationText, setExportNfEvacuationText] = useState<string>(NF_DEFAULTS.evacuationText);
  const [exportNfMedicalTitle, setExportNfMedicalTitle] = useState<string>(NF_DEFAULTS.medicalTitle);
  const [exportNfMedicalNumbers, setExportNfMedicalNumbers] = useState<string>(NF_DEFAULTS.medicalNumbers);
  const [exportNfDeafText, setExportNfDeafText] = useState<string>(NF_DEFAULTS.deafText);
  const [exportNfPreventionTitle, setExportNfPreventionTitle] = useState<string>(NF_DEFAULTS.preventionTitle);
  const [exportNfPreventionText, setExportNfPreventionText] = useState<string>(NF_DEFAULTS.preventionText);
  const [exportNfLegendTitle, setExportNfLegendTitle] = useState<string>(NF_DEFAULTS.legendTitle);
  const [exportNfBodyFontSize, setExportNfBodyFontSize] = useState(10);
  // Level tag ("REZ-DE-CHAUSSEE", "NIVEAU -1"…) used by the intervention and
  // evacuation sheets. Empty falls back to the plan's own floor name.
  const [exportLevelLabel, setExportLevelLabel] = useState("");
  // "Plan d'évacuation" copy.
  const [exportEvacConformity, setExportEvacConformity] = useState<string>(EVAC_DEFAULTS.conformity);
  const [exportEvacFireTitle, setExportEvacFireTitle] = useState<string>(EVAC_DEFAULTS.fireTitle);
  const [exportEvacFireText, setExportEvacFireText] = useState<string>(EVAC_DEFAULTS.fireText);
  const [exportEvacCallText, setExportEvacCallText] = useState<string>(EVAC_DEFAULTS.callText);
  const [exportEvacTitle, setExportEvacTitle] = useState<string>(EVAC_DEFAULTS.evacuationTitle);
  const [exportEvacText, setExportEvacText] = useState<string>(EVAC_DEFAULTS.evacuationText);
  const [exportEvacPreventionTitle, setExportEvacPreventionTitle] = useState<string>(EVAC_DEFAULTS.preventionTitle);
  const [exportEvacPreventionText, setExportEvacPreventionText] = useState<string>(EVAC_DEFAULTS.preventionText);
  const [exportEvacAssemblyLabel, setExportEvacAssemblyLabel] = useState<string>(EVAC_DEFAULTS.assemblyLabel);
  const [exportEvacBodyFontSize, setExportEvacBodyFontSize] = useState(9);
  const iconDefinitions = useMemo(
    () => ({ ...SAFETY_ICONS, ...availableIconDefinitions }),
    [availableIconDefinitions]
  );
  const LEFT_DOCK_WIDTH = 208;
  const RIGHT_DOCK_WIDTH = 224;
  const leftDockWidth = leftDockOpen ? LEFT_DOCK_WIDTH : 0;
  const rightDockWidth = rightDockOpen ? RIGHT_DOCK_WIDTH : 0;

  const getPlanAuthHeaders = (): Record<string, string> => {
    const authToken = token || (typeof window !== "undefined" ? localStorage.getItem("token") : null);
    return authToken ? { Authorization: `Bearer ${authToken}` } : {};
  };

  const handleAddSvgPictogram = async ({ name, svg }: { name: string; svg: string }) => {
    const response = await fetch(buildApiUrl("/api/plans/pictograms/"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getPlanAuthHeaders(),
      },
      body: JSON.stringify({ name, svg }),
    });

    let payload: (PlanPictogramBackend & { error?: string }) | null = null;
    try {
      payload = await response.json();
    } catch {
      // Keep the user-facing fallback below when the server did not return JSON.
    }

    if (!response.ok || !payload?.type || !payload.url) {
      throw new Error(payload?.error || "Le pictogramme SVG n’a pas pu être ajouté.");
    }

    const definition: SafetyIconDefinition = {
      type: payload.type,
      label: payload.label,
      fileName: payload.file_name,
      imageUrl: payload.url,
      color: inferPictogramColor(payload.type, payload.label),
      deletable: Boolean(payload.deletable),
    };
    setAvailableIconDefinitions((current) => ({
      ...current,
      [definition.type]: definition,
    }));
  };

  const handleDeleteSvgPictogram = async (definition: SafetyIconDefinition) => {
    if (!definition.fileName) {
      throw new Error("Le fichier associé à ce pictogramme est introuvable.");
    }

    const query = new URLSearchParams({ file_name: definition.fileName });
    const response = await fetch(buildApiUrl(`/api/plans/pictograms/?${query.toString()}`), {
      method: "DELETE",
      headers: getPlanAuthHeaders(),
    });

    if (!response.ok) {
      let message = "Le pictogramme SVG n’a pas pu être supprimé.";
      try {
        const payload = await response.json() as { error?: string };
        message = payload.error || message;
      } catch {
        // Keep the fallback when the server did not return JSON.
      }
      throw new Error(message);
    }

    setAvailableIconDefinitions((current) => {
      const updated = { ...current };
      delete updated[definition.type];
      return updated;
    });
    if (icons.some((icon) => icon.tempId === selectedIconId && icon.icon_type === definition.type)) {
      setSelectedIconId(null);
    }
    setIcons((current) => current.filter((icon) => icon.icon_type !== definition.type));
    if (placementIconType === definition.type) {
      setPlacementIconType(null);
    }
  };

  const handleRenameSvgPictogram = async (definition: SafetyIconDefinition, name: string) => {
    if (!definition.fileName) {
      throw new Error("Le fichier associé à ce pictogramme est introuvable.");
    }

    const response = await fetch(buildApiUrl("/api/plans/pictograms/"), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...getPlanAuthHeaders(),
      },
      body: JSON.stringify({ file_name: definition.fileName, name }),
    });

    let payload: (PlanPictogramBackend & { error?: string }) | null = null;
    try {
      payload = await response.json();
    } catch {
      // Keep the user-facing fallback below when the server did not return JSON.
    }
    if (!response.ok || !payload?.type || !payload.url) {
      throw new Error(payload?.error || "Le pictogramme SVG n’a pas pu être renommé.");
    }

    const renamedDefinition: SafetyIconDefinition = {
      type: payload.type,
      label: payload.label,
      fileName: payload.file_name,
      imageUrl: payload.url,
      color: inferPictogramColor(payload.type, payload.label),
      deletable: Boolean(payload.deletable),
    };
    setAvailableIconDefinitions((current) => {
      const updated = { ...current };
      delete updated[definition.type];
      updated[renamedDefinition.type] = renamedDefinition;
      return updated;
    });
    setIcons((current) => current.map((icon) => (
      icon.icon_type === definition.type
        ? { ...icon, icon_type: renamedDefinition.type }
        : icon
    )));
    if (placementIconType === definition.type) {
      setPlacementIconType(renamedDefinition.type);
    }
  };

  const revokeObjectUrlSafely = (url: string) => {
    if (url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  };

  const normalizeHexColor = (value: string, fallback: string) => {
    const trimmed = value.trim();
    const match = trimmed.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (!match) return fallback;

    const hex = match[1];
    if (hex.length === 3) {
      return `#${hex.split("").map((char) => char + char).join("")}`.toLowerCase();
    }
    return `#${hex}`.toLowerCase();
  };

  const isValidHexColor = (value: string) => /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());

  const getExportPalette = (): ExportPalette => {
    const base = (EXPORT_THEME_PALETTES[exportTheme as keyof typeof EXPORT_THEME_PALETTES] || EXPORT_THEME_PALETTES.modern) as ExportPalette;
    if (!exportUseCustomColors) return base;

    return {
      ...base,
      headerStart: normalizeHexColor(exportCustomColors.headerStart, base.headerStart),
      headerEnd: normalizeHexColor(exportCustomColors.headerEnd, base.headerEnd),
      accent: normalizeHexColor(exportCustomColors.accent, base.accent),
      safety: normalizeHexColor(exportCustomColors.safety, base.safety),
      intervention: normalizeHexColor(exportCustomColors.intervention, base.intervention),
      legend: normalizeHexColor(exportCustomColors.legend, base.legend),
      sheet: normalizeHexColor(exportCustomColors.sheet, base.sheet),
      text: normalizeHexColor(exportCustomColors.text, base.text),
    };
  };

  const updateExportCustomColor = (key: ExportCustomColorKey, value: string) => {
    setExportCustomColors((current) => ({ ...current, [key]: value }));
  };

  const getThemeCustomColors = (theme: ExportTheme = exportTheme) => {
    const base = (EXPORT_THEME_PALETTES[theme as keyof typeof EXPORT_THEME_PALETTES] || EXPORT_THEME_PALETTES.modern) as ExportPalette;
    return EXPORT_CUSTOM_COLOR_FIELDS.reduce<Record<ExportCustomColorKey, string>>((colors, field) => {
      colors[field.key] = base[field.key] || DEFAULT_EXPORT_CUSTOM_COLORS[field.key];
      return colors;
    }, { ...DEFAULT_EXPORT_CUSTOM_COLORS });
  };

  /** Colour swatches to offer for the active theme, named the way it uses them. */
  const exportColorFields = EXPORT_THEME_COLOR_FIELDS[exportTheme] ?? EXPORT_CUSTOM_COLOR_FIELDS;
  // The two sheets that lay their own blocks out rather than using the generic
  // consignes/intervention/legend panels.
  const isNfTheme = exportTheme === "nfx08070";
  const isInterventionTheme = exportTheme === "intervention";
  const isEvacuationTheme = exportTheme === "evacuation";
  const usesAddressBlock = isNfTheme || isInterventionTheme || isEvacuationTheme;
  const usesLevelTag = isInterventionTheme || isEvacuationTheme;

  const resetEvacTexts = () => {
    setExportEvacConformity(EVAC_DEFAULTS.conformity);
    setExportEvacFireTitle(EVAC_DEFAULTS.fireTitle);
    setExportEvacFireText(EVAC_DEFAULTS.fireText);
    setExportEvacCallText(EVAC_DEFAULTS.callText);
    setExportEvacTitle(EVAC_DEFAULTS.evacuationTitle);
    setExportEvacText(EVAC_DEFAULTS.evacuationText);
    setExportEvacPreventionTitle(EVAC_DEFAULTS.preventionTitle);
    setExportEvacPreventionText(EVAC_DEFAULTS.preventionText);
    setExportEvacAssemblyLabel(EVAC_DEFAULTS.assemblyLabel);
    setExportEvacBodyFontSize(9);
  };

  const resetNfTexts = () => {
    setExportNfConformity(NF_DEFAULTS.conformity);
    setExportNfFireTitle(NF_DEFAULTS.fireTitle);
    setExportNfFireIntro(NF_DEFAULTS.fireIntro);
    setExportNfFireNumbers(NF_DEFAULTS.fireNumbers);
    setExportNfEmergencyNote(NF_DEFAULTS.emergencyNote);
    setExportNfEvacuationTitle(NF_DEFAULTS.evacuationTitle);
    setExportNfEvacuationText(NF_DEFAULTS.evacuationText);
    setExportNfMedicalTitle(NF_DEFAULTS.medicalTitle);
    setExportNfMedicalNumbers(NF_DEFAULTS.medicalNumbers);
    setExportNfDeafText(NF_DEFAULTS.deafText);
    setExportNfPreventionTitle(NF_DEFAULTS.preventionTitle);
    setExportNfPreventionText(NF_DEFAULTS.preventionText);
    setExportNfLegendTitle(NF_DEFAULTS.legendTitle);
    setExportNfBodyFontSize(10);
  };

  useEffect(() => {
    const fetchPlan = async () => {
      const headers = getPlanAuthHeaders();
      if (!("Authorization" in headers)) {
        if (!authLoading) router.push("/login");
        return;
      }

      try {
        const res = await fetch(buildApiUrl(`/api/plans/${id}/`), {
          headers,
          cache: "no-store",
        });
        if (res.ok) {
          const data: EvacuationPlanBackend = await res.json();
          setPlan(data);
          // Convert database icons to CanvasIcon type
          const canvasIcons: CanvasIcon[] = data.icons.map((icon) => ({
            id: icon.id,
            tempId: `icon-${icon.id}-${Math.random().toString(36).substr(2, 9)}`,
            icon_type: icon.icon_type,
            x: icon.x,
            y: icon.y,
            width: icon.width,
            height: icon.height,
            rotation: icon.rotation,
            label: icon.label || "",
            anchor_x: icon.anchor_x ?? null,
            anchor_y: icon.anchor_y ?? null,
            leader_width: icon.leader_width ?? 2,
            framed: icon.framed ?? false,
            flip_x: icon.flip_x ?? false,
            color: icon.color ?? "",
            flip_y: icon.flip_y ?? false,
            locked: icon.locked ?? false,
            visible: icon.visible ?? true,
            z_index: icon.z_index ?? 300,
            group_id: icon.group_id || "",
            object_group_id: icon.object_group_id || "",
          }));
          setIcons(canvasIcons);

          const canvasShapes: CanvasShape[] = (data.shapes || []).map((shape) => ({
            id: shape.id,
            tempId: `shape-${shape.id}-${Math.random().toString(36).slice(2, 11)}`,
            shape_type: shape.shape_type,
            x: shape.x,
            y: shape.y,
            width: shape.width,
            height: shape.height,
            rotation: shape.rotation,
            stroke_width: shape.stroke_width,
            color: shape.color,
            fill_color: shape.fill_color ?? null,
            fill_opacity: shape.fill_opacity ?? undefined,
            tension: shape.tension ?? undefined,
            control_points: shape.control_points ?? undefined,
            points: shape.points || undefined,
            locked: shape.locked ?? false,
            visible: shape.visible ?? true,
            z_index: shape.z_index ?? 200,
            group_id: shape.group_id || "",
            object_group_id: shape.object_group_id || "",
          }));
          setShapes(canvasShapes);

          const canvasTexts: CanvasText[] = (data.texts || []).map((t) => ({
            id: t.id,
            tempId: `text-${t.id}-${Math.random().toString(36).slice(2, 11)}`,
            text: t.text,
            x: t.x,
            y: t.y,
            font_size: t.font_size,
            font_family: t.font_family,
            color: t.color,
            bold: t.bold,
            italic: t.italic,
            background_color: t.background_color ?? null,
            rotation: t.rotation,
            locked: t.locked ?? false,
            visible: t.visible ?? true,
            z_index: t.z_index ?? 400,
            group_id: t.group_id || "",
            object_group_id: t.object_group_id || "",
          }));
          setTexts(canvasTexts);

          const canvasOverlays: CanvasPlanOverlay[] = (data.overlays || []).map((overlay) => ({
            tempId: `plan-overlay-${overlay.id}`,
            serverId: overlay.id,
            url: overlay.image_url,
            x: overlay.x,
            y: overlay.y,
            width: overlay.width,
            height: overlay.height,
            rotation: overlay.rotation,
            label: overlay.label || "",
            locked: overlay.locked ?? false,
            visible: overlay.visible ?? true,
            z_index: overlay.z_index ?? 100,
            group_id: overlay.group_id || "",
            imageChanged: false,
            isOriginal: overlay.is_original ?? true,
            canRevertOriginal: overlay.can_revert_original ?? false,
          }));
          setPlanOverlays(canvasOverlays);

          const loadedMainPlanTransform: CanvasPlanTransform = {
            x: data.main_plan_x || 0,
            y: data.main_plan_y || 0,
            width: data.main_plan_width || 0,
            height: data.main_plan_height || 0,
          };
          const loadedWatermark = normalizeWatermarkConfig(data.watermark_config);
          const studioLogo = getStoredStudioLogo(loadedWatermark.creator_logo || DEFAULT_STUDIO_LOGO);
          const loadedWatermarkWithLogos = {
            ...loadedWatermark,
            creator_logo: studioLogo,
          };
          const loadedMainPlanVisible = (data.main_plan_visible ?? true)
            || isAccidentallyHiddenFreshImport(data);
          setMainPlanTransform(loadedMainPlanTransform);
          setMainPlanLocked(Boolean(data.main_plan_locked));
          setMainPlanVisible(loadedMainPlanVisible);
          setMainPlanZIndex(data.main_plan_z_index ?? 0);
          setMainPlanGroupId(data.main_plan_group_id || "");
          setMainPlanGroupingEnabled(Boolean(data.main_plan_grouping_enabled));
          setWatermarkConfig(loadedWatermarkWithLogos);
          setWatermarkDraft(loadedWatermarkWithLogos);
          setExportClientLogo(loadedWatermark.client_logo || "");
          setExportStudioLogo(studioLogo);

          // Baseline for the unsaved-changes guard: the freshly loaded state.
          // The very same fields as buildEditableSnapshot, or the editor would
          // report unsaved changes before the user has touched anything.
          setSavedSnapshot(JSON.stringify({
            icons: canvasIcons.map(({ icon_type, x, y, width, height, rotation, label, anchor_x, anchor_y, leader_width, framed, flip_x, flip_y, locked, visible, z_index, group_id, object_group_id, color }) => ({
              icon_type, x, y, width, height, rotation, label, anchor_x, anchor_y, leader_width, framed, flip_x, flip_y, locked, visible, z_index, group_id, object_group_id, color,
            })),
            shapes: canvasShapes.map(({ shape_type, x, y, width, height, rotation, stroke_width, color, fill_color, fill_opacity, tension, control_points, points, locked, visible, z_index, group_id, object_group_id }) => ({
              shape_type, x, y, width, height, rotation, stroke_width, color, fill_color, fill_opacity, tension, control_points, points, locked, visible, z_index, group_id, object_group_id,
            })),
            texts: canvasTexts.map(({ text, x, y, font_size, font_family, color, bold, italic, background_color, rotation, locked, visible, z_index, group_id, object_group_id }) => ({
              text, x, y, font_size, font_family, color, bold, italic, background_color, rotation, locked, visible, z_index, group_id, object_group_id,
            })),
            overlays: canvasOverlays.map(({ url, x, y, width, height, rotation, label, locked, visible, z_index, group_id }) => ({
              url, x, y, width, height, rotation, label, locked, visible, z_index, group_id,
            })),
            mainPlanTransform: loadedMainPlanTransform,
            mainPlanLocked: Boolean(data.main_plan_locked),
            mainPlanVisible: loadedMainPlanVisible,
            mainPlanZIndex: data.main_plan_z_index ?? 0,
            mainPlanGroupId: data.main_plan_group_id || "",
            mainPlanGroupingEnabled: Boolean(data.main_plan_grouping_enabled),
            watermark: loadedWatermarkWithLogos,
          }));
        } else if (res.status === 401 || res.status === 403) {
          router.push("/login");
        } else {
          router.push("/evacuation-plans");
        }
      } catch (err) {
        console.error("Failed to fetch plan:", err);
      } finally {
        setLoading(false);
      }
    };
    if (!authLoading) void fetchPlan();
  }, [id, authLoading, token]);

  useEffect(() => {
    const fetchPictograms = async () => {
      const headers = getPlanAuthHeaders();
      if (!("Authorization" in headers)) return;

      try {
        const res = await fetch(buildApiUrl(`/api/plans/pictograms/`), {
          headers,
          cache: "no-store",
        });
        if (!res.ok) return;

        const data: PlanPictogramBackend[] = await res.json();
        if (!data.length) return;

        const definitions = data.reduce<Record<string, SafetyIconDefinition>>((acc, pictogram) => {
          acc[pictogram.type] = {
            type: pictogram.type,
            label: pictogram.label,
            fileName: pictogram.file_name,
            imageUrl: pictogram.url,
            // Infer the safety-sign colour from the pictogram name so the leader
            // line and anchor dot match the equipment's category (red for fire
            // fighting, green for escape, …) instead of a single flat colour.
            color: inferPictogramColor(pictogram.type, pictogram.label),
            deletable: Boolean(pictogram.deletable),
          };
          return acc;
        }, {});

        setAvailableIconDefinitions(definitions);
      } catch (err) {
        console.error("Failed to fetch plan pictograms:", err);
      }
    };

    if (!authLoading) void fetchPictograms();
  }, [authLoading, token]);

  useEffect(() => {
    return () => {
      if (exportPreviewUrl) {
        revokeObjectUrlSafely(exportPreviewUrl);
      }
    };
  }, [exportPreviewUrl]);

  // Warn the user through the browser's native dialog when they close the tab
  // or navigate away while there are unsaved edits. The latest state is read
  // inside the handler so the listener never goes stale.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const current = buildEditableSnapshot();
      if (current !== savedSnapshot) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [icons, shapes, texts, planOverlays, mainPlanTransform, mainPlanLocked, mainPlanGroupId, mainPlanGroupingEnabled, watermarkConfig, savedSnapshot]);

  useEffect(() => {
    if (!placementIconType) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPlacementIconType(null);
        setPlacementText(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [placementIconType]);

  // The editor owns the whole viewport: forbid the document itself from scrolling
  // while it is mounted, and restore the previous values on the way out.
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const previous = {
      rootOverflow: root.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyMargin: body.style.margin
    };

    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.margin = "0";

    return () => {
      root.style.overflow = previous.rootOverflow;
      body.style.overflow = previous.bodyOverflow;
      body.style.margin = previous.bodyMargin;
    };
  }, []);

  // Tool shortcuts: V = selection, H = navigation, Space held = temporary navigation.
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      return (
        element.tagName === "INPUT" ||
        element.tagName === "TEXTAREA" ||
        element.tagName === "SELECT" ||
        element.isContentEditable
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.code === "Space") {
        event.preventDefault();
        if (spaceHeldRef.current) return;
        spaceHeldRef.current = true;
        setMode((current) => {
          modeBeforeSpaceRef.current = current;
          return "pan";
        });
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "v") setMode("select");
      else if (key === "h") setMode("pan");
      else if (key === "e") {
        setShapeTool(null);
        setMode("erase");
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !spaceHeldRef.current) return;
      spaceHeldRef.current = false;
      setMode(modeBeforeSpaceRef.current);
    };

    // Releasing the key outside the window would otherwise strand us in pan mode.
    const handleBlur = () => {
      if (!spaceHeldRef.current) return;
      spaceHeldRef.current = false;
      setMode(modeBeforeSpaceRef.current);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    if (!cleanModalOpen) return;

    void fetchCleaningHistory();
    if (cleanMethod !== "grok") return;

    let cancelled = false;
    const fetchXaiSettings = async () => {
      setXaiSettingsLoading(true);
      try {
        const res = await fetch(buildApiUrl(`/api/xai-settings/`), {
          headers: getPlanAuthHeaders(),
          cache: "no-store",
        });
        if (!res.ok) return;

        const data: { has_api_key: boolean; updated_at: string | null } = await res.json();
        if (cancelled) return;
        setXaiHasSavedKey(Boolean(data.has_api_key));
        setXaiSettingsUpdatedAt(data.updated_at);
      } catch (err) {
        console.error("Failed to fetch xAI settings:", err);
      } finally {
        if (!cancelled) setXaiSettingsLoading(false);
      }
    };

    void fetchXaiSettings();
    return () => {
      cancelled = true;
    };
  }, [cleanModalOpen, cleanMethod, selectedCleanTargetId, token]);

  const handleAddIcon = (type: IconType) => {
    setPlacementIconType(type);
    setSelectedIconId(null);
    setMode("select");
  };

  const handlePlaceIcon = (type: IconType, x: number, y: number) => {
    const newIcon: CanvasIcon = {
      tempId: `icon-new-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      icon_type: type,
      x,
      y,
      width: defaultIconSize.width,
      height: defaultIconSize.height,
      rotation: 0,
      label: "",
      visible: true,
      z_index: getNextLayerZIndex(),
    };
    setIcons((currentIcons) => [...currentIcons, newIcon]);
    setSelectedIconId(newIcon.tempId);
    setPlacementIconType(null);
  };

  const handleIconsChange = (updatedIcons: CanvasIcon[]) => {
    setIcons(updatedIcons);
    if (!selectedIconId) return;

    const selected = updatedIcons.find((icon) => icon.tempId === selectedIconId);
    if (!selected) return;

    setDefaultIconSize({
      width: Math.max(15, selected.width),
      height: Math.max(15, selected.height),
    });
  };

  // ─── Text annotations ────────────────────────────────────────────────
  const handleAddText = () => {
    setPlacementText(true);
    setPlacementIconType(null);
    setShapeTool(null);
    setSelectedIconId(null);
    setSelectedShapeId(null);
    setSelectedTextId(null);
    setMode("select");
  };

  const handlePlaceText = (x: number, y: number) => {
    const newText: CanvasText = {
      tempId: `text-new-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      text: "Texte",
      x,
      y,
      font_size: 24,
      font_family: "Arial",
      color: "#000000",
      bold: false,
      italic: false,
      background_color: null,
      rotation: 0,
      visible: true,
      z_index: getNextLayerZIndex(),
    };
    setTexts((current) => [...current, newText]);
    setSelectedTextId(newText.tempId);
    setSelectedIconId(null);
    setSelectedShapeId(null);
    setPlacementText(false);
  };

  const handleTextsChange = (updated: CanvasText[]) => {
    setTexts(updated);
  };

  const handleUpdateSelectedText = (field: keyof CanvasText, value: unknown) => {
    if (!selectedTextId) return;
    setTexts((current) =>
      current.map((t) => (t.tempId === selectedTextId ? { ...t, [field]: value } : t))
    );
  };

  const handleDeleteSelectedText = () => {
    if (!selectedTextId) return;
    if (texts.find((text) => text.tempId === selectedTextId)?.locked) return;
    setTexts((current) => current.filter((t) => t.tempId !== selectedTextId));
    setSelectedTextId(null);
  };
  // ─────────────────────────────────────────────────────────────────────

  // Serialise the editable layers (without volatile client-only fields like
  // tempId/id) so a deep-equality check detects any real change.
  const buildEditableSnapshot = () =>
    JSON.stringify({
      icons: icons.map(({ icon_type, x, y, width, height, rotation, label, anchor_x, anchor_y, leader_width, framed, flip_x, flip_y, locked, visible, z_index, group_id, object_group_id, color }) => ({
        icon_type, x, y, width, height, rotation, label, anchor_x, anchor_y, leader_width, framed, flip_x, flip_y, locked, visible, z_index, group_id, object_group_id, color,
      })),
      shapes: shapes.map(({ shape_type, x, y, width, height, rotation, stroke_width, color, fill_color, fill_opacity, tension, control_points, points, locked, visible, z_index, group_id, object_group_id }) => ({
        shape_type, x, y, width, height, rotation, stroke_width, color, fill_color, fill_opacity, tension, control_points, points, locked, visible, z_index, group_id, object_group_id,
      })),
      texts: texts.map(({ text, x, y, font_size, font_family, color, bold, italic, background_color, rotation, locked, visible, z_index, group_id, object_group_id }) => ({
        text, x, y, font_size, font_family, color, bold, italic, background_color, rotation, locked, visible, z_index, group_id, object_group_id,
      })),
      overlays: planOverlays.map(({ url, x, y, width, height, rotation, label, locked, visible, z_index, group_id }) => ({
        url, x, y, width, height, rotation, label, locked, visible, z_index, group_id,
      })),
      mainPlanTransform,
      mainPlanLocked,
      mainPlanVisible,
      mainPlanZIndex,
      mainPlanGroupId,
      mainPlanGroupingEnabled,
      watermark: watermarkConfig,
    });

  const hasUnsavedChanges = () => buildEditableSnapshot() !== savedSnapshot;

  /**
   * Draws an image onto a canvas, fitted inside what the browser can actually
   * hold. Past roughly 16k pixels a side — or a few tens of megapixels in total
   * across the page — a canvas comes back *blank* instead of failing, which is
   * how a big scanned plan used to come back as an empty white sheet.
   */
  const drawImageToCanvas = (img: HTMLImageElement, background?: string) => {
    const naturalWidth = img.naturalWidth || img.width;
    const naturalHeight = img.naturalHeight || img.height;
    if (!naturalWidth || !naturalHeight) throw new Error("Image vide");

    const scale = Math.min(
      1,
      MAX_CANVAS_SIDE / Math.max(naturalWidth, naturalHeight),
      Math.sqrt(MAX_CANVAS_PIXELS / (naturalWidth * naturalHeight))
    );

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(naturalHeight * scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Contexte canvas indisponible");

    if (background) {
      // Flatten transparency: a lasso-cut plan is transparent outside its
      // outline, and OpenCV reads those pixels as black without this.
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  };

  /** Frees the canvas memory at once instead of waiting for the collector. */
  const releaseCanvas = (canvas: HTMLCanvasElement) => {
    canvas.width = 0;
    canvas.height = 0;
  };

  const loadImage = (source: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image illisible"));
      img.src = source;
    });

  /**
   * Any image the browser can load -> a base64 data URL the API accepts.
   * `background` flattens transparency; without it the alpha channel is kept.
   */
  const toDataUrl = async (source: string, background?: string): Promise<string> => {
    if (source.startsWith("data:") && !background) return source;

    const img = await loadImage(source);
    const canvas = drawImageToCanvas(img, background);
    try {
      return canvas.toDataURL("image/png");
    } finally {
      releaseCanvas(canvas);
    }
  };

  const shapesPayload = (list: CanvasShape[]) =>
    list.map((shape) => ({
      shape_type: shape.shape_type,
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      rotation: shape.rotation,
      stroke_width: shape.stroke_width,
      color: shape.color,
      fill_color: shape.fill_color ?? null,
      fill_opacity: shape.fill_opacity ?? null,
      tension: shape.tension ?? null,
      control_points: shape.control_points ?? {},
      points: shape.points || null,
      locked: shape.locked ?? false,
      visible: shape.visible ?? true,
      z_index: shape.z_index ?? 200,
      group_id: shape.group_id || "",
      object_group_id: shape.object_group_id || "",
    }));

  const textsPayload = (list: CanvasText[]) =>
    list.map((t) => ({
      text: t.text,
      x: t.x,
      y: t.y,
      font_size: t.font_size,
      font_family: t.font_family,
      color: t.color,
      bold: t.bold,
      italic: t.italic,
      background_color: t.background_color,
      rotation: t.rotation,
      locked: t.locked ?? false,
      visible: t.visible ?? true,
      z_index: t.z_index ?? 400,
      group_id: t.group_id || "",
      object_group_id: t.object_group_id || "",
    }));

  const iconsPayload = (list: CanvasIcon[]) =>
    list.map((icon) => ({
      icon_type: icon.icon_type,
      x: icon.x,
      y: icon.y,
      width: icon.width,
      height: icon.height,
      rotation: icon.rotation,
      label: icon.label || "",
      anchor_x: icon.anchor_x ?? null,
      anchor_y: icon.anchor_y ?? null,
      leader_width: icon.leader_width ?? 2,
      framed: icon.framed ?? false,
      flip_x: icon.flip_x ?? false,
      flip_y: icon.flip_y ?? false,
      color: icon.color ?? "",
      locked: icon.locked ?? false,
      visible: icon.visible ?? true,
      z_index: icon.z_index ?? 300,
      group_id: icon.group_id || "",
      object_group_id: icon.object_group_id || "",
    }));

  /**
   * Secondary plans already stored travel as their id, so an unchanged plan is
   * not re-uploaded — only the ones that were imported, cropped or cleaned
   * carry their pixels.
   */
  const overlaysPayload = async (list: CanvasPlanOverlay[]) =>
    Promise.all(
      list.map(async (overlay) => {
        const geometry = {
          x: overlay.x,
          y: overlay.y,
          width: overlay.width,
          height: overlay.height,
          rotation: overlay.rotation,
          label: overlay.label || "",
          locked: overlay.locked ?? false,
          visible: overlay.visible ?? true,
          z_index: overlay.z_index ?? 100,
          group_id: overlay.group_id || "",
        };
        if (overlay.serverId && !overlay.imageChanged) {
          return { ...geometry, image_ref: overlay.serverId };
        }
        return {
          ...geometry,
          overlay_id: overlay.serverId,
          image_data: await toDataUrl(overlay.url),
        };
      })
    );

  /**
   * A failed call is not always JSON: Django answers an oversized or malformed
   * request with an HTML page, and swallowing that leaves the user with a
   * message that says nothing. Report whatever the server actually said.
   */
  const describeApiError = async (res: Response) => {
    const body = await res.text().catch(() => "");
    try {
      const parsed = JSON.parse(body);
      const detail = parsed?.error || parsed?.detail;
      if (detail) return String(detail);
    } catch {
      // not JSON — fall through to the raw text below
    }
    const stripped = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return stripped ? `${res.status} — ${stripped.slice(0, 200)}` : `HTTP ${res.status}`;
  };

  const postJson = (path: string, payload: unknown) =>
    fetch(buildApiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getPlanAuthHeaders() },
      body: JSON.stringify(payload),
    });

  /** Pushes the annotation layers to the API. Returns false if any call failed. */
  /**
   * A lasso cut of the main plan replaces the background for good, exactly like
   * the eraser's retouches: keeping it in the browser only would lose it at the
   * next reload. The pictograms are shifted by the cut's origin so they stay on
   * their equipment.
   */
  const handleCropMainPlan = async (croppedDataUrl: string, origin: { x: number; y: number }) => {
    setCropping(true);
    setSaveStatus("Rognage et repositionnement des éléments...");

    try {
      const originalDimensions = planCanvasRef.current?.getBackgroundDimensions() || { width: 0, height: 0 };
      const croppedImage = await loadImage(croppedDataUrl);
      const displayedWidth = mainPlanTransform.width > 0 ? mainPlanTransform.width : originalDimensions.width;
      const displayedHeight = mainPlanTransform.height > 0 ? mainPlanTransform.height : originalDimensions.height;
      const scaleX = displayedWidth / Math.max(1, originalDimensions.width);
      const scaleY = displayedHeight / Math.max(1, originalDimensions.height);
      const croppedTransform: CanvasPlanTransform = {
        x: mainPlanTransform.x + origin.x * scaleX,
        y: mainPlanTransform.y + origin.y * scaleY,
        width: Math.max(1, (croppedImage.naturalWidth || croppedImage.width) * scaleX),
        height: Math.max(1, (croppedImage.naturalHeight || croppedImage.height) * scaleY),
      };

      const res = await fetch(buildApiUrl(`/api/plans/${id}/apply-manual-edit/`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getPlanAuthHeaders() },
        body: JSON.stringify({ image_data: croppedDataUrl }),
      });

      if (!res.ok) {
        const message = await res.json().catch(() => null);
        alert(message?.error || "Impossible d'enregistrer le plan rogné.");
        return;
      }

      setPlan(await res.json());
      setMainPlanTransform(croppedTransform);
      setSaveStatus("Plan principal rogné, éléments conservés — sauvegardez le projet");
      window.setTimeout(() => setSaveStatus(""), 3500);
    } catch (err) {
      console.error("Polygon crop failed:", err);
      alert("Impossible de joindre le serveur pour enregistrer le rognage.");
    } finally {
      setCropping(false);
    }
  };

  const handleCropSecondaryPlan = async (
    overlayId: string,
    croppedDataUrl: string,
    origin: { x: number; y: number }
  ) => {
    const target = planOverlays.find((overlay) => overlay.tempId === overlayId);
    if (!target) return;
    const [sourceImage, croppedImage] = await Promise.all([
      loadImage(target.url),
      loadImage(croppedDataUrl),
    ]);
    const scaleX = target.width / Math.max(1, sourceImage.naturalWidth || sourceImage.width);
    const scaleY = target.height / Math.max(1, sourceImage.naturalHeight || sourceImage.height);
    const localX = origin.x * scaleX;
    const localY = origin.y * scaleY;
    const radians = (target.rotation * Math.PI) / 180;
    const translatedX = localX * Math.cos(radians) - localY * Math.sin(radians);
    const translatedY = localX * Math.sin(radians) + localY * Math.cos(radians);

    setPlanOverlays((current) =>
      current.map((overlay) =>
        overlay.tempId === overlayId
          ? {
              ...overlay,
              url: croppedDataUrl,
              x: overlay.x + translatedX,
              y: overlay.y + translatedY,
              width: Math.max(1, (croppedImage.naturalWidth || croppedImage.width) * scaleX),
              height: Math.max(1, (croppedImage.naturalHeight || croppedImage.height) * scaleY),
              imageChanged: true,
            }
          : overlay
      )
    );
    setSaveStatus("Plan secondaire rogné avec succès !");
    window.setTimeout(() => setSaveStatus(""), 3500);
  };

  const openPolygonCrop = () => {
    const renderedBackground = planCanvasRef.current?.getBackgroundDataUrl();
    setPolygonCropMainUrl(
      renderedBackground ||
      ((plan?.use_cleaned_background && plan.cleaned_background_file)
        ? plan.cleaned_background_file
        : plan?.background_file || "")
    );
    setPolygonCropModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus("Sauvegarde...");
    try {
      const response = await postJson(`/api/plans/${id}/sync-editor/`, {
        icons: iconsPayload(icons),
        shapes: shapesPayload(shapes),
        texts: textsPayload(texts),
        overlays: await overlaysPayload(planOverlays),
        plan_settings: {
          main_plan_x: mainPlanTransform.x,
          main_plan_y: mainPlanTransform.y,
          main_plan_width: mainPlanTransform.width,
          main_plan_height: mainPlanTransform.height,
          main_plan_locked: mainPlanLocked,
          main_plan_visible: mainPlanVisible,
          main_plan_z_index: mainPlanZIndex,
          main_plan_group_id: mainPlanGroupId,
          main_plan_grouping_enabled: mainPlanGroupingEnabled,
          watermark: watermarkConfig,
        },
      });

      if (!response.ok) {
        setSaveStatus("Erreur");
        alert(`Sauvegarde impossible : ${await describeApiError(response)}`);
        return false;
      }

      const savedPlan: EvacuationPlanBackend = await response.json();
      setPlan(savedPlan);
      setPlanOverlays((current) =>
        current.map((overlay, index) => {
          const serverId = savedPlan.overlay_ids?.[index] ?? overlay.serverId;
          const savedOverlay = savedPlan.overlays?.find((item) => item.id === serverId);
          return {
            ...overlay,
            serverId,
            imageChanged: false,
            isOriginal: savedOverlay?.is_original ?? overlay.isOriginal,
            canRevertOriginal: savedOverlay?.can_revert_original ?? overlay.canRevertOriginal,
          };
        })
      );
      setSaveStatus("Sauvegardé !");
      setTimeout(() => setSaveStatus(""), 2000);
      setSavedSnapshot(buildEditableSnapshot());
      return savedPlan;
    } catch (err) {
      console.error(err);
      setSaveStatus("Erreur");
      return null;
    } finally {
      setSaving(false);
    }
  };

  /** Swaps a secondary plan's artwork and records whether the server persisted it. */
  const replaceOverlayImage = (
    tempId: string,
    url: string,
    options: { persisted?: boolean; isOriginal?: boolean; canRevertOriginal?: boolean } = {},
  ) => {
    setPlanOverlays((prev) =>
      prev.map((overlay) => {
        if (overlay.tempId !== tempId) return overlay;
        if (overlay.url.startsWith("blob:")) URL.revokeObjectURL(overlay.url);
        // The pixels changed, so the stored copy is stale: the next save
        // uploads this one instead of pointing at the old file.
        return {
          ...overlay,
          url,
          imageChanged: !options.persisted,
          isOriginal: options.isOriginal ?? false,
          canRevertOriginal: options.canRevertOriginal ?? overlay.canRevertOriginal,
        };
      })
    );
  };

  const ensureOverlayServerId = async (target: CanvasPlanOverlay) => {
    if (target.serverId) return target.serverId;
    const overlayIndex = planOverlays.findIndex((overlay) => overlay.tempId === target.tempId);
    if (overlayIndex < 0) return null;
    const savedPlan = await handleSave();
    if (!savedPlan) return null;
    return savedPlan.overlay_ids?.[overlayIndex] ?? null;
  };

  /**
   * Cleans the plan picked in the cleaning dialog when it is a secondary one.
   * Returns false when the target is the main plan, which the caller handles.
   */
  const cleanSelectedOverlay = async (method: "plan" | "walls") => {
    const target = planOverlays.find((overlay) => overlay.tempId === selectedCleanTargetId);
    if (!target) return false;

    const overlayServerId = await ensureOverlayServerId(target);
    if (!overlayServerId) {
      alert("Enregistrez le plan secondaire avant de lancer son nettoyage.");
      return true;
    }

    setCleaning(true);
    setCleaningText(
      method === "walls"
        ? "Extraction des murs du plan secondaire..."
        : "Nettoyage OpenCV du plan secondaire..."
    );
    try {
      // An imported plan is still a blob: URL in the browser, and the API only
      // reads base64 — hand it the pixels, not the link. On white, because a
      // lasso-cut plan is transparent outside its outline and OpenCV would
      // otherwise read that as solid black.
      const imageData = await toDataUrl(target.url, "#ffffff");
      const res = await postJson(`/api/plans/${id}/clean-image-data/`, {
        image_data: imageData,
        method,
        overlay_id: overlayServerId,
      });

      if (!res.ok) {
        alert(`Erreur lors du nettoyage du plan secondaire : ${await describeApiError(res)}`);
        return true;
      }

      const data = await res.json();
      if (!data?.cleaned_image_data) {
        alert("Le serveur n'a renvoyé aucune image nettoyée pour ce plan.");
        return true;
      }
      replaceOverlayImage(target.tempId, data.cleaned_image_data, {
        persisted: true,
        isOriginal: false,
        canRevertOriginal: Boolean(data.overlay?.can_revert_original),
      });
      setSaveStatus(
        method === "walls"
          ? "Murs du plan secondaire extraits avec succès !"
          : "Plan secondaire nettoyé avec succès !"
      );
      window.setTimeout(() => setSaveStatus(""), 3500);
      void fetchCleaningHistory(overlayServerId);
    } catch (err) {
      console.error(err);
      alert("Erreur lors du nettoyage du plan secondaire.");
    } finally {
      setCleaning(false);
    }
    return true;
  };

  const handleCleanPlan = async () => {
    if (await cleanSelectedOverlay("plan")) return;

    setCleaning(true);
    setCleaningText("Nettoyage OpenCV du plan...");
    try {
      const res = await fetch(buildApiUrl(`/api/plans/${id}/clean/`), {
        method: "POST",
        headers: getPlanAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setPlan(data);
        setRevertConfirmOpen(false);
        void fetchCleaningHistory();
      } else {
        alert("Erreur lors du nettoyage du plan.");
      }
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la communication avec le serveur.");
    } finally {
      setCleaning(false);
    }
  };

  const handleCleanWalls = async () => {
    if (await cleanSelectedOverlay("walls")) return;

    setCleaning(true);
    setCleaningText("Extraction des murs uniquement...");
    try {
      const res = await fetch(buildApiUrl(`/api/plans/${id}/clean-walls/`), {
        method: "POST",
        headers: getPlanAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setPlan(data);
        void fetchCleaningHistory();
      } else {
        alert("Erreur lors du nettoyage des murs.");
      }
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la communication avec le serveur.");
    } finally {
      setCleaning(false);
    }
  };

  /** Bakes the eraser strokes into the stored background. */
  const handleSaveErasedPlan = async () => {
    const canvas = planCanvasRef.current?.getEditedBackground();
    if (!canvas || !eraseStrokeCount) return;

    setSavingErase(true);
    try {
      const res = await fetch(buildApiUrl(`/api/plans/${id}/apply-manual-edit/`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getPlanAuthHeaders() },
        body: JSON.stringify({ image_data: canvas.toDataURL("image/png") })
      });

      if (!res.ok) {
        const message = await res.json().catch(() => null);
        alert(message?.error || "Impossible d'enregistrer la retouche.");
        return;
      }

      const updated = await res.json();
      setPlan(updated);
      setEraseStrokeCount(0);
      setSaveStatus("Retouche enregistrée");
      window.setTimeout(() => setSaveStatus(""), 2500);
    } catch (err) {
      console.error("Manual edit save failed:", err);
      alert("Impossible de joindre le serveur pour enregistrer la retouche.");
    } finally {
      setSavingErase(false);
    }
  };

  const handleRevertPlan = async () => {
    setRevertConfirmOpen(false);
    setCleaning(true);
    setCleaningText("Retour au plan original...");
    try {
      const targetOverlay = planOverlays.find((overlay) => overlay.tempId === selectedCleanTargetId);
      if (targetOverlay) {
        const overlayServerId = await ensureOverlayServerId(targetOverlay);
        if (!overlayServerId) {
          alert("Le plan secondaire doit être enregistré avant de restaurer son original.");
          return;
        }
        const overlayResponse = await fetch(buildApiUrl(`/api/plans/${id}/revert-overlay/`), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getPlanAuthHeaders() },
          body: JSON.stringify({ overlay_id: overlayServerId }),
        });
        const overlayData = await overlayResponse.json();
        if (!overlayResponse.ok) {
          alert(overlayData.error || "Impossible de restaurer le plan secondaire original.");
          return;
        }
        replaceOverlayImage(targetOverlay.tempId, overlayData.image_url, {
          persisted: true,
          isOriginal: true,
          canRevertOriginal: Boolean(overlayData.can_revert_original),
        });
        setSaveStatus("Plan secondaire original restauré !");
        window.setTimeout(() => setSaveStatus(""), 3500);
        return;
      }

      const res = await fetch(buildApiUrl(`/api/plans/${id}/revert/`), {
        method: "POST",
        headers: getPlanAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setPlan(data);
      } else {
        alert("Erreur lors de la restauration du plan.");
      }
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la communication avec le serveur.");
    } finally {
      setCleaning(false);
    }
  };

  // ── xAI key management ────────────────────────────────────────────────
  const handleTestXaiKey = async () => {
    if (!xaiApiKey.trim() && !xaiHasSavedKey) {
      setXaiKeyStatus("Entrez une clé ou sauvegardez-en une.");
      return;
    }

    setXaiKeyTesting(true);
    setXaiKeyStatus(xaiApiKey.trim() ? "Test de la clé saisie..." : "Test de la clé sauvegardée...");
    try {
      const res = await fetch(buildApiUrl(`/api/xai/test-key/`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getPlanAuthHeaders(),
        },
        body: JSON.stringify(xaiApiKey.trim() ? { api_key: xaiApiKey.trim() } : {}),
      });
      const data = await res.json();
      setXaiKeyStatus(data.result === "valide" ? "Clé valide." : "Clé invalide.");
    } catch (err) {
      console.error(err);
      setXaiKeyStatus("Test impossible.");
    } finally {
      setXaiKeyTesting(false);
    }
  };

  const handleSaveXaiKey = async () => {
    if (!xaiApiKey.trim()) {
      setXaiKeyStatus("Entrez une clé à sauvegarder.");
      return;
    }

    setXaiKeySaving(true);
    setXaiKeyStatus(xaiHasSavedKey ? "Remplacement en cours..." : "Sauvegarde en cours...");
    try {
      const res = await fetch(buildApiUrl(`/api/xai-settings/save/`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getPlanAuthHeaders(),
        },
        body: JSON.stringify({ api_key: xaiApiKey.trim() }),
      });

      if (!res.ok) {
        setXaiKeyStatus("Impossible de sauvegarder la clé.");
        return;
      }

      const data: { has_api_key: boolean; updated_at: string | null } = await res.json();
      setXaiApiKey("");
      setXaiHasSavedKey(Boolean(data.has_api_key));
      setXaiSettingsUpdatedAt(data.updated_at);
      setXaiKeyStatus("Clé sauvegardée.");
    } catch (err) {
      console.error(err);
      setXaiKeyStatus("Erreur lors de la sauvegarde.");
    } finally {
      setXaiKeySaving(false);
    }
  };

  const handleDeleteXaiKey = async () => {
    setXaiKeyDeleting(true);
    setXaiKeyStatus("Suppression en cours...");
    try {
      const res = await fetch(buildApiUrl(`/api/xai-settings/delete/`), {
        method: "DELETE",
        headers: getPlanAuthHeaders(),
      });

      if (!res.ok && res.status !== 204) {
        setXaiKeyStatus("Impossible de supprimer la clé.");
        return;
      }

      setXaiApiKey("");
      setXaiHasSavedKey(false);
      setXaiSettingsUpdatedAt(null);
      setXaiKeyStatus("Clé supprimée définitivement.");
    } catch (err) {
      console.error(err);
      setXaiKeyStatus("Erreur lors de la suppression.");
    } finally {
      setXaiKeyDeleting(false);
    }
  };

  const formatXaiSettingsDate = () => {
    if (!xaiSettingsUpdatedAt) return "";
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(xaiSettingsUpdatedAt));
  };

  // ── Grok cleaning job ─────────────────────────────────────────────────
  // The job runs asynchronously on the backend (analyse + image generation
  // take ~1-3 min). We poll its status every 2s until it completes.
  const grokPollRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (grokPollRef.current !== null) window.clearTimeout(grokPollRef.current);
    };
  }, []);

  const launchGrokCleaning = async () => {
    const targetOverlay = planOverlays.find((overlay) => overlay.tempId === selectedCleanTargetId);
    if (!xaiHasSavedKey) return;

    setGrokCleaning(true);
    setGrokError("");
    setGrokJob(null);
    if (grokPollRef.current !== null) {
      window.clearTimeout(grokPollRef.current);
      grokPollRef.current = null;
    }

    const launchController = new AbortController();
    const launchTimeout = window.setTimeout(
      () => launchController.abort(),
      GROK_LAUNCH_REQUEST_TIMEOUT_MS,
    );
    try {
      const overlayServerId = targetOverlay
        ? await ensureOverlayServerId(targetOverlay)
        : null;
      if (targetOverlay && !overlayServerId) {
        setGrokError("Le plan secondaire n’a pas pu être enregistré avant le traitement.");
        setGrokCleaning(false);
        return;
      }
      const imageData = targetOverlay
        ? await toDataUrl(targetOverlay.url, "#ffffff")
        : undefined;
      const res = await fetch(buildApiUrl(`/api/plans/${id}/grok-clean/`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getPlanAuthHeaders() },
        signal: launchController.signal,
        body: JSON.stringify({
          background_color: grokBackgroundColor,
          wall_color: grokWallColor,
          preset: grokPreset,
          target_kind: targetOverlay ? "overlay" : "main",
          ...(overlayServerId ? { overlay_id: overlayServerId } : {}),
          ...(imageData ? { image_data: imageData } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGrokError(`${data.error_code || ""} ${data.error || "Lancement impossible."}`.trim());
        setGrokCleaning(false);
        return;
      }
      pollGrokJob(data.job_id, targetOverlay?.tempId || null, overlayServerId);
    } catch (error) {
      setGrokError(
        error instanceof DOMException && error.name === "AbortError"
          ? "Le serveur n’a pas répondu au lancement du nettoyage dans le délai prévu."
          : "Impossible de joindre le serveur pour lancer le nettoyage."
      );
      setGrokCleaning(false);
    } finally {
      window.clearTimeout(launchTimeout);
    }
  };

  const pollGrokJob = (
    jobId: number,
    overlayTempId: string | null = null,
    overlayServerId: number | null = null,
  ) => {
    let pollAttempts = 0;
    const tick = async () => {
      grokPollRef.current = null;
      if (pollAttempts >= GROK_MAX_POLL_ATTEMPTS) {
        setGrokError(
          "Le nettoyage avec Grok a dépassé 12 minutes et a été arrêté. Veuillez réessayer."
        );
        setGrokCleaning(false);
        return;
      }
      pollAttempts += 1;

      const statusController = new AbortController();
      const statusTimeout = window.setTimeout(
        () => statusController.abort(),
        GROK_STATUS_REQUEST_TIMEOUT_MS,
      );
      try {
        const res = await fetch(
          buildApiUrl(`/api/plans/${id}/grok-clean-status/?job_id=${jobId}`),
          { headers: getPlanAuthHeaders(), signal: statusController.signal }
        );
        const data = await res.json() as GrokJob & { detail?: string };
        if (!res.ok) {
          setGrokError(
            `${data.error_code || ""} ${data.error || data.detail || "Impossible de vérifier l’état du nettoyage."}`.trim()
          );
          setGrokCleaning(false);
          return;
        }
        setGrokJob(data);

        if (data.status === "failed") {
          setGrokError(
            `${data.error_code || ""} ${data.error || "Nettoyage échoué."}`.trim() +
              (data.diagnostic ? `\n\nDétail technique : ${data.diagnostic}` : "")
          );
          setGrokCleaning(false);
          return;
        }
        if (data.status === "completed") {
          setGrokCleaning(false);
          if (overlayTempId) {
            if (!data.after_image) {
              setGrokError("Le traitement est terminé, mais aucune image n’a été renvoyée.");
              return;
            }
            replaceOverlayImage(overlayTempId, data.after_image, {
              persisted: true,
              isOriginal: false,
              canRevertOriginal: true,
            });
            setSaveStatus("Plan secondaire traité avec l’IA et ajouté à l’historique !");
            window.setTimeout(() => setSaveStatus(""), 4500);
            if (overlayServerId) void fetchCleaningHistory(overlayServerId);
            setCleanModalOpen(false);
            return;
          }
          // Main-plan results are already applied by the backend.
          void fetchCleaningHistory();
          void refreshPlan();
          setCleanModalOpen(false);
          setSaveStatus("Plan nettoyé avec Grok et ajouté à l’historique !");
          window.setTimeout(() => setSaveStatus(""), 4500);
          return;
        }
        grokPollRef.current = window.setTimeout(tick, GROK_POLL_INTERVAL_MS);
      } catch (error) {
        setGrokError(
          error instanceof DOMException && error.name === "AbortError"
            ? "Le serveur n’a pas répondu pendant la vérification du nettoyage."
            : "Perte de contact avec le serveur pendant le nettoyage."
        );
        setGrokCleaning(false);
      } finally {
        window.clearTimeout(statusTimeout);
      }
    };
    void tick();
  };

  const refreshPlan = async () => {
    try {
      const res = await fetch(buildApiUrl(`/api/plans/${id}/`), {
        headers: getPlanAuthHeaders(),
        cache: "no-store",
      });
      if (res.ok) setPlan(await res.json());
    } catch {
      /* informational; the history list already reflects the new state */
    }
  };

  const grokStepLabels: Record<"analyzing" | "generating", string> = {
    analyzing: "Analyse du plan par Grok",
    generating: grokPreset === "sketch"
      ? "Mise au propre du croquis en plan architectural"
      : "Génération de la base architecturale",
  };
  const grokStepOrder: Array<"analyzing" | "generating"> = ["analyzing", "generating"];

  const getGrokStepState = (step: "analyzing" | "generating") => {
    const current = grokJob?.status;
    if (current === "completed") return "done";
    if (current === "failed" || !current) return "pending";
    const idx = grokStepOrder.indexOf(current as "analyzing" | "generating");
    const stepIdx = grokStepOrder.indexOf(step);
    if (idx === -1) return "pending";
    if (stepIdx < idx) return "done";
    if (stepIdx === idx) return "current";
    return "pending";
  };

  // ── Cleaning history (local + Grok) ───────────────────────────────────
  const formatHistoryDate = (value: string) => {
    if (!value) return "Date non disponible";
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  };

  const fetchCleaningHistory = async (overlayIdOverride?: number) => {
    if (!id) return;
    const selectedOverlay = planOverlays.find((overlay) => overlay.tempId === selectedCleanTargetId);
    const overlayId = overlayIdOverride ?? selectedOverlay?.serverId;
    if (selectedOverlay && !overlayId) {
      setCleaningHistory([]);
      return;
    }
    setCleaningHistoryLoading(true);
    try {
      const query = overlayId ? `?overlay_id=${overlayId}` : "";
      const res = await fetch(buildApiUrl(`/api/plans/${id}/cleaning-history/${query}`), {
        headers: getPlanAuthHeaders(),
        cache: "no-store",
      });
      if (!res.ok) return;
      const data: CleaningHistoryItem[] = await res.json();
      setCleaningHistory(data);
    } catch (err) {
      console.error("Failed to fetch cleaning history:", err);
    } finally {
      setCleaningHistoryLoading(false);
    }
  };

  const handleUseHistory = async (historyItem: CleaningHistoryItem) => {
    const selectedOverlay = planOverlays.find((overlay) => overlay.tempId === selectedCleanTargetId);
    setCleaningHistoryApplyingId(historyItem.id);
    try {
      const res = await fetch(buildApiUrl(`/api/plans/${id}/use-cleaning-history/`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getPlanAuthHeaders(),
        },
        body: JSON.stringify({
          history_id: historyItem.id,
          ...(selectedOverlay?.serverId ? { overlay_id: selectedOverlay.serverId } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Impossible d'utiliser cette version de l'historique.");
        return;
      }

      if (data.target_kind === "overlay" && data.overlay && selectedOverlay) {
        replaceOverlayImage(selectedOverlay.tempId, data.overlay.image_url, {
          persisted: true,
          isOriginal: false,
          canRevertOriginal: Boolean(data.overlay.can_revert_original),
        });
      } else {
        setPlan(data);
      }
      setCleanModalOpen(false);
      setSaveStatus("Version nettoyée de l'historique appliquée !");
      window.setTimeout(() => setSaveStatus(""), 3500);
      void fetchCleaningHistory(selectedOverlay?.serverId);
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la communication avec le serveur.");
    } finally {
      setCleaningHistoryApplyingId(null);
    }
  };

  const selectedIcon = icons.find((i) => i.tempId === selectedIconId);
  const selectedText = texts.find((t) => t.tempId === selectedTextId);
  const selectedShape = shapes.find((s) => s.tempId === selectedShapeId);

  const handleUpdateSelectedShape = (key: keyof CanvasShape, value: any) => {
    if (!selectedShapeId) return;
    const styleAppliesToGroup = key === "color" || key === "stroke_width";
    const objectGroupId = styleAppliesToGroup ? selectedShape?.object_group_id : "";
    setShapes((prev) =>
      prev.map((s) =>
        s.tempId === selectedShapeId || (objectGroupId && s.object_group_id === objectGroupId)
          ? { ...s, [key]: value }
          : s
      )
    );
  };

  const handleDeleteSelectedShapePoint = (pointIndex: number) => {
    if (!selectedShapeId || !selectedShape || selectedShape.locked) return;
    const updatedShape = shapeWithoutPoint(selectedShape, pointIndex);
    if (!updatedShape) return;
    setShapes((current) => current.map((shape) =>
      shape.tempId === selectedShapeId ? updatedShape : shape
    ));
  };

  const handleDeleteSelectedShape = () => {
    if (!selectedShapeId) return;
    if (selectedShape?.locked) return;
    setShapes((prev) => prev.filter((s) => s.tempId !== selectedShapeId));
    setSelectedShapeId(null);
  };

  // The "Vous êtes ici" marker defines the reading direction: the plan is turned
  // so that what the reader faces points up. Rotating the marker in the editor is
  // therefore how you orient the exported plan.
  const youAreHereIcon = icons.find((icon) => isYouAreHereIcon(icon.icon_type, iconDefinitions));
  const planReadingAngle = youAreHereIcon ? youAreHereIcon.rotation : null;

  /**
   * How far the plan is actually turned on screen. The marker's rotation is the
   * direction the reader faces, so the sheet has to turn by the opposite angle
   * for that direction to end up pointing at the top of the page. The manual
   * ⟲/⟳ steps compose with it rather than replacing it.
   */
  const effectivePlanRotation = ((canvasRotation - (planReadingAngle ?? 0)) % 360 + 360) % 360;

  // Keep the export's own angle — the compass needle, the render cache key — on
  // the same value the studio is displaying, so the two can never disagree.
  useEffect(() => {
    setExportPlanRotation(effectivePlanRotation);
  }, [effectivePlanRotation]);
  const usedIconTypes = Array.from(new Set(
    icons.filter((icon) => icon.visible !== false).map((icon) => icon.icon_type)
  ));

  // ── Sheet mode plumbing ────────────────────────────────────────────────────
  const sheetActive = sheetTemplate !== "none" && sheetBlocks.length > 0;
  const currentSheetTemplateVersions = useMemo(
    () => sheetTemplate === "none"
      ? []
      : storedSheetTemplateVersions.filter((version) => version.template === sheetTemplate),
    [sheetTemplate, storedSheetTemplateVersions]
  );
  const activeSheetSize = useMemo(() => {
    if (sheetTemplate === "none") return { width: SHEET_WIDTH, height: SHEET_HEIGHT };
    const template = SHEET_TEMPLATES[sheetTemplate];
    return { width: template.width, height: template.height };
  }, [sheetTemplate]);

  /** Identity-stable so the canvas does not refit on every keystroke. */
  const sheetProp = useMemo(
    () => (sheetActive ? { ...activeSheetSize, blocks: sheetBlocks } : null),
    [sheetActive, activeSheetSize, sheetBlocks]
  );

  const selectedBlock = useMemo(
    () => sheetBlocks.find((block) => block.id === selectedBlockId) ?? null,
    [sheetBlocks, selectedBlockId]
  );

  const updateSelectedBlock = (patch: Partial<SheetBlock>) => {
    if (!selectedBlockId) return;
    setSheetBlocks((blocks) =>
      blocks.map((block) => (block.id === selectedBlockId ? { ...block, ...patch } : block))
    );
  };

  const selectedOverlay = selectedOverlayId && selectedOverlayId !== MAIN_PLAN_ID
    ? planOverlays.find((overlay) => overlay.tempId === selectedOverlayId) ?? null
    : null;

  const editorLayerItems = useMemo<EditorLayerItem[]>(() => {
    const shapeLabels: Record<ShapeKind, string> = {
      line: "Ligne",
      rect: "Rectangle",
      circle: "Cercle",
      zone: "Zone",
      polyline: "Polyligne",
      polygon_zone: "Zone polygone",
      free_polygon_zone: "Zone libre",
      curve_polygon_zone: "Zone courbe",
    };
    const items: EditorLayerItem[] = [
      {
        id: MAIN_PLAN_ID,
        kind: "main",
        label: plan?.title || "Plan principal",
        visible: mainPlanVisible,
        locked: mainPlanLocked,
        zIndex: mainPlanZIndex,
      },
      ...planOverlays.map((overlay, index) => ({
        id: overlay.tempId,
        kind: "overlay" as const,
        label: overlay.label || `Plan secondaire ${index + 1}`,
        visible: overlay.visible !== false,
        locked: Boolean(overlay.locked),
        zIndex: overlay.z_index ?? 100,
      })),
      ...shapes.map((shape, index) => ({
        id: shape.tempId,
        kind: "shape" as const,
        label: `${shapeLabels[shape.shape_type]} ${index + 1}`,
        visible: shape.visible !== false,
        locked: Boolean(shape.locked),
        zIndex: shape.z_index ?? 200,
      })),
      ...icons.map((icon, index) => ({
        id: icon.tempId,
        kind: "icon" as const,
        label: icon.label || iconDefinitions[icon.icon_type]?.label || `Pictogramme ${index + 1}`,
        visible: icon.visible !== false,
        locked: Boolean(icon.locked),
        zIndex: icon.z_index ?? 300,
      })),
      ...texts.map((text, index) => ({
        id: text.tempId,
        kind: "text" as const,
        label: text.text.trim().slice(0, 40) || `Texte ${index + 1}`,
        visible: text.visible !== false,
        locked: Boolean(text.locked),
        zIndex: text.z_index ?? 400,
      })),
    ];
    // Illustrator convention: the first row is the front-most layer.
    return items.sort((left, right) => right.zIndex - left.zIndex);
  }, [plan?.title, mainPlanVisible, mainPlanLocked, mainPlanZIndex, planOverlays, shapes, icons, texts, iconDefinitions]);

  const sheetLayerItems = useMemo<EditorLayerItem[]>(() =>
    sheetBlocks
      .map((block, index) => ({
        id: block.id,
        kind: block.kind === "plan"
          ? "main" as const
          : block.kind === "picto"
            ? "icon" as const
            : block.kind === "image" || block.kind === "background"
              ? "overlay" as const
              : "text" as const,
        label: block.label,
        visible: block.visible,
        locked: Boolean(block.locked),
        // Sheet blocks are rendered bottom-to-top in array order.
        zIndex: index * 10,
      }))
      .sort((left, right) => right.zIndex - left.zIndex),
    [sheetBlocks]
  );

  const activeLayerItems = sheetActive ? sheetLayerItems : editorLayerItems;
  const selectedSheetLayerIndex = selectedBlockId
    ? sheetLayerItems.findIndex((item) => item.id === selectedBlockId)
    : -1;

  const selectedLayerId = sheetActive
    ? selectedBlockId
    : selectedIconId || selectedTextId || selectedShapeId || selectedOverlayId;

  const clearObjectSelections = () => {
    setSelectedIconId(null);
    setSelectedTextId(null);
    setSelectedShapeId(null);
    setSelectedOverlayId(null);
    setSelectedBlockId(null);
    setSelectedBatBlock(false);
    setMultiSelection({ iconIds: [], shapeIds: [], textIds: [] });
  };

  const handleSelectLayer = (item: EditorLayerItem) => {
    clearObjectSelections();
    if (sheetActive) {
      setSelectedBlockId(item.id);
      return;
    }
    if (item.kind === "main" || item.kind === "overlay") setSelectedOverlayId(item.id);
    else if (item.kind === "shape") setSelectedShapeId(item.id);
    else if (item.kind === "icon") setSelectedIconId(item.id);
    else setSelectedTextId(item.id);
  };

  const handleToggleLayerVisibility = (item: EditorLayerItem) => {
    const visible = !item.visible;
    if (sheetActive) {
      if (!visible && selectedBlockId === item.id) setSelectedBlockId(null);
      setSheetBlocks((current) => current.map((block) =>
        block.id === item.id ? { ...block, visible } : block
      ));
      return;
    }
    if (!visible) {
      if (selectedLayerId === item.id) clearObjectSelections();
      setMultiSelection((current) => ({
        iconIds: current.iconIds.filter((id) => id !== item.id),
        shapeIds: current.shapeIds.filter((id) => id !== item.id),
        textIds: current.textIds.filter((id) => id !== item.id),
      }));
    }
    if (item.kind === "main") setMainPlanVisible(visible);
    else if (item.kind === "overlay") {
      setPlanOverlays((current) => current.map((overlay) =>
        overlay.tempId === item.id ? { ...overlay, visible } : overlay
      ));
    } else if (item.kind === "shape") {
      setShapes((current) => current.map((shape) =>
        shape.tempId === item.id ? { ...shape, visible } : shape
      ));
    } else if (item.kind === "icon") {
      setIcons((current) => current.map((icon) =>
        icon.tempId === item.id ? { ...icon, visible } : icon
      ));
    } else {
      setTexts((current) => current.map((text) =>
        text.tempId === item.id ? { ...text, visible } : text
      ));
    }
  };

  const handleToggleLayerLock = (item: EditorLayerItem) => {
    const locked = !item.locked;
    if (sheetActive) {
      setSheetBlocks((current) => current.map((block) =>
        block.id === item.id ? { ...block, locked } : block
      ));
      return;
    }
    if (item.kind === "main") setMainPlanLocked(locked);
    else if (item.kind === "overlay") {
      setPlanOverlays((current) => current.map((overlay) =>
        overlay.tempId === item.id ? { ...overlay, locked } : overlay
      ));
    } else if (item.kind === "shape") {
      setShapes((current) => current.map((shape) =>
        shape.tempId === item.id ? { ...shape, locked } : shape
      ));
    } else if (item.kind === "icon") {
      setIcons((current) => current.map((icon) =>
        icon.tempId === item.id ? { ...icon, locked } : icon
      ));
    } else {
      setTexts((current) => current.map((text) =>
        text.tempId === item.id ? { ...text, locked } : text
      ));
    }
  };

  const applyLayerOrder = (topToBottomIds: string[]) => {
    const knownIds = new Set(editorLayerItems.map((item) => item.id));
    const normalizedIds = [
      ...topToBottomIds.filter((id, index) => knownIds.has(id) && topToBottomIds.indexOf(id) === index),
      ...editorLayerItems.map((item) => item.id).filter((id) => !topToBottomIds.includes(id)),
    ];
    const bottomToTopIds = [...normalizedIds].reverse();
    const zById = new Map(bottomToTopIds.map((id, index) => [id, index * 10]));
    setMainPlanZIndex(zById.get(MAIN_PLAN_ID) ?? mainPlanZIndex);
    setPlanOverlays((current) => current.map((overlay) => ({
      ...overlay,
      z_index: zById.get(overlay.tempId) ?? overlay.z_index,
    })));
    setShapes((current) => current.map((shape) => ({
      ...shape,
      z_index: zById.get(shape.tempId) ?? shape.z_index,
    })));
    setIcons((current) => current.map((icon) => ({
      ...icon,
      z_index: zById.get(icon.tempId) ?? icon.z_index,
    })));
    setTexts((current) => current.map((text) => ({
      ...text,
      z_index: zById.get(text.tempId) ?? text.z_index,
    })));
  };

  const handleReorderLayers = (topToBottomIds: string[]) => {
    if (sheetActive) {
      const byId = new Map(sheetBlocks.map((block) => [block.id, block]));
      const normalizedIds = [
        ...topToBottomIds.filter((id, index) => byId.has(id) && topToBottomIds.indexOf(id) === index),
        ...sheetLayerItems.map((item) => item.id).filter((id) => !topToBottomIds.includes(id)),
      ];
      setSheetBlocks([...normalizedIds].reverse().map((id) => byId.get(id)!).filter(Boolean));
      return;
    }
    applyLayerOrder(topToBottomIds);
  };

  const handleMoveLayer = (id: string, direction: LayerMoveDirection) => {
    const bottomToTop = [...activeLayerItems].reverse();
    const currentIndex = bottomToTop.findIndex((item) => item.id === id);
    if (currentIndex < 0) return;
    const [item] = bottomToTop.splice(currentIndex, 1);
    if (direction === "front") bottomToTop.push(item);
    else if (direction === "back") bottomToTop.unshift(item);
    else if (direction === "up") bottomToTop.splice(Math.min(bottomToTop.length, currentIndex + 1), 0, item);
    else bottomToTop.splice(Math.max(0, currentIndex - 1), 0, item);
    handleReorderLayers(bottomToTop.reverse().map((layer) => layer.id));
  };

  const cleanTargetOverlay = selectedCleanTargetId !== MAIN_PLAN_ID
    ? planOverlays.find((overlay) => overlay.tempId === selectedCleanTargetId) ?? null
    : null;
  const multiSelectionCount =
    multiSelection.iconIds.length + multiSelection.shapeIds.length + multiSelection.textIds.length;
  const selectedMultiIcons = icons.filter((icon) => multiSelection.iconIds.includes(icon.tempId));
  const selectedMultiShapes = shapes.filter((shape) => multiSelection.shapeIds.includes(shape.tempId));
  const selectedMultiTexts = texts.filter((text) => multiSelection.textIds.includes(text.tempId));
  const selectedMultiObjectGroups = [
    ...selectedMultiIcons.map((icon) => icon.object_group_id || ""),
    ...selectedMultiShapes.map((shape) => shape.object_group_id || ""),
    ...selectedMultiTexts.map((text) => text.object_group_id || ""),
  ];
  const selectedMultiObjectGroupIds = Array.from(new Set(selectedMultiObjectGroups.filter(Boolean)));
  const sharedObjectGroupId = multiSelectionCount > 0
    && selectedMultiObjectGroups.length === multiSelectionCount
    && selectedMultiObjectGroups.every((groupId) => groupId && groupId === selectedMultiObjectGroups[0])
    ? selectedMultiObjectGroups[0]
    : "";
  const multiShapeColor = selectedMultiShapes[0]?.color || "#000000";
  const multiShapeStrokeWidth = selectedMultiShapes[0]?.stroke_width ?? shapeStrokeWidth;
  const multiShapeColorsMixed = selectedMultiShapes.some((shape) => shape.color !== multiShapeColor);
  const multiShapeWidthsMixed = selectedMultiShapes.some((shape) => shape.stroke_width !== multiShapeStrokeWidth);

  const handleUpdateMultiShapeStyle = (key: "color" | "stroke_width", value: string | number) => {
    if (!multiSelection.shapeIds.length) return;
    const shapeIds = new Set(multiSelection.shapeIds);
    setShapes((current) => current.map((shape) =>
      shapeIds.has(shape.tempId) ? { ...shape, [key]: value } : shape
    ));
  };

  const getObjectGroupSelection = (groupId: string): CanvasMultiSelection => ({
    iconIds: icons.filter((icon) => icon.object_group_id === groupId).map((icon) => icon.tempId),
    shapeIds: shapes.filter((shape) => shape.object_group_id === groupId).map((shape) => shape.tempId),
    textIds: texts.filter((text) => text.object_group_id === groupId).map((text) => text.tempId),
  });

  const buildShapeSvgPath = (shape: CanvasShape, previewPoint?: { x: number; y: number } | null) => {
    const points = shape.points || [];
    if (!points.length) return "";
    const isOpen = shape.shape_type === "polyline";
    const controlPoints = shape.control_points || {};
    let data = `M ${svgNumber(points[0].x)} ${svgNumber(points[0].y)}`;
    for (let index = 0; index < points.length - 1; index += 1) {
      const next = points[index + 1];
      const control = controlPoints[index];
      data += control
        ? ` Q ${svgNumber(control.x)} ${svgNumber(control.y)} ${svgNumber(next.x)} ${svgNumber(next.y)}`
        : ` L ${svgNumber(next.x)} ${svgNumber(next.y)}`;
    }
    if (previewPoint) {
      data += ` L ${svgNumber(previewPoint.x)} ${svgNumber(previewPoint.y)}`;
    } else if (!isOpen && points.length >= 3) {
      const control = controlPoints[points.length - 1];
      data += control
        ? ` Q ${svgNumber(control.x)} ${svgNumber(control.y)} ${svgNumber(points[0].x)} ${svgNumber(points[0].y)}`
        : " Z";
    }
    return data;
  };

  const getShapeExportBounds = (shape: CanvasShape) => {
    const pad = Math.max(2, shape.stroke_width || 0);
    if (shape.points?.length) {
      const allPoints = [
        ...shape.points,
        ...Object.values(shape.control_points || {})
      ];
      const bounds = boundsFromPoints(allPoints);
      return {
        x: bounds.x - pad,
        y: bounds.y - pad,
        width: bounds.width + pad * 2,
        height: bounds.height + pad * 2
      };
    }
    if (shape.shape_type === "line") {
      const x = Math.min(shape.x, shape.x + shape.width) - pad;
      const y = Math.min(shape.y, shape.y + shape.height) - pad;
      return {
        x,
        y,
        width: Math.abs(shape.width) + pad * 2,
        height: Math.abs(shape.height) + pad * 2
      };
    }
    return {
      x: shape.x - pad,
      y: shape.y - pad,
      width: Math.abs(shape.width) + pad * 2,
      height: Math.abs(shape.height) + pad * 2
    };
  };

  const getTextExportBounds = (text: CanvasText) => {
    const lines = text.text.split("\n");
    const width = Math.max(1, ...lines.map((line) => line.length)) * text.font_size * 0.62;
    const height = Math.max(text.font_size, lines.length * text.font_size * 1.25);
    return { x: text.x, y: text.y, width, height };
  };

  const getSelectedSvgBounds = () => {
    const boxes = [
      ...selectedMultiIcons.flatMap((icon) => {
        const boxes = [{ x: icon.x, y: icon.y, width: icon.width, height: icon.height }];
        if (icon.anchor_x != null && icon.anchor_y != null) {
          boxes.push({ x: icon.anchor_x - 4, y: icon.anchor_y - 4, width: 8, height: 8 });
        }
        return boxes;
      }),
      ...selectedMultiShapes.map(getShapeExportBounds),
      ...selectedMultiTexts.map(getTextExportBounds),
    ];
    if (!boxes.length) return null;
    const minX = Math.min(...boxes.map((box) => box.x));
    const minY = Math.min(...boxes.map((box) => box.y));
    const maxX = Math.max(...boxes.map((box) => box.x + box.width));
    const maxY = Math.max(...boxes.map((box) => box.y + box.height));
    return {
      x: minX - SVG_EXPORT_PADDING,
      y: minY - SVG_EXPORT_PADDING,
      width: Math.max(1, maxX - minX + SVG_EXPORT_PADDING * 2),
      height: Math.max(1, maxY - minY + SVG_EXPORT_PADDING * 2),
    };
  };

  const shapeToSvg = (shape: CanvasShape) => {
    const stroke = shape.stroke_width > 0
      ? `stroke="${escapeSvgAttribute(shape.color || "#000000")}" stroke-width="${svgNumber(shape.stroke_width)}"`
      : `stroke="none"`;
    const fill = shape.fill_color
      ? `fill="${escapeSvgAttribute(shape.fill_color)}" fill-opacity="${svgNumber(shape.fill_opacity !== undefined ? shape.fill_opacity : 0.35)}"`
      : `fill="none"`;
    const transform = shape.rotation
      ? ` transform="rotate(${svgNumber(shape.rotation)} ${svgNumber(shape.x + shape.width / 2)} ${svgNumber(shape.y + shape.height / 2)})"`
      : "";

    if (shape.shape_type === "line") {
      return `<line x1="${svgNumber(shape.x)}" y1="${svgNumber(shape.y)}" x2="${svgNumber(shape.x + shape.width)}" y2="${svgNumber(shape.y + shape.height)}" ${stroke} stroke-linecap="round" fill="none"${transform}/>`;
    }
    if (shape.shape_type === "circle") {
      return `<ellipse cx="${svgNumber(shape.x + shape.width / 2)}" cy="${svgNumber(shape.y + shape.height / 2)}" rx="${svgNumber(Math.abs(shape.width) / 2)}" ry="${svgNumber(Math.abs(shape.height) / 2)}" ${fill} ${stroke}${transform}/>`;
    }
    if (shape.shape_type === "zone") {
      const zoneFill = shape.fill_color || shape.color;
      const opacity = shape.fill_opacity !== undefined ? shape.fill_opacity : 0.28;
      return `<rect x="${svgNumber(shape.x)}" y="${svgNumber(shape.y)}" width="${svgNumber(Math.abs(shape.width))}" height="${svgNumber(Math.abs(shape.height))}" fill="${escapeSvgAttribute(zoneFill)}" fill-opacity="${svgNumber(opacity)}" ${stroke} stroke-dasharray="10 6"${transform}/>`;
    }
    if (isPolygonShape(shape.shape_type)) {
      const data = buildShapeSvgPath(shape);
      const open = shape.shape_type === "polyline";
      return `<path d="${escapeSvgAttribute(data)}" ${open ? `fill="none"` : fill} ${stroke} stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    return `<rect x="${svgNumber(shape.x)}" y="${svgNumber(shape.y)}" width="${svgNumber(Math.abs(shape.width))}" height="${svgNumber(Math.abs(shape.height))}" ${fill} ${stroke}${transform}/>`;
  };

  const iconToSvg = (icon: CanvasIcon) => {
    const definition = iconDefinitions[icon.icon_type];
    const leaderColor = definition?.color || "#22c55e";
    const parts: string[] = [];
    if (icon.anchor_x != null && icon.anchor_y != null) {
      const centerX = icon.x + icon.width / 2;
      const centerY = icon.y + icon.height / 2;
      parts.push(`<line x1="${svgNumber(icon.anchor_x)}" y1="${svgNumber(icon.anchor_y)}" x2="${svgNumber(centerX)}" y2="${svgNumber(centerY)}" stroke="${escapeSvgAttribute(leaderColor)}" stroke-width="${svgNumber(icon.leader_width ?? 2)}" stroke-linecap="round"/>`);
      parts.push(`<circle cx="${svgNumber(icon.anchor_x)}" cy="${svgNumber(icon.anchor_y)}" r="4" fill="${escapeSvgAttribute(leaderColor)}"/>`);
    }

    const centerX = icon.x + icon.width / 2;
    const centerY = icon.y + icon.height / 2;
    const flipX = icon.flip_x ? -1 : 1;
    const flipY = icon.flip_y ? -1 : 1;
    const transform = `translate(${svgNumber(centerX)} ${svgNumber(centerY)}) rotate(${svgNumber(icon.rotation || 0)}) scale(${flipX} ${flipY}) translate(${svgNumber(-icon.width / 2)} ${svgNumber(-icon.height / 2)})`;
    const svg = definition?.svg || "";
    const match = svg.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
    const attrs = match?.[1] || "";
    const inner = match?.[2] || svg;
    const viewBox = attrs.match(/viewBox=["']([^"']+)["']/i)?.[1] || "0 0 100 100";
    const imageUrl = getIconImageSource(icon.icon_type, iconDefinitions);

    if (svg) {
      parts.push(`<g transform="${transform}">${icon.framed ? `<rect x="0" y="0" width="${svgNumber(icon.width)}" height="${svgNumber(icon.height)}" rx="3" fill="#ffffff" stroke="${escapeSvgAttribute(leaderColor)}" stroke-width="2"/>` : ""}<svg x="0" y="0" width="${svgNumber(icon.width)}" height="${svgNumber(icon.height)}" viewBox="${escapeSvgAttribute(viewBox)}" preserveAspectRatio="xMidYMid meet">${inner}</svg></g>`);
    } else if (imageUrl) {
      parts.push(`<g transform="${transform}"><image href="${escapeSvgAttribute(imageUrl)}" x="0" y="0" width="${svgNumber(icon.width)}" height="${svgNumber(icon.height)}" preserveAspectRatio="xMidYMid meet"/></g>`);
    } else {
      parts.push(`<rect x="${svgNumber(icon.x)}" y="${svgNumber(icon.y)}" width="${svgNumber(icon.width)}" height="${svgNumber(icon.height)}" fill="${escapeSvgAttribute(leaderColor)}"/>`);
    }

    if (icon.label) {
      parts.push(`<text x="${svgNumber(centerX)}" y="${svgNumber(icon.y + icon.height + 14)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="700" fill="#111111">${escapeSvgText(icon.label)}</text>`);
    }
    return parts.join("\n");
  };

  const textToSvg = (item: CanvasText) => {
    const bounds = getTextExportBounds(item);
    const transform = item.rotation
      ? ` transform="rotate(${svgNumber(item.rotation)} ${svgNumber(item.x)} ${svgNumber(item.y)})"`
      : "";
    const lines = item.text.split("\n");
    const background = item.background_color
      ? `<rect x="${svgNumber(bounds.x - 4)}" y="${svgNumber(bounds.y - 2)}" width="${svgNumber(bounds.width + 8)}" height="${svgNumber(bounds.height + 4)}" fill="${escapeSvgAttribute(item.background_color)}" rx="2"${transform}/>`
      : "";
    const fontStyle = item.italic ? ` font-style="italic"` : "";
    const fontWeight = item.bold ? ` font-weight="700"` : "";
    const textLines = lines.map((line, index) =>
      `<tspan x="${svgNumber(item.x)}" dy="${index === 0 ? "0" : svgNumber(item.font_size * 1.25)}">${escapeSvgText(line)}</tspan>`
    ).join("");
    return `${background}<text x="${svgNumber(item.x)}" y="${svgNumber(item.y + item.font_size)}" font-family="${escapeSvgAttribute(item.font_family || "Arial")}" font-size="${svgNumber(item.font_size)}" fill="${escapeSvgAttribute(item.color)}"${fontWeight}${fontStyle}${transform}>${textLines}</text>`;
  };

  const handleExportSelectedGroupSvg = () => {
    if (!multiSelectionCount) return;
    const bounds = getSelectedSvgBounds();
    if (!bounds) return;
    const body = [
      ...selectedMultiShapes
        .filter((shape) => shape.visible !== false)
        .map((shape) => ({
          key: `shape-${shape.tempId}`,
          zIndex: shape.z_index ?? 200,
          svg: shapeToSvg(shape),
        })),
      ...selectedMultiIcons
        .filter((icon) => icon.visible !== false)
        .map((icon) => ({
          key: `icon-${icon.tempId}`,
          zIndex: icon.z_index ?? 300,
          svg: iconToSvg(icon),
        })),
      ...selectedMultiTexts
        .filter((text) => text.visible !== false)
        .map((text) => ({
          key: `text-${text.tempId}`,
          zIndex: text.z_index ?? 400,
          svg: textToSvg(text),
        })),
    ]
      .sort((left, right) => left.zIndex - right.zIndex || left.key.localeCompare(right.key))
      .map((item) => item.svg)
      .join("\n");
    const svg = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${svgNumber(bounds.width)}" height="${svgNumber(bounds.height)}" viewBox="${svgNumber(bounds.x)} ${svgNumber(bounds.y)} ${svgNumber(bounds.width)} ${svgNumber(bounds.height)}">`,
      body,
      `</svg>`
    ].join("\n");
    const suffix = sharedObjectGroupId ? "groupe" : "selection";
    const rawName = `${plan?.title || "icone"}-${suffix}`.toLowerCase();
    const filename = `${rawName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "icone-groupe"}.svg`;
    downloadTextFile(svg, filename, "image/svg+xml;charset=utf-8");
    setSaveStatus("SVG du groupe exporté");
    window.setTimeout(() => setSaveStatus(""), 2500);
  };

  const activateAreaSelection = () => {
    const next = !areaSelectionMode;
    setAreaSelectionMode(next);
    setMode("select");
    setPlacementIconType(null);
    setPlacementText(false);
    setShapeTool(null);
    if (next) {
      setMultiSelection({ iconIds: [], shapeIds: [], textIds: [] });
      setSelectedIconId(null);
      setSelectedShapeId(null);
      setSelectedTextId(null);
      setSelectedOverlayId(null);
      setSelectedBlockId(null);
      setSelectedBatBlock(false);
      setSaveStatus("Tracez un rectangle autour des objets à sélectionner");
    } else {
      setSaveStatus("");
    }
  };

  const handleAreaSelectionComplete = (count: number) => {
    setAreaSelectionMode(false);
    setSaveStatus(
      count > 0
        ? `${count} objet${count > 1 ? "s" : ""} sélectionné${count > 1 ? "s" : ""}`
        : "Aucun objet dans la zone"
    );
    window.setTimeout(() => setSaveStatus(""), 2800);
  };

  /**
   * Arrow keys nudge whatever is selected. It follows the same rules as
   * dragging: locked objects stay put, a grouped object carries its group, and
   * an icon's anchor dot is left where it is so the leader line simply stretches.
  * Shift takes bigger steps, for coarse placement.
  */
  const nudgeSelection = (dx: number, dy: number) => {
    // Sheet blocks use the same keyboard gesture and history timeline as
    // objects drawn directly on the plan. Give the active sheet selection
    // priority in case a stale canvas selection still exists underneath it.
    if (selectedBlockId) {
      const block = sheetBlocks.find((item) => item.id === selectedBlockId);
      if (!block || block.locked) return false;

      historyDelayRef.current = NUDGE_HISTORY_COALESCE_MS;
      setSheetBlocks((current) => current.map((item) =>
        item.id === selectedBlockId
          ? { ...item, x: item.x + dx, y: item.y + dy }
          : item
      ));
      return true;
    }

    const iconIds = new Set(multiSelection.iconIds);
    const shapeIds = new Set(multiSelection.shapeIds);
    const textIds = new Set(multiSelection.textIds);
    if (selectedIconId) iconIds.add(selectedIconId);
    if (selectedShapeId) shapeIds.add(selectedShapeId);
    if (selectedTextId) textIds.add(selectedTextId);
    if (!iconIds.size && !shapeIds.size && !textIds.size) return false;

    // Anything grouped drags its whole group along, exactly as on the canvas.
    const groupIds = new Set<string>();
    icons.forEach((icon) => {
      if (iconIds.has(icon.tempId) && icon.object_group_id) groupIds.add(icon.object_group_id);
    });
    shapes.forEach((shape) => {
      if (shapeIds.has(shape.tempId) && shape.object_group_id) groupIds.add(shape.object_group_id);
    });
    texts.forEach((text) => {
      if (textIds.has(text.tempId) && text.object_group_id) groupIds.add(text.object_group_id);
    });

    const moves = (item: { tempId: string; object_group_id?: string; locked?: boolean }, ids: Set<string>) =>
      !item.locked && (ids.has(item.tempId) || Boolean(item.object_group_id && groupIds.has(item.object_group_id)));

    // Decided here, from the arrays already in scope. Reading a flag written
    // inside a setState updater would always come back false: React runs those
    // during the next render, not at the call site.
    const moved =
      icons.some((icon) => moves(icon, iconIds)) ||
      shapes.some((shape) => moves(shape, shapeIds)) ||
      texts.some((text) => moves(text, textIds));
    if (!moved) return false;

    historyDelayRef.current = NUDGE_HISTORY_COALESCE_MS;

    setIcons((current) => current.map((icon) => {
      if (!moves(icon, iconIds)) return icon;
      return { ...icon, x: icon.x + dx, y: icon.y + dy };
    }));
    setShapes((current) => current.map((shape) => {
      if (!moves(shape, shapeIds)) return shape;
      const next = { ...shape, x: shape.x + dx, y: shape.y + dy };
      // Polygons and polylines are drawn from absolute points, so the body of
      // the shape has to travel with its bounding box.
      if (shape.points?.length) {
        next.points = shape.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy }));
      }
      if (shape.control_points) {
        next.control_points = Object.fromEntries(
          Object.entries(shape.control_points).map(([index, point]) => [
            index,
            { ...point, x: point.x + dx, y: point.y + dy },
          ])
        );
      }
      return next;
    }));
    setTexts((current) => current.map((text) => {
      if (!moves(text, textIds)) return text;
      return { ...text, x: text.x + dx, y: text.y + dy };
    }));
    return true;
  };

  const handleGroupMultiSelection = () => {
    if (multiSelectionCount < 2) return;
    const groupId = sharedObjectGroupId || (
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `object-group-${crypto.randomUUID()}`
        : `object-group-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    );
    const iconIds = new Set(multiSelection.iconIds);
    const shapeIds = new Set(multiSelection.shapeIds);
    const textIds = new Set(multiSelection.textIds);
    setIcons((current) => current.map((icon) =>
      iconIds.has(icon.tempId) ? { ...icon, object_group_id: groupId } : icon
    ));
    setShapes((current) => current.map((shape) =>
      shapeIds.has(shape.tempId) ? { ...shape, object_group_id: groupId } : shape
    ));
    setTexts((current) => current.map((text) =>
      textIds.has(text.tempId) ? { ...text, object_group_id: groupId } : text
    ));
    setSaveStatus(`${multiSelectionCount} objets regroupés`);
    window.setTimeout(() => setSaveStatus(""), 2500);
  };

  const handleUngroupMultiSelection = () => {
    if (!selectedMultiObjectGroupIds.length) return;
    const groupIds = new Set(selectedMultiObjectGroupIds);
    setIcons((current) => current.map((icon) =>
      icon.object_group_id && groupIds.has(icon.object_group_id) ? { ...icon, object_group_id: "" } : icon
    ));
    setShapes((current) => current.map((shape) =>
      shape.object_group_id && groupIds.has(shape.object_group_id) ? { ...shape, object_group_id: "" } : shape
    ));
    setTexts((current) => current.map((text) =>
      text.object_group_id && groupIds.has(text.object_group_id) ? { ...text, object_group_id: "" } : text
    ));
    setSaveStatus("Groupe d’objets dissocié");
    window.setTimeout(() => setSaveStatus(""), 2500);
  };

  const selectedPlanGroupId = selectedOverlayId === MAIN_PLAN_ID
    ? mainPlanGroupId
    : selectedOverlay?.group_id || "";

  const pointInsidePlan = (
    point: { x: number; y: number },
    target: { x: number; y: number; width: number; height: number; rotation: number }
  ) => {
    const radians = (-target.rotation * Math.PI) / 180;
    const dx = point.x - target.x;
    const dy = point.y - target.y;
    const localX = dx * Math.cos(radians) - dy * Math.sin(radians);
    const localY = dx * Math.sin(radians) + dy * Math.cos(radians);
    return localX >= 0 && localY >= 0 && localX <= target.width && localY <= target.height;
  };

  const handleGroupSelectedPlan = () => {
    if (!selectedOverlayId) return;
    const natural = planCanvasRef.current?.getBackgroundDimensions() || { width: 0, height: 0 };
    const target = selectedOverlayId === MAIN_PLAN_ID
      ? {
          x: mainPlanTransform.x,
          y: mainPlanTransform.y,
          width: mainPlanTransform.width || natural.width,
          height: mainPlanTransform.height || natural.height,
          rotation: 0,
        }
      : selectedOverlay;
    if (!target || target.width <= 0 || target.height <= 0) {
      setSaveStatus("Dimensions du plan indisponibles");
      window.setTimeout(() => setSaveStatus(""), 2500);
      return;
    }

    const groupId = selectedPlanGroupId || (
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `plan-group-${crypto.randomUUID()}`
        : `plan-group-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    );
    let groupedCount = 0;
    const assignGroup = <T extends { group_id?: string }>(item: T, center: { x: number; y: number }): T => {
      if (pointInsidePlan(center, target)) {
        groupedCount += 1;
        return { ...item, group_id: groupId };
      }
      return item.group_id === groupId ? { ...item, group_id: "" } : item;
    };

    const groupedIcons = icons.map((icon) => assignGroup(icon, {
      x: icon.x + icon.width / 2,
      y: icon.y + icon.height / 2,
    }));
    const groupedShapes = shapes.map((shape) => {
      const center = shape.points?.length
        ? {
            x: shape.points.reduce((total, point) => total + point.x, 0) / shape.points.length,
            y: shape.points.reduce((total, point) => total + point.y, 0) / shape.points.length,
          }
        : { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
      return assignGroup(shape, center);
    });
    const groupedTexts = texts.map((text) => assignGroup(text, { x: text.x, y: text.y }));
    setIcons(groupedIcons);
    setShapes(groupedShapes);
    setTexts(groupedTexts);

    if (selectedOverlayId === MAIN_PLAN_ID) {
      setMainPlanGroupId(groupId);
      setMainPlanGroupingEnabled(true);
    } else {
      setPlanOverlays((current) => current.map((overlay) =>
        overlay.tempId === selectedOverlayId ? { ...overlay, group_id: groupId } : overlay
      ));
    }
    setSaveStatus(`${groupedCount} élément${groupedCount > 1 ? "s" : ""} regroupé${groupedCount > 1 ? "s" : ""} avec le plan`);
    window.setTimeout(() => setSaveStatus(""), 3000);
  };

  const handleUngroupSelectedPlan = () => {
    if (!selectedOverlayId || !selectedPlanGroupId) return;
    const groupId = selectedPlanGroupId;
    setIcons((current) => current.map((icon) => icon.group_id === groupId ? { ...icon, group_id: "" } : icon));
    setShapes((current) => current.map((shape) => shape.group_id === groupId ? { ...shape, group_id: "" } : shape));
    setTexts((current) => current.map((text) => text.group_id === groupId ? { ...text, group_id: "" } : text));
    if (selectedOverlayId === MAIN_PLAN_ID) {
      setMainPlanGroupId("");
      // Explicitly managed + empty means that the plan now moves independently.
      setMainPlanGroupingEnabled(true);
    } else {
      setPlanOverlays((current) => current.map((overlay) =>
        overlay.tempId === selectedOverlayId ? { ...overlay, group_id: "" } : overlay
      ));
    }
    setSaveStatus("Plan dissocié de ses éléments");
    window.setTimeout(() => setSaveStatus(""), 2500);
  };

  const hasLockableSelection = Boolean(
    selectedIcon ||
    selectedText ||
    selectedShape ||
    selectedBlock ||
    selectedOverlay ||
    selectedOverlayId === MAIN_PLAN_ID ||
    selectedBatBlock
  );
  const selectedObjectLocked = Boolean(
    selectedIcon?.locked ||
    selectedText?.locked ||
    selectedShape?.locked ||
    selectedBlock?.locked ||
    selectedOverlay?.locked ||
    (selectedOverlayId === MAIN_PLAN_ID && mainPlanLocked) ||
    (selectedBatBlock && watermarkConfig.block_locked)
  );

  const toggleSelectedObjectLock = () => {
    const locked = !selectedObjectLocked;
    if (selectedBatBlock) {
      setWatermarkConfig((current) => ({ ...current, block_locked: locked }));
    } else if (selectedOverlayId === MAIN_PLAN_ID) {
      setMainPlanLocked(locked);
    } else if (selectedOverlay) {
      setPlanOverlays((current) =>
        current.map((overlay) => overlay.tempId === selectedOverlay.tempId ? { ...overlay, locked } : overlay)
      );
    } else if (selectedBlock) {
      updateSelectedBlock({ locked });
    } else if (selectedIcon) {
      setIcons((current) =>
        current.map((icon) => icon.tempId === selectedIcon.tempId ? { ...icon, locked } : icon)
      );
    } else if (selectedText) {
      setTexts((current) =>
        current.map((text) => text.tempId === selectedText.tempId ? { ...text, locked } : text)
      );
    } else if (selectedShape) {
      setShapes((current) =>
        current.map((shape) => shape.tempId === selectedShape.tempId ? { ...shape, locked } : shape)
      );
    }
  };

  const openWatermarkSettings = () => {
    const today = new Date().toLocaleDateString("en-CA");
    setWatermarkDraft({
      ...watermarkConfig,
      date: watermarkConfig.date || today,
      client_logo: watermarkConfig.client_logo || exportClientLogo,
      creator_logo: watermarkConfig.creator_logo || exportStudioLogo,
    });
    setWatermarkModalOpen(true);
  };

  const setClientLogoForPlan = (source: string) => {
    setExportClientLogo(source);
    setWatermarkConfig((current) => ({ ...current, client_logo: source }));
    setLogoSettingsError("");
  };

  const setStudioLogoPreference = (source: string) => {
    const resolved = source || DEFAULT_STUDIO_LOGO;
    setExportStudioLogo(resolved);
    setWatermarkConfig((current) => ({ ...current, creator_logo: resolved }));
    storeStudioLogo(resolved);
    setLogoSettingsError("");
  };

  const importConfiguredLogo = async (target: "client" | "studio", file?: File) => {
    if (!file) return;
    setLogoSettingsError("");
    try {
      const source = await prepareLogoFile(file);
      if (target === "client") {
        setClientLogoForPlan(source);
        setSaveStatus("Logo client modifié — sauvegardez le plan");
      } else {
        setStudioLogoPreference(source);
        setSaveStatus("Logo studio mémorisé pour les prochains plans");
      }
      window.setTimeout(() => setSaveStatus(""), 3500);
    } catch (error) {
      setLogoSettingsError(error instanceof Error ? error.message : "Impossible d’importer le logo.");
    }
  };

  const applyWatermarkSettings = () => {
    const next = {
      ...watermarkDraft,
      enabled: true,
      creator_logo: watermarkDraft.creator_logo || DEFAULT_STUDIO_LOGO,
    };
    setWatermarkConfig(next);
    setExportClientLogo(next.client_logo);
    setExportStudioLogo(next.creator_logo);
    storeStudioLogo(next.creator_logo);
    setWatermarkModalOpen(false);
  };

  const disableWatermark = () => {
    setWatermarkConfig((current) => ({ ...current, enabled: false }));
    setSelectedBatBlock(false);
  };

  const fileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error(`Impossible de lire ${file.name}`));
      reader.readAsDataURL(file);
    });

  const importOverlayFile = async (file: File) => {
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const pageCount = Math.min(pdf.numPages, 20);
      const pages: Array<{ url: string; width: number; height: number; label: string }> = [];

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const renderScale = Math.min(
          2.5,
          MAX_CANVAS_SIDE / Math.max(baseViewport.width, baseViewport.height),
          Math.sqrt(MAX_CANVAS_PIXELS / (baseViewport.width * baseViewport.height))
        );
        const viewport = page.getViewport({ scale: Math.max(0.1, renderScale) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas PDF indisponible");
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        pages.push({
          url: canvas.toDataURL("image/png"),
          width: baseViewport.width,
          height: baseViewport.height,
          label: pdf.numPages > 1 ? `${file.name} — page ${pageNumber}` : file.name,
        });
        releaseCanvas(canvas);
      }
      if (pdf.numPages > pageCount) {
        alert(`Le PDF ${file.name} contient ${pdf.numPages} pages. Les 20 premières ont été importées.`);
      }
      return pages;
    }

    // Rasterize every browser-supported image to a bounded PNG. This gives the
    // persistence endpoint one predictable format (including for SVG/GIF/WebP)
    // and prevents an enormous source image from reaching the server unchanged.
    const sourceUrl = await fileAsDataUrl(file);
    const image = await loadImage(sourceUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const canvas = drawImageToCanvas(image);
    try {
      return [{ url: canvas.toDataURL("image/png"), width, height, label: file.name }];
    } finally {
      releaseCanvas(canvas);
    }
  };

  const handleAddPlanOverlayFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;

    setImportingOverlays(true);
    setSaveStatus("Import des plans...");
    try {
      const imported: Array<{ url: string; width: number; height: number; label: string }> = [];
      for (const file of files) {
        imported.push(...await importOverlayFile(file));
      }
      const baseCount = planOverlays.length;
      const firstZIndex = getNextLayerZIndex();
      const newOverlays: CanvasPlanOverlay[] = imported.map((item, index) => {
        const aspect = item.width / Math.max(1, item.height);
        const initialWidth = 450;
        return {
          tempId: `plan-overlay-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
          url: item.url,
          x: 120 + (baseCount + index) * 40,
          y: 120 + (baseCount + index) * 40,
          width: initialWidth,
          height: Math.max(40, Math.round(initialWidth / aspect)),
          rotation: 0,
          label: item.label,
          locked: false,
          visible: true,
          z_index: firstZIndex + index * 10,
          imageChanged: true,
          isOriginal: true,
          canRevertOriginal: false,
        };
      });
      setPlanOverlays((current) => [...current, ...newOverlays]);
      setSelectedOverlayId(newOverlays.at(-1)?.tempId ?? null);
      setSaveStatus(`${newOverlays.length} plan${newOverlays.length > 1 ? "s" : ""} importé${newOverlays.length > 1 ? "s" : ""}`);
      window.setTimeout(() => setSaveStatus(""), 3000);
    } catch (error) {
      console.error("Plan overlay import failed:", error);
      alert(error instanceof Error ? error.message : "Impossible d’importer les plans sélectionnés.");
      setSaveStatus("Erreur d’import");
    } finally {
      setImportingOverlays(false);
    }
  };

  /** Returns true when a secondary plan was actually removed. */
  const handleDeleteSelectedOverlay = () => {
    if (!selectedOverlayId || selectedOverlayId === MAIN_PLAN_ID) return false;
    if (planOverlays.find((overlay) => overlay.tempId === selectedOverlayId)?.locked) return false;
    setPlanOverlays((overlays) =>
      overlays.filter((item) => {
        if (item.tempId !== selectedOverlayId) return true;
        if (item.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
        return false;
      })
    );
    if (selectedCleanTargetId === selectedOverlayId) setSelectedCleanTargetId(MAIN_PLAN_ID);
    setSelectedOverlayId(null);
    return true;
  };

  // Suppr./Retour arrière removes the selected secondary plan. Its own listener,
  // so it always sees the current selection instead of the first render's.
  useEffect(() => {
    if (!selectedOverlayId || selectedOverlayId === MAIN_PLAN_ID) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      handleDeleteSelectedOverlay();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const readStoredSheetTemplateVersions = (): StoredSheetTemplateVersion[] => {
    if (typeof window === "undefined" || !user) return [];
    try {
      const accountKey = `${SHEET_TEMPLATE_STORAGE_KEY}:user:${user.id}`;
      const accountRaw = window.localStorage.getItem(accountKey);
      const accountParsed = accountRaw ? JSON.parse(accountRaw) : [];
      const accountVersions = Array.isArray(accountParsed) ? accountParsed : [];
      const globalRaw = window.localStorage.getItem(SHEET_TEMPLATE_STORAGE_KEY);
      const globalParsed = globalRaw ? JSON.parse(globalRaw) : [];
      const globalVersions = Array.isArray(globalParsed) ? globalParsed : [];
      const legacyKey = `${LEGACY_SHEET_TEMPLATE_STORAGE_PREFIX}:${id}`;
      const legacyRaw = window.localStorage.getItem(legacyKey);
      const legacyParsed = legacyRaw ? JSON.parse(legacyRaw) : [];
      const legacyVersions = Array.isArray(legacyParsed) ? legacyParsed : [];
      const byId = new Map<string, StoredSheetTemplateVersion>();
      [...globalVersions, ...legacyVersions, ...accountVersions].forEach((version) => {
        if (version?.id && version?.template && Array.isArray(version.blocks)) {
          byId.set(version.id, version);
        }
      });
      const merged = Array.from(byId.values());
      window.localStorage.setItem(accountKey, JSON.stringify(merged));
      // The two old keys were not account-scoped. Move them once into the
      // currently authenticated account so another login cannot inherit them.
      window.localStorage.removeItem(SHEET_TEMPLATE_STORAGE_KEY);
      window.localStorage.removeItem(legacyKey);
      return merged;
    } catch {
      return [];
    }
  };

  const cacheSheetTemplateVersions = (versions: StoredSheetTemplateVersion[]) => {
    setStoredSheetTemplateVersions(versions);
    if (typeof window === "undefined" || !user) return;
    window.localStorage.setItem(
      `${SHEET_TEMPLATE_STORAGE_KEY}:user:${user.id}`,
      JSON.stringify(versions)
    );
  };

  const syncSheetTemplateVersionsToServer = (versions: StoredSheetTemplateVersion[]) => {
    pendingTemplateServerSyncRef.current = JSON.parse(
      JSON.stringify(versions)
    ) as StoredSheetTemplateVersion[];
    if (templateServerSyncRunningRef.current) return;

    templateServerSyncRunningRef.current = true;
    void (async () => {
      while (pendingTemplateServerSyncRef.current) {
        const pending = pendingTemplateServerSyncRef.current;
        pendingTemplateServerSyncRef.current = null;
        try {
          const response = await fetch(buildApiUrl("/api/plans/sheet-templates/"), {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              ...getPlanAuthHeaders(),
            },
            body: JSON.stringify({ versions: pending }),
          });
          if (!response.ok) throw new Error(await describeApiError(response));
        } catch (error) {
          // Keep the browser copy intact. A later edit or editor reload will
          // retry it, so working offline never destroys a template.
          pendingTemplateServerSyncRef.current ??= pending;
          console.warn("Template server sync failed; local cache kept:", error);
          break;
        }
      }
    })().finally(() => {
      templateServerSyncRunningRef.current = false;
    });
  };

  const writeStoredSheetTemplateVersions = (versions: StoredSheetTemplateVersion[]) => {
    cacheSheetTemplateVersions(versions);
    syncSheetTemplateVersionsToServer(versions);
  };

  const cloneSheetBlocks = (blocks: SheetBlock[]) =>
    JSON.parse(JSON.stringify(blocks)) as SheetBlock[];

  const saveTemplateDraft = (
    template: SheetTemplateKey | "none" = sheetTemplate,
    blocks: SheetBlock[] = sheetBlocks,
    placement = sheetPlanPlacement
  ) => {
    if (template === "none" || !blocks.length) return;
    const versions = readStoredSheetTemplateVersions();
    const now = new Date().toISOString();
    const draftId = `draft:${template}`;
    const existing = versions.find((version) => version.id === draftId);
    const draft: StoredSheetTemplateVersion = {
      id: draftId,
      template,
      name: `Dernière modification - ${SHEET_TEMPLATES[template].label}`,
      blocks: cloneSheetBlocks(blocks),
      planPlacement: { ...placement },
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const nextVersions = [
      ...versions.filter((version) => version.id !== draftId),
      draft,
    ];
    writeStoredSheetTemplateVersions(nextVersions);
    if (!activeSheetTemplateVersionId || activeSheetTemplateVersionId.startsWith("draft:")) {
      setActiveSheetTemplateVersionId(draftId);
    }
  };

  const getSavedTemplateDraft = (template: SheetTemplateKey) =>
    readStoredSheetTemplateVersions().find((version) => version.id === `draft:${template}`);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    const localVersions = readStoredSheetTemplateVersions();
    cacheSheetTemplateVersions(localVersions);

    const loadServerVersions = async () => {
      try {
        const response = await fetch(buildApiUrl("/api/plans/sheet-templates/"), {
          headers: getPlanAuthHeaders(),
          cache: "no-store",
        });
        if (!response.ok) throw new Error(await describeApiError(response));
        const payload = await response.json();
        const serverVersions = Array.isArray(payload)
          ? payload.filter((version): version is StoredSheetTemplateVersion => (
              Boolean(version)
              && typeof version.id === "string"
              && typeof version.template === "string"
              && typeof version.name === "string"
              && Array.isArray(version.blocks)
              && typeof version.planPlacement === "object"
              && typeof version.createdAt === "string"
              && typeof version.updatedAt === "string"
            ))
          : [];

        // Re-read just before merging: the user may have edited a template
        // while the server request was in flight.
        const currentLocalVersions = readStoredSheetTemplateVersions();
        const mergedById = new Map(currentLocalVersions.map((version) => [version.id, version]));
        serverVersions.forEach((serverVersion) => {
          const localVersion = mergedById.get(serverVersion.id);
          const localUpdatedAt = Date.parse(localVersion?.updatedAt || "");
          const serverUpdatedAt = Date.parse(serverVersion.updatedAt);
          if (
            !localVersion
            || !Number.isFinite(localUpdatedAt)
            || !Number.isFinite(serverUpdatedAt)
            || serverUpdatedAt >= localUpdatedAt
          ) {
            mergedById.set(serverVersion.id, serverVersion);
          }
        });
        const mergedVersions = Array.from(mergedById.values());
        if (cancelled) return;
        cacheSheetTemplateVersions(mergedVersions);

        const canonical = (versions: StoredSheetTemplateVersion[]) => JSON.stringify(
          [...versions].sort((left, right) => left.id.localeCompare(right.id))
        );
        if (canonical(mergedVersions) !== canonical(serverVersions)) {
          syncSheetTemplateVersionsToServer(mergedVersions);
        }
      } catch (error) {
        // Offline/server failure: the local cache remains fully usable and will
        // be migrated on the next successful editor load.
        console.warn("Template server load failed; local cache used:", error);
      }
    };

    void loadServerVersions();
    return () => {
      cancelled = true;
    };
  }, [id, authLoading, token, user?.id]);

  useEffect(() => {
    if (sheetTemplate === "none" || !sheetBlocks.length) return;
    const timer = window.setTimeout(() => {
      saveTemplateDraft(sheetTemplate, sheetBlocks, sheetPlanPlacement);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [sheetTemplate, sheetBlocks, sheetPlanPlacement, id, activeSheetTemplateVersionId]);

  const saveCurrentSheetTemplateVersion = () => {
    if (sheetTemplate === "none" || !sheetBlocks.length) return;
    const defaultName = `${SHEET_TEMPLATES[sheetTemplate].label} - version ${new Date().toLocaleDateString("fr-FR")}`;
    const name = window.prompt("Nom de la nouvelle version du template :", defaultName);
    if (!name?.trim()) return;
    const versions = readStoredSheetTemplateVersions();
    const now = new Date().toISOString();
    const version: StoredSheetTemplateVersion = {
      id: typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `version:${crypto.randomUUID()}`
        : `version:${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      template: sheetTemplate,
      name: name.trim(),
      blocks: cloneSheetBlocks(sheetBlocks),
      planPlacement: { ...sheetPlanPlacement },
      createdAt: now,
      updatedAt: now,
    };
    writeStoredSheetTemplateVersions([...versions, version]);
    setActiveSheetTemplateVersionId(version.id);
    setSaveStatus("Version du template enregistrée");
    window.setTimeout(() => setSaveStatus(""), 2500);
  };

  const applyStoredSheetTemplateVersion = (versionId: string) => {
    if (!versionId) {
      setActiveSheetTemplateVersionId("");
      return;
    }
    const version = readStoredSheetTemplateVersions().find((item) => item.id === versionId);
    if (!version) return;
    saveTemplateDraft();
    setSheetTemplate(version.template);
    const templateConfig = SHEET_TEMPLATES[version.template];
    if ("paper" in templateConfig) {
      setExportPaperFormat(templateConfig.paper as ExportPaperFormat);
    }
    setSheetBlocks(cloneSheetBlocks(version.blocks));
    setSheetPlanPlacement({ ...version.planPlacement });
    setActiveSheetTemplateVersionId(version.id);
    setAreaSelectionMode(false);
    setMultiSelection({ iconIds: [], shapeIds: [], textIds: [] });
    setSelectedBlockId(null);
    window.setTimeout(() => setFitSignal((signal) => signal + 1), 60);
  };

  const deleteCurrentSheetTemplateVersion = () => {
    if (!activeSheetTemplateVersionId || activeSheetTemplateVersionId.startsWith("draft:")) return;
    if (!window.confirm("Supprimer cette version de template ?")) return;
    const versions = readStoredSheetTemplateVersions().filter((version) => version.id !== activeSheetTemplateVersionId);
    writeStoredSheetTemplateVersions(versions);
    setActiveSheetTemplateVersionId("");
    setSaveStatus("Version du template supprimée");
    window.setTimeout(() => setSaveStatus(""), 2500);
  };

  const applySheetTemplate = (template: SheetTemplateKey | "none", options: { reset?: boolean } = {}) => {
    saveTemplateDraft();
    setSheetTemplate(template);
    setExportOfficialFond("none");
    setAreaSelectionMode(false);
    setMultiSelection({ iconIds: [], shapeIds: [], textIds: [] });
    setSelectedBlockId(null);
    setActiveSheetTemplateVersionId("");
    if (template === "none") {
      setSheetBlocks([]);
      return;
    }
    const templateConfig = SHEET_TEMPLATES[template];
    if ("paper" in templateConfig) {
      setExportPaperFormat(templateConfig.paper as ExportPaperFormat);
    }
    const savedDraft = options.reset ? null : getSavedTemplateDraft(template);
    if (savedDraft) {
      setSheetBlocks(cloneSheetBlocks(savedDraft.blocks));
      setSheetPlanPlacement({ ...savedDraft.planPlacement });
      setActiveSheetTemplateVersionId(savedDraft.id);
      window.setTimeout(() => setFitSignal((signal) => signal + 1), 60);
      return;
    }
    setSheetBlocks(
      createSheetBlocks(template, {
        // A title the user typed is carried over; an untouched preset is not, so
        // the template keeps its own regulatory wording.
        planTitle: isUntouchedExportTitle(exportPlanTitle) ? undefined : exportPlanTitle,
        siteName: exportSiteName || plan?.building_name || ""
      })
    );
    setSheetPlanPlacement({ scale: 100, offsetX: 0, offsetY: 0 });
    // Frame the whole page as soon as it appears.
    window.setTimeout(() => setFitSignal((signal) => signal + 1), 60);
  };

  // Logo fields belong to the saved project state. Keeping the export preview
  // derived from them also makes undo/redo restore the correct artwork.
  useEffect(() => {
    setExportClientLogo(watermarkConfig.client_logo || "");
    setExportStudioLogo(watermarkConfig.creator_logo || getStoredStudioLogo());
  }, [watermarkConfig.client_logo, watermarkConfig.creator_logo]);

  // Logos live as data URLs in the export settings; the sheet needs them decoded.
  useEffect(() => {
    let cancelled = false;
    const decode = async (src: string) => {
      if (!src) return null;
      try {
        return await loadImage(src);
      } catch {
        return null;
      }
    };

    void Promise.all([decode(exportClientLogo), decode(exportStudioLogo)]).then(([client, studio]) => {
      if (cancelled) return;
      setSheetLogoImages((current) => ({ ...current, clientLogo: client, studioLogo: studio }));
    });

    return () => {
      cancelled = true;
    };
  }, [exportClientLogo, exportStudioLogo]);

  // Pictogram artwork for the legend rows and for the pictograms dropped on the
  // sheet itself. Loaded once per icon type, then reused.
  const sheetPictoTypes = useMemo(
    () =>
      Array.from(
        new Set(
          sheetBlocks
            .filter((block) => block.kind === "picto" && block.iconType)
            .map((block) => block.iconType as IconType)
        )
      ),
    [sheetBlocks]
  );
  const usedIconTypesKey = Array.from(new Set([...usedIconTypes, ...sheetPictoTypes])).join("|");
  useEffect(() => {
    if (!sheetActive) return;
    let cancelled = false;

    void Promise.all(
      usedIconTypesKey.split("|").filter(Boolean).map(async (type) => {
        const src = getIconImageSource(type as IconType, iconDefinitions);
        if (!src) return null;
        try {
          return { type, image: await loadImage(src) };
        } catch {
          return null;
        }
      })
    ).then((results) => {
      if (cancelled) return;
      setSheetLegendImages((current) => {
        const next = { ...current };
        results.forEach((entry) => {
          if (entry) next[entry.type] = entry.image;
        });
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetActive, usedIconTypesKey, iconDefinitions]);

  const sheetLegendEntries: SheetLegendEntry[] = useMemo(
    () =>
      usedIconTypes.map((type) => ({
        type,
        label: iconDefinitions[type]?.label || String(type),
        image: sheetLegendImages[type] ?? null
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [usedIconTypesKey, iconDefinitions, sheetLegendImages]
  );

  /** A pictogram dropped on the page rather than on the drawing. */
  const handlePlaceSheetIcon = (type: IconType, x: number, y: number) => {
    const block = createPictoBlock(type, iconDefinitions[type]?.label || String(type), x, y);
    setSheetBlocks((blocks) => [...blocks, block]);
    setSelectedBlockId(block.id);
    setPlacementIconType(null);
  };

  /** A text placed outside the plan window belongs to the printed sheet. */
  const handlePlaceSheetText = (x: number, y: number) => {
    const block = createFreeTextBlock(
      sheetBlocks.length + 1,
      activeSheetSize.width,
      activeSheetSize.height
    );
    block.x = Math.round(Math.max(0, Math.min(activeSheetSize.width - block.width, x - block.width / 2)));
    block.y = Math.round(Math.max(0, Math.min(activeSheetSize.height - block.height, y - block.height / 2)));
    setSheetBlocks((blocks) => [...blocks, block]);
    setSelectedBlockId(block.id);
    setPlacementText(false);
  };

  /** Convert drawing coordinates into a self-contained, resizable sheet block. */
  const handlePlaceSheetShape = (shape: CanvasShape) => {
    const isPath = isPolygonShape(shape.shape_type) || shape.shape_type === "line";
    const absolutePoints = shape.points?.length
      ? shape.points
      : shape.shape_type === "line"
        ? [
            { x: shape.x, y: shape.y },
            { x: shape.x + shape.width, y: shape.y + shape.height }
          ]
        : [];
    const naturalBounds = isPath
      ? boundsFromPoints(absolutePoints)
      : { x: shape.x, y: shape.y, width: Math.abs(shape.width), height: Math.abs(shape.height) };
    // A perfectly horizontal or vertical line still needs a small selectable
    // bounding box. The line itself remains centred inside that box.
    const width = Math.max(4, naturalBounds.width);
    const height = Math.max(4, naturalBounds.height);
    const x = naturalBounds.x - (width - naturalBounds.width) / 2;
    const y = naturalBounds.y - (height - naturalBounds.height) / 2;
    const shapeNumber = sheetBlocks.filter((block) => block.kind === "shape").length + 1;
    const labels: Record<ShapeKind, string> = {
      line: "Ligne",
      rect: "Rectangle",
      circle: "Cercle",
      zone: "Zone",
      polyline: "Polyligne",
      polygon_zone: "Zone polygone",
      free_polygon_zone: "Zone libre",
      curve_polygon_zone: "Zone courbe"
    };
    const closedPath = isPolygonShape(shape.shape_type) && shape.shape_type !== "polyline";
    const block: SheetBlock = {
      id: `sheet-shape-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      kind: "shape",
      label: `${labels[shape.shape_type]} ${shapeNumber}`,
      x: Math.round(x),
      y: Math.round(y),
      width,
      height,
      rotation: shape.rotation,
      visible: true,
      shapeType: shape.shape_type,
      shapePoints: absolutePoints.map((point) => ({
        x: (point.x - x) / width,
        y: (point.y - y) / height
      })),
      shapeTension: shape.shape_type === "curve_polygon_zone" ? shape.tension ?? 0.35 : shape.tension,
      stroke: shape.color,
      strokeWidth: shape.stroke_width,
      fill:
        shape.shape_type === "zone" || closedPath
          ? shape.fill_color || shape.color
          : shape.fill_color || undefined,
      fillOpacity: shape.fill_opacity ?? (shape.shape_type === "zone" ? 0.28 : closedPath ? 0.35 : undefined)
    };

    setSheetBlocks((blocks) => [...blocks, block]);
    setSelectedBlockId(block.id);
    setSelectedIconId(null);
    setSelectedShapeId(null);
    setSelectedTextId(null);
    setSelectedOverlayId(null);
    setMultiSelection({ iconIds: [], shapeIds: [], textIds: [] });
  };

  const handleUpdateSelectedIcon = (field: keyof CanvasIcon, value: any) => {
    if (!selectedIconId) return;
    if ((field === "width" || field === "height") && Number.isFinite(value)) {
      setDefaultIconSize((currentSize) => ({
        ...currentSize,
        [field]: Math.max(15, Number(value)),
      }));
    }
    setIcons(
      icons.map((icon) => {
        if (icon.tempId === selectedIconId) {
          return { ...icon, [field]: value };
        }
        return icon;
      })
    );
  };

  const handleDeleteSelected = () => {
    if (!selectedIconId) return;
    if (selectedIcon?.locked) return;
    setIcons(icons.filter((i) => i.tempId !== selectedIconId));
    setSelectedIconId(null);
  };

  // ── Pictogram offset (leader line) ────────────────────────────────────────
  // In a cramped corridor the symbol cannot sit on the equipment without becoming
  // unreadable. Offsetting keeps the position exact — a dot stays on the spot —
  // while the pictogram moves into free space, joined by a thin line.
  const OFFSET_STEP = 70;

  const handleOffsetIcon = () => {
    if (!selectedIcon) return;

    const anchorX = selectedIcon.x + selectedIcon.width / 2;
    const anchorY = selectedIcon.y + selectedIcon.height / 2;

    setIcons((currentIcons) =>
      currentIcons.map((icon) =>
        icon.tempId === selectedIcon.tempId
          ? {
              ...icon,
              anchor_x: anchorX,
              anchor_y: anchorY,
              // Move the symbol clear of its anchor so the leader is visible at once.
              x: icon.x + OFFSET_STEP,
              y: icon.y - OFFSET_STEP
            }
          : icon
      )
    );
  };

  const handleClearIconOffset = () => {
    if (!selectedIcon || selectedIcon.anchor_x == null || selectedIcon.anchor_y == null) return;

    const anchorX = selectedIcon.anchor_x;
    const anchorY = selectedIcon.anchor_y;

    setIcons((currentIcons) =>
      currentIcons.map((icon) =>
        icon.tempId === selectedIcon.tempId
          ? {
              ...icon,
              // Put the pictogram back on the equipment it was pointing at.
              x: anchorX - icon.width / 2,
              y: anchorY - icon.height / 2,
              anchor_x: null,
              anchor_y: null
            }
          : icon
      )
    );
  };

  // ── Icon clipboard ────────────────────────────────────────────────────────
  // Kept in localStorage rather than component state so an icon copied on one
  // plan can be pasted onto another at the very same coordinates — the point
  // when several floors of a building share equipment positions.
  const makeIconTempId = () =>
    `icon-new-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const readIconClipboard = (): CanvasIcon | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(ICON_CLIPBOARD_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.icon_type !== "string") return null;
      return parsed as CanvasIcon;
    } catch {
      return null;
    }
  };

  const handleCopyIcon = () => {
    if (!selectedIcon) return;
    try {
      window.localStorage.setItem(
        ICON_CLIPBOARD_KEY,
        JSON.stringify({
          icon_type: selectedIcon.icon_type,
          x: selectedIcon.x,
          y: selectedIcon.y,
          width: selectedIcon.width,
          height: selectedIcon.height,
          rotation: selectedIcon.rotation,
          label: selectedIcon.label
        })
      );
      setClipboardHasIcon(true);
      setSaveStatus("Icône copiée");
      window.setTimeout(() => setSaveStatus(""), 1800);
    } catch (err) {
      console.error("Icon copy failed:", err);
    }
  };

  /** Pastes at the stored coordinates; `offset` nudges it so it stays visible. */
  const pasteIconFromClipboard = (offset = 0) => {
    const source = readIconClipboard();
    if (!source) return;

    const pasted: CanvasIcon = {
      tempId: makeIconTempId(),
      icon_type: source.icon_type,
      x: Math.max(0, source.x + offset),
      y: Math.max(0, source.y + offset),
      width: source.width,
      height: source.height,
      rotation: source.rotation ?? 0,
      label: source.label ?? "",
      visible: true,
      z_index: getNextLayerZIndex(),
    };

    setIcons((currentIcons) => [...currentIcons, pasted]);
    setSelectedIconId(pasted.tempId);
    setMode("select");
  };

  const handleDuplicateIcon = () => {
    if (!selectedIcon) return;
    const duplicate: CanvasIcon = {
      ...selectedIcon,
      tempId: makeIconTempId(),
      id: undefined,
      x: selectedIcon.x + 16,
      y: selectedIcon.y + 16,
      visible: true,
      z_index: getNextLayerZIndex(),
    };
    setIcons((currentIcons) => [...currentIcons, duplicate]);
    setSelectedIconId(duplicate.tempId);
  };

  // Arrow keys nudge the selection. Its own listener with no dependency array so
  // it always reads the current selection, like the other editor shortcuts here.
  useEffect(() => {
    const NUDGE_STEP = 1;
    const NUDGE_STEP_COARSE = 10;
    const DELTAS: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const delta = DELTAS[event.key];
      if (!delta) return;
      // Ctrl/⌘ and Alt belong to the browser and to the canvas' own shortcuts.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const element = event.target as HTMLElement | null;
      if (
        element &&
        (element.tagName === "INPUT" ||
          element.tagName === "TEXTAREA" ||
          element.tagName === "SELECT" ||
          element.isContentEditable)
      ) {
        return;
      }

      const step = event.shiftKey ? NUDGE_STEP_COARSE : NUDGE_STEP;
      // Only swallow the arrow key when something actually moved, so the page
      // keeps its normal keyboard behaviour when nothing is selected.
      if (nudgeSelection(delta[0] * step, delta[1] * step)) event.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // Clipboard shortcuts. Kept apart from the tool shortcuts, which deliberately
  // ignore events carrying a modifier key.
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      return (
        element.tagName === "INPUT" ||
        element.tagName === "TEXTAREA" ||
        element.tagName === "SELECT" ||
        element.isContentEditable
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === "c" && selectedIcon) {
        event.preventDefault();
        handleCopyIcon();
      } else if (key === "v") {
        event.preventDefault();
        pasteIconFromClipboard(0);
      } else if (key === "d" && selectedIcon) {
        event.preventDefault();
        handleDuplicateIcon();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  /**
   * The sheet's own settings: the site name and the logos the studio template
   * draws. The export no longer goes through this dialog — it captures the
   * studio directly — but these fields still feed the sheet, so they keep a
   * way in of their own.
   */
  const openSheetSettings = () => {
    setExportSiteName((current) => current || plan?.building_name || "");
    setExportClientLogo((current) => current || watermarkConfig.client_logo);
    setExportStudioLogo((current) => current || getStoredStudioLogo(watermarkConfig.creator_logo || DEFAULT_STUDIO_LOGO));
    setLogoSettingsError("");
    setExportModalOpen(true);
  };

  const drawWrappedText = (
    context: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number
  ) => {
    const paragraphs = text.split("\n");
    let currentY = y;

    paragraphs.forEach((paragraph) => {
      if (!paragraph.trim()) {
        currentY += lineHeight;
        return;
      }

      const words = paragraph.split(" ");
      let line = "";
      words.forEach((word) => {
        const testLine = line ? `${line} ${word}` : word;
        if (context.measureText(testLine).width > maxWidth && line) {
          context.fillText(line, x, currentY);
          line = word;
          currentY += lineHeight;
        } else {
          line = testLine;
        }
      });
      context.fillText(line, x, currentY);
      currentY += lineHeight;
    });
  };

  const getCanvasWrappedLines = (
    context: CanvasRenderingContext2D,
    text: string,
    maxWidth: number
  ) => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [text];

    const lines: string[] = [];
    let line = "";

    words.forEach((word) => {
      const testLine = line ? `${line} ${word}` : word;
      if (context.measureText(testLine).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = testLine;
      }
    });

    if (line) lines.push(line);
    return lines;
  };

  // Longest edge used when hunting for the plan's bounding box. Scanning the full
  // resolution meant tens of millions of per-pixel iterations on a large plan,
  // which froze the export preview; a downscaled pass is visually identical here
  // because the result only feeds a crop rectangle.
  const TRIM_SCAN_MAX_EDGE = 700;

  const trimWhiteMargins = (image: HTMLImageElement): HTMLImageElement | HTMLCanvasElement => {
    if (!image.width || !image.height) return image;

    const scanScale = Math.min(1, TRIM_SCAN_MAX_EDGE / Math.max(image.width, image.height));
    const scanWidth = Math.max(1, Math.round(image.width * scanScale));
    const scanHeight = Math.max(1, Math.round(image.height * scanScale));

    const scanCanvas = document.createElement("canvas");
    scanCanvas.width = scanWidth;
    scanCanvas.height = scanHeight;
    const scanContext = scanCanvas.getContext("2d", { willReadFrequently: true });
    if (!scanContext) return image;

    scanContext.drawImage(image, 0, 0, scanWidth, scanHeight);
    const pixels = scanContext.getImageData(0, 0, scanWidth, scanHeight).data;

    let minX = scanWidth;
    let minY = scanHeight;
    let maxX = 0;
    let maxY = 0;

    for (let y = 0; y < scanHeight; y++) {
      for (let x = 0; x < scanWidth; x++) {
        const index = (y * scanWidth + x) * 4;
        const isWhite =
          pixels[index] > 245 && pixels[index + 1] > 245 && pixels[index + 2] > 245;

        if (pixels[index + 3] > 0 && !isWhite) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (minX >= maxX || minY >= maxY) return image;

    // Back to full resolution, with a margin that also absorbs the scan's rounding.
    const factorX = image.width / scanWidth;
    const factorY = image.height / scanHeight;
    const padding = 24;
    const cropX = Math.max(0, Math.floor(minX * factorX) - padding);
    const cropY = Math.max(0, Math.floor(minY * factorY) - padding);
    const cropW = Math.min(
      image.width - cropX,
      Math.ceil((maxX - minX + 1) * factorX) + padding * 2
    );
    const cropH = Math.min(
      image.height - cropY,
      Math.ceil((maxY - minY + 1) * factorY) + padding * 2
    );

    const trimmedCanvas = document.createElement("canvas");
    trimmedCanvas.width = cropW;
    trimmedCanvas.height = cropH;
    const trimmedContext = trimmedCanvas.getContext("2d");
    if (!trimmedContext) return image;

    trimmedContext.fillStyle = "#ffffff";
    trimmedContext.fillRect(0, 0, cropW, cropH);
    trimmedContext.drawImage(image, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    return trimmedCanvas;
  };

  /** Largest font size at which the title still fits the band, down to a floor. */
  const fitTitleFontSize = (
    context: CanvasRenderingContext2D,
    title: string,
    maxWidth: number,
    startSize: number
  ) => {
    let size = startSize;
    while (size > 18) {
      context.font = `800 ${size}px ${EXPORT_FONT}`;
      if (context.measureText(title).width <= maxWidth) break;
      size -= 1;
    }
    return size;
  };

  const tracePath = (
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ) => {
    const limit = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + limit, y);
    context.arcTo(x + width, y, x + width, y + height, limit);
    context.arcTo(x + width, y + height, x, y + height, limit);
    context.arcTo(x, y + height, x, y, limit);
    context.arcTo(x, y, x + width, y, limit);
    context.closePath();
  };

  /** Draws text with optional tracking, restoring the context state afterwards. */
  const drawTrackedText = (
    context: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    spacing: string
  ) => {
    const spaced = context as CanvasRenderingContext2D & { letterSpacing?: string };
    const previous = spaced.letterSpacing;
    if (previous !== undefined) spaced.letterSpacing = spacing;
    context.fillText(text, x, y);
    if (previous !== undefined) spaced.letterSpacing = previous;
  };

  /** White card with a coloured title strip — the shared shell for every side block. */
  const drawCard = (
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    title: string,
    accent: string
  ) => {
    context.save();
    context.shadowColor = "rgba(12, 42, 28, 0.16)";
    context.shadowBlur = 14;
    context.shadowOffsetY = 4;
    context.fillStyle = "#ffffff";
    tracePath(context, x, y, width, height, EXPORT_CARD_RADIUS);
    context.fill();
    context.restore();

    context.save();
    tracePath(context, x, y, width, height, EXPORT_CARD_RADIUS);
    context.clip();
    context.fillStyle = accent;
    context.fillRect(x, y, width, EXPORT_CARD_HEADER_H);
    context.restore();

    context.strokeStyle = "rgba(12, 42, 28, 0.16)";
    context.lineWidth = 1.5;
    tracePath(context, x, y, width, height, EXPORT_CARD_RADIUS);
    context.stroke();

    context.save();
    context.fillStyle = "#ffffff";
    context.font = `700 16px ${EXPORT_FONT}`;
    context.textBaseline = "middle";
    drawTrackedText(context, title.toUpperCase(), x + 16, y + EXPORT_CARD_HEADER_H / 2 + 1, "0.06em");
    context.restore();
  };

  /** Height the body would need at a given size, honouring blank lines as spacers. */
  const measureBodyHeight = (
    context: CanvasRenderingContext2D,
    body: string,
    maxWidth: number,
    fontSize: number
  ) => {
    context.font = `400 ${fontSize}px ${EXPORT_FONT}`;
    const lineHeight = Math.round(fontSize * 1.42);
    const lineCount = body.split("\n").reduce((total, paragraph) => {
      if (!paragraph.trim()) return total + 1;
      return total + getCanvasWrappedLines(context, paragraph, maxWidth).length;
    }, 0);
    return { lineHeight, height: lineCount * lineHeight };
  };

  const drawPanel = (
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    title: string,
    body: string,
    fontSize = 17,
    accent = "#168f5a"
  ) => {
    drawCard(context, x, y, width, height, title, accent);

    const bodyTop = y + EXPORT_CARD_HEADER_H;
    const maxWidth = width - 34;
    const available = height - EXPORT_CARD_HEADER_H - 30;

    // Shrink the body until it fits: a safety notice must never be truncated.
    let effectiveSize = fontSize;
    let metrics = measureBodyHeight(context, body, maxWidth, effectiveSize);
    while (effectiveSize > 9 && metrics.height > available) {
      effectiveSize -= 1;
      metrics = measureBodyHeight(context, body, maxWidth, effectiveSize);
    }

    context.save();
    context.beginPath();
    context.rect(x + 12, bodyTop + 4, width - 24, height - EXPORT_CARD_HEADER_H - 12);
    context.clip();
    context.fillStyle = "#1f2d27";
    context.font = `400 ${effectiveSize}px ${EXPORT_FONT}`;
    context.textBaseline = "alphabetic";
    drawWrappedText(context, body, x + 17, bodyTop + 20 + effectiveSize * 0.4, maxWidth, metrics.lineHeight);
    context.restore();
  };

  const getStageDataUrl = async (pixelRatio: number, silent = false, targetLongEdgePx?: number) => {
    const stage = getStageInstance();
    if (!stage) return null;

    setSelectedIconId(null);
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      // The sheet spans the plan plus anything placed outside it (an assembly
      // point, typically); fall back to the plan image if it is not there.
      const backgroundNode = stage.findOne(".planSheet") || stage.findOne(".bgImage");
      if (backgroundNode) {
        // toDataURL's crop is expressed in absolute stage coordinates, while the
        // node reports its own local ones. Neutralise the view transform for the
        // capture so the exported area is exactly the plan, whatever the current
        // zoom and pan — otherwise zooming in cropped the plan in half.
        const previousView = {
          x: stage.x(),
          y: stage.y(),
          scaleX: stage.scaleX(),
          scaleY: stage.scaleY()
        };

        stage.position({ x: 0, y: 0 });
        stage.scale({ x: 1, y: 1 });

        stage.draw();

        try {
          // The sheet turns with the scene, so its axis-aligned bounding box —
          // not its own width/height — is what has to be captured.
          const bounds = backgroundNode.getClientRect({ relativeTo: stage, skipShadow: true });
          // A plan is captured for a sheet of paper, not for its own sake: a
          // fixed ratio on a large drawing produced a hundred-megapixel image
          // (and a PDF to match). Aim at the print resolution instead.
          const ratio = targetLongEdgePx
            ? fitPixelRatio(bounds.width, bounds.height, targetLongEdgePx)
            : pixelRatio;
          return stage.toDataURL({
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            pixelRatio: ratio
          });
        } finally {
          stage.position({ x: previousView.x, y: previousView.y });
          stage.scale({ x: previousView.scaleX, y: previousView.scaleY });
          stage.draw();
        }
      }

      return stage.toDataURL({ pixelRatio });
    } catch (err) {
      console.error("Stage export failed:", err);
      if (!silent) {
        alert("Impossible d'exporter. Rechargez la page puis réessayez pour recharger le fond de plan avec les permissions d'export.");
      }
      return null;
    }
  };

  // Exporting the Konva stage and trimming it is by far the most expensive part of
  // building the template, and none of the panel, text or legend controls change
  // it. Cache it against everything that genuinely affects the drawing, so
  // dragging a slider only redraws the surrounding layout.
  const planRenderCacheRef = useRef<{
    key: string;
    image: HTMLImageElement | HTMLCanvasElement;
  } | null>(null);
  const officialFondCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  const getTrimmedPlanImage = async (pixelRatio: number, silent: boolean) => {
    const key = JSON.stringify({
      pixelRatio,
      // Read from `plan` rather than the derived backgroundUrl/backgroundType,
      // which are declared further down this component.
      background: plan?.use_cleaned_background && plan?.cleaned_background_file
        ? plan.cleaned_background_file
        : plan?.background_file,
      backgroundType: plan?.background_type,
      useCleaned: Boolean(plan?.use_cleaned_background),
      // No zoom here on purpose: the capture neutralises the view transform, so
      // panning or zooming no longer invalidates the cached render. The plan
      // rotation does belong here — it is baked into the pictogram compensation.
      exportPlanRotation,
      eraseStrokeCount,
      icons: icons.map((icon) => [
        icon.icon_type,
        Math.round(icon.x),
        Math.round(icon.y),
        Math.round(icon.width),
        Math.round(icon.height),
        Math.round(icon.rotation),
        icon.label
      ])
    });

    const cached = planRenderCacheRef.current;
    if (cached && cached.key === key) return cached.image;

    const planDataUrl = await getStageDataUrl(pixelRatio, silent);
    if (!planDataUrl) return null;

    const planImage = await loadImage(planDataUrl);
    const trimmedPlan = trimWhiteMargins(planImage);
    planRenderCacheRef.current = { key, image: trimmedPlan };
    return trimmedPlan;
  };

  const loadOfficialFondImage = async (
    fond: { file: string },
    width: number,
    height: number,
    outputScale: number
  ) => {
    if (!fond.file) return null;
    const cacheKey = `${fond.file}:${width}:${height}:${outputScale}`;
    const cached = officialFondCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
    const pdf = await pdfjs.getDocument({ url: fond.file }).promise;
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const targetWidth = Math.max(1, Math.round(width * outputScale));
    const targetHeight = Math.max(1, Math.round(height * outputScale));
    const renderScale = Math.max(targetWidth / baseViewport.width, targetHeight / baseViewport.height);
    const viewport = page.getViewport({ scale: renderScale });
    const renderCanvas = document.createElement("canvas");
    renderCanvas.width = Math.max(1, Math.round(viewport.width));
    renderCanvas.height = Math.max(1, Math.round(viewport.height));
    const renderContext = renderCanvas.getContext("2d");
    if (!renderContext) throw new Error("Canvas PDF indisponible");

    await page.render({ canvas: renderCanvas, canvasContext: renderContext, viewport }).promise;

    const fittedCanvas = document.createElement("canvas");
    fittedCanvas.width = targetWidth;
    fittedCanvas.height = targetHeight;
    const fittedContext = fittedCanvas.getContext("2d");
    if (!fittedContext) throw new Error("Canvas PDF indisponible");
    fittedContext.fillStyle = "#ffffff";
    fittedContext.fillRect(0, 0, fittedCanvas.width, fittedCanvas.height);
    const scale = Math.max(targetWidth / renderCanvas.width, targetHeight / renderCanvas.height);
    const drawW = renderCanvas.width * scale;
    const drawH = renderCanvas.height * scale;
    fittedContext.drawImage(renderCanvas, (targetWidth - drawW) / 2, (targetHeight - drawH) / 2, drawW, drawH);
    const image = await loadImage(fittedCanvas.toDataURL("image/png", 1));
    officialFondCacheRef.current.set(cacheKey, image);
    releaseCanvas(renderCanvas);
    releaseCanvas(fittedCanvas);
    return image;
  };

  /**
   * Draws a logo inside the header band. A white rounded plate keeps coloured or
   * dark logos legible over any theme gradient. When no explicit X bounds are
   * given, the logo hugs the sheet's left/right margin.
   *
   * The logo is fit by height first, then clamped by width so wide wordmarks do
   * not overflow their plate. `scale` and the offsets then adjust that automatic
   * result — the plate grows with the logo so the two stay one block.
   */
  const drawHeaderLogo = (
    context: CanvasRenderingContext2D,
    image: HTMLImageElement | null,
    side: "left" | "right",
    headerHeight: number,
    explicitLeftX?: number,
    explicitRightX?: number,
    scale = 1,
    offsetX = 0,
    offsetY = 0
  ) => {
    if (!image || !image.width || !image.height) return;

    const platePad = 6;
    const basePlateH = headerHeight - 22;
    // A logo plate is at most ~120px wide so the title stays the focal point.
    const maxPlateW = 120;
    const aspect = image.width / image.height;

    let drawH = basePlateH - platePad * 2;
    let drawW = drawH * aspect;
    if (drawW > maxPlateW - platePad * 2) {
      drawW = maxPlateW - platePad * 2;
      drawH = drawW / aspect;
    }

    drawW *= scale;
    drawH *= scale;

    const plateH = drawH + platePad * 2;
    const plateW = drawW + platePad * 2;
    // The anchor edge stays put as the plate grows: a left logo keeps its left
    // margin, a right one keeps its right margin.
    const leftX = explicitLeftX ?? (side === "left" ? EXPORT_MARGIN : EXPORT_CANVAS_WIDTH - EXPORT_MARGIN - plateW);
    const rightX = explicitRightX ?? (side === "left" ? leftX + plateW : EXPORT_CANVAS_WIDTH - EXPORT_MARGIN);
    const plateX = (side === "left" ? leftX : rightX - plateW) + offsetX;
    const plateY = (headerHeight - plateH) / 2 + offsetY;

    context.save();
    context.shadowColor = "rgba(0,0,0,0.18)";
    context.shadowBlur = 8;
    context.shadowOffsetY = 2;
    context.fillStyle = "#ffffff";
    tracePath(context, plateX, plateY, plateW, plateH, 8);
    context.fill();
    context.restore();

    context.save();
    tracePath(context, plateX, plateY, plateW, plateH, 8);
    context.clip();
    context.drawImage(image, plateX + (plateW - drawW) / 2, plateY + (plateH - drawH) / 2, drawW, drawH);
    context.restore();
  };

  const buildTemplateImage = async ({
    silent = false,
    pixelRatio = EXPORT_STAGE_PIXEL_RATIO,
    outputScale = EXPORT_OUTPUT_SCALE
  } = {}) => {
    const trimmedPlan = await getTrimmedPlanImage(pixelRatio, silent);
    if (!trimmedPlan) return null;
    const legendImages = await Promise.all(
      usedIconTypes.map(async (type) => {
        const src = getIconImageSource(type, iconDefinitions);
        if (!src) return null;

        try {
          return {
            type,
            image: await loadImage(src)
          };
        } catch {
          return null;
        }
      })
    );
    const loadedLegendImages = legendImages.filter((item): item is { type: IconType; image: HTMLImageElement } => Boolean(item));

    // Logos are optional: resolve whichever data URL was set, ignore failures.
    const logoResults = await Promise.allSettled([
      exportClientLogo ? loadImage(exportClientLogo) : Promise.resolve(null),
      exportStudioLogo ? loadImage(exportStudioLogo) : Promise.resolve(null)
    ]);
    const clientLogoImage = logoResults[0].status === "fulfilled" ? logoResults[0].value : null;
    const studioLogoImage = logoResults[1].status === "fulfilled" ? logoResults[1].value : null;
    const clientLogoScale = exportClientLogoScale / 100;
    const studioLogoScale = exportStudioLogoScale / 100;

    const selectedOfficialFond = EXPORT_OFFICIAL_FONDS[exportOfficialFond];
    const usesOfficialFond = exportOfficialFond !== "none" && Boolean(selectedOfficialFond.file);
    const exportCanvasWidth = usesOfficialFond && selectedOfficialFond.orientation === "portrait"
      ? EXPORT_CANVAS_HEIGHT
      : EXPORT_CANVAS_WIDTH;
    const exportCanvasHeight = usesOfficialFond && selectedOfficialFond.orientation === "portrait"
      ? EXPORT_CANVAS_WIDTH
      : EXPORT_CANVAS_HEIGHT;

    const canvas = document.createElement("canvas");
    canvas.width = exportCanvasWidth * outputScale;
    canvas.height = exportCanvasHeight * outputScale;
    const context = canvas.getContext("2d");
    if (!context) return null;

    context.scale(outputScale, outputScale);
    context.textBaseline = "alphabetic";
    const palette = getExportPalette();

    if (usesOfficialFond) {
      const fondImage = await loadOfficialFondImage(selectedOfficialFond, exportCanvasWidth, exportCanvasHeight, outputScale);
      if (fondImage) {
        context.drawImage(fondImage, 0, 0, exportCanvasWidth, exportCanvasHeight);
      } else {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, exportCanvasWidth, exportCanvasHeight);
      }

      const hasSideInstructions = selectedOfficialFond.orientation === "landscape" && selectedOfficialFond.label.includes("PE");
      const planX = selectedOfficialFond.orientation === "portrait"
        ? 58
        : hasSideInstructions ? 360 : 52;
      const planY = selectedOfficialFond.orientation === "portrait" ? 135 : 150;
      const planW = selectedOfficialFond.orientation === "portrait"
        ? exportCanvasWidth - 116
        : exportCanvasWidth - planX - 52;
      const planH = selectedOfficialFond.orientation === "portrait"
        ? exportCanvasHeight - planY - 72
        : exportCanvasHeight - planY - 72;
      const baseScale = Math.min(planW / trimmedPlan.width, planH / trimmedPlan.height);
      const scale = baseScale * (exportPlanScale / 100);
      const drawW = trimmedPlan.width * scale;
      const drawH = trimmedPlan.height * scale;
      const drawX = planX + planW / 2 + exportPlanOffsetX;
      const drawY = planY + planH / 2 + exportPlanOffsetY;

      context.save();
      if (!exportDisablePlanClipping) {
        context.beginPath();
        context.rect(planX, planY, planW, planH);
        context.clip();
      }
      context.translate(drawX, drawY);
      context.drawImage(trimmedPlan, -drawW / 2, -drawH / 2, drawW, drawH);
      context.restore();

      return canvas.toDataURL("image/png", 1);
    }

    if (exportTheme === "nfx08070") {
      context.fillStyle = palette.sheet;
      context.fillRect(0, 0, EXPORT_CANVAS_WIDTH, EXPORT_CANVAS_HEIGHT);

      const headerH = 75;
      const sideW = 340;
      // Every colour comes from the palette, so the theme reacts to the custom
      // colour pickers exactly like the others do.
      const bannerColor = palette.headerStart;
      const redColor = palette.safety;
      const greenColor = palette.intervention;
      const yellowColor = palette.accent;
      const textColor = palette.text;
      const bodySize = exportNfBodyFontSize;

      // 1. Header banner
      context.fillStyle = bannerColor;
      context.fillRect(0, 0, EXPORT_CANVAS_WIDTH, headerH);

      // Conformity mention, top-left of the banner
      if (exportNfConformity.trim()) {
        context.fillStyle = "#ffffff";
        context.font = `700 11px ${EXPORT_FONT}`;
        context.textAlign = "left";
        context.fillText(exportNfConformity.trim().toUpperCase(), 16, 22);
      }

      // Main banner title (centered)
      const bannerTitle = exportPlanTitle.trim() || EXPORT_THEME_DEFAULT_TITLES.nfx08070;
      context.fillStyle = "#ffffff";
      context.font = `900 ${fitTitleFontSize(context, bannerTitle.toUpperCase(), EXPORT_CANVAS_WIDTH - 460, 34)}px ${EXPORT_FONT}`;
      context.textAlign = "center";
      drawTrackedText(context, bannerTitle.toUpperCase(), EXPORT_CANVAS_WIDTH / 2, 52, "0.12em");
      context.textAlign = "left";

      // 2. Right column: the client's identity at the top, the legend at the
      // bottom. The plan keeps the whole height of the space left of it — on the
      // normative sheet the plan is the tall block, not a letterboxed strip.
      const siteNameText = exportSiteName.trim() || plan?.building_name || "";
      const hasClientBlock = Boolean(clientLogoImage) || Boolean(siteNameText);
      const hasLegend = exportShowLegend && loadedLegendImages.length > 0;
      const rightColW = 320;
      const rightColX = EXPORT_CANVAS_WIDTH - 24 - rightColW;
      const rightColCenter = rightColX + rightColW / 2;

      // Client logo above the address, both centred on the column axis. No white
      // plate here — unlike the other themes this area is already the sheet
      // background, so a plate would only add a floating shadow.
      let clientCursorY = headerH + 22;

      if (clientLogoImage && clientLogoImage.width && clientLogoImage.height) {
        const maxLogoW = rightColW - 40;
        const maxLogoH = 78;
        const aspect = clientLogoImage.width / clientLogoImage.height;
        let logoH = maxLogoH;
        let logoW = logoH * aspect;
        if (logoW > maxLogoW) {
          logoW = maxLogoW;
          logoH = logoW / aspect;
        }
        logoW *= clientLogoScale;
        logoH *= clientLogoScale;
        context.drawImage(
          clientLogoImage,
          rightColCenter - logoW / 2 + exportClientLogoOffsetX,
          clientCursorY + exportClientLogoOffsetY,
          logoW,
          logoH
        );
        // The address follows the logo down as it grows, but not sideways —
        // nudging the logo left or right must not drag the address with it.
        clientCursorY += logoH + exportClientLogoOffsetY + 34;
      } else {
        clientCursorY += 26;
      }

      // Site address: honours line breaks so "13 RUE HENRI TUROT" and the
      // postcode can sit on two lines as on a printed sheet.
      if (siteNameText) {
        context.fillStyle = textColor;
        context.font = `800 18px ${EXPORT_FONT}`;
        context.textAlign = "center";
        siteNameText.split("\n").forEach((line, index) => {
          context.fillText(line.trim(), rightColCenter, clientCursorY + index * 24);
        });
        context.textAlign = "left";
      }

      // Helper to draw pill badges (rounded rectangle with text & optional pictogram icon)
      const drawPillBadge = (
        x: number,
        y: number,
        width: number,
        label: string,
        color: string,
        badgeIconType: "incendie" | "evacuation" | "prevention" | null = null,
        textColorOverride = "#ffffff"
      ) => {
        context.save();
        context.fillStyle = color;
        tracePath(context, x, y, width, 32, 16);
        context.fill();

        // Labels are centred on the pill itself, so the three badges line up
        // whether or not they carry a pictogram. A long label only slides left,
        // and just far enough to clear the icon.
        const badgeText = label.toUpperCase();
        context.fillStyle = textColorOverride;
        context.font = `900 15px ${EXPORT_FONT}`;

        const spaced = context as CanvasRenderingContext2D & { letterSpacing?: string };
        const previousSpacing = spaced.letterSpacing;
        if (previousSpacing !== undefined) spaced.letterSpacing = "0.12em";
        const textWidth = context.measureText(badgeText).width;
        if (previousSpacing !== undefined) spaced.letterSpacing = previousSpacing;

        const iconZone = badgeIconType === "incendie" || badgeIconType === "evacuation" ? 36 : 0;
        const rightLimit = x + width - iconZone - 8;
        let textX = x + (width - textWidth) / 2;
        if (textX + textWidth > rightLimit) textX = Math.max(x + 12, rightLimit - textWidth);

        context.textAlign = "left";
        drawTrackedText(context, badgeText, textX, y + 21, "0.12em");

        // Draw pictogram on the right inside pill badge
        if (badgeIconType === "incendie") {
          const iconX = x + width - 32;
          const iconY = y + 6;
          context.fillStyle = textColorOverride;
          context.strokeStyle = textColorOverride;
          context.lineWidth = 1.5;
          // Extinguisher body
          tracePath(context, iconX + 6, iconY + 5, 8, 14, 2);
          context.fill();
          // Extinguisher handle & hose
          context.beginPath();
          context.moveTo(iconX + 10, iconY + 2);
          context.lineTo(iconX + 10, iconY + 5);
          context.moveTo(iconX + 8, iconY + 3);
          context.lineTo(iconX + 14, iconY + 2);
          context.stroke();
        } else if (badgeIconType === "evacuation") {
          const iconX = x + width - 32;
          const iconY = y + 6;
          context.fillStyle = textColorOverride;
          context.strokeStyle = textColorOverride;
          context.lineWidth = 1.5;
          // Door
          context.strokeRect(iconX + 4, iconY + 3, 11, 15);
          // Running person
          context.beginPath();
          context.arc(iconX + 10, iconY + 7, 2, 0, Math.PI * 2);
          context.fill();
          context.beginPath();
          context.moveTo(iconX + 10, iconY + 9);
          context.lineTo(iconX + 8, iconY + 14);
          context.lineTo(iconX + 11, iconY + 17);
          context.stroke();
        }

        context.textAlign = "left";
        context.restore();
      };

      // Helper to draw phone handset receiver
      const drawPhoneHandset = (x: number, y: number, size: number, color: string) => {
        context.save();
        context.fillStyle = color;
        context.strokeStyle = color;
        context.lineWidth = size * 0.16;
        context.lineCap = "round";
        context.lineJoin = "round";

        context.beginPath();
        context.arc(x + size * 0.35, y + size * 0.35, size * 0.35, Math.PI * 0.75, Math.PI * 1.75);
        context.stroke();

        context.beginPath();
        context.arc(x + size * 0.15, y + size * 0.15, size * 0.18, 0, Math.PI * 2);
        context.fill();

        context.beginPath();
        context.arc(x + size * 0.75, y + size * 0.75, size * 0.18, 0, Math.PI * 2);
        context.fill();

        context.restore();
      };

      const marginX = 20;
      const boxW = 310;

      // Column geometry, following the printed sheet: the coloured pill spans
      // the whole column, the framed boxes are inset — and everything shares one
      // vertical axis, so the block reads as centred rather than left-hung.
      const columnCenter = marginX + boxW / 2;
      const pillW = boxW;
      const phoneBoxW = 232;
      const phoneBoxX = columnCenter - phoneBoxW / 2;
      const deafBoxW = 288;
      const deafBoxX = columnCenter - deafBoxW / 2;

      /**
       * Emergency-number box: "18 ou 112" beside a handset, with the caption
       * underneath. The numbers come from a free-text field written "18 / 112",
       * so a site can print a single number or its own internal one.
       *
       * The handset and the numbers are measured as one group and centred
       * together, so "15 ou 118" and a lone internal number both sit on the
       * box's axis instead of hugging its left edge.
       */
      const drawEmergencyBox = (
        y: number,
        numbers: string,
        note: string,
        color: string,
        height: number
      ) => {
        context.fillStyle = "#ffffff";
        context.strokeStyle = color;
        context.lineWidth = 2;
        context.fillRect(phoneBoxX, y, phoneBoxW, height);
        context.strokeRect(phoneBoxX, y, phoneBoxW, height);

        const parts = numbers
          .split(/[\/|]|\bou\b/i)
          .map((part) => part.trim())
          .filter(Boolean);

        const handsetSize = 30;
        const handsetGap = 12;
        const ouGap = 9;

        context.font = `700 20px ${EXPORT_FONT}`;
        const ouWidth = context.measureText("ou").width;
        context.font = `900 32px ${EXPORT_FONT}`;
        const partWidths = parts.map((part) => context.measureText(part).width);
        const numbersWidth =
          partWidths.reduce((total, width) => total + width, 0) +
          Math.max(0, parts.length - 1) * (ouWidth + ouGap * 2);

        const groupWidth = handsetSize + handsetGap + numbersWidth;
        let cursorX = phoneBoxX + (phoneBoxW - groupWidth) / 2;
        const numbersY = y + height * 0.5;
        drawPhoneHandset(cursorX, numbersY - handsetSize * 0.82, handsetSize, color);
        cursorX += handsetSize + handsetGap;

        context.fillStyle = color;
        context.textAlign = "left";
        parts.forEach((part, index) => {
          if (index > 0) {
            context.font = `700 20px ${EXPORT_FONT}`;
            context.fillText("ou", cursorX + ouGap, numbersY);
            cursorX += ouGap * 2 + ouWidth;
          }
          context.font = `900 32px ${EXPORT_FONT}`;
          context.fillText(part, cursorX, numbersY);
          cursorX += partWidths[index];
        });

        if (note.trim()) {
          context.fillStyle = textColor;
          context.font = `800 9.5px ${EXPORT_FONT}`;
          const noteLines = getCanvasWrappedLines(context, note.trim(), phoneBoxW - 20);
          // Anchored to the bottom of the box, so a two-line caption grows
          // upward instead of spilling out under the frame.
          const firstLineY = y + height - 10 - (noteLines.length - 1) * 11;
          context.textAlign = "center";
          noteLines.forEach((line, index) => {
            context.fillText(line, phoneBoxX + phoneBoxW / 2, firstLineY + index * 11);
          });
          context.textAlign = "left";
        }
      };

      // 3. Left instructions column. Hidden with the "Consignes" switch, in
      // which case the plan reclaims the whole width.
      const leftColumnVisible = exportShowSafety;

      // ── Plan area: computed first and drawn underneath side panels ─────
      const mainX = leftColumnVisible ? sideW + 20 : marginX;
      const planX = mainX;
      const planY = headerH + 20;
      const planRight = hasClientBlock || hasLegend ? rightColX - 20 : EXPORT_CANVAS_WIDTH - 24;
      const basePlanW = Math.max(120, planRight - planX);
      const basePlanH = Math.max(120, EXPORT_CANVAS_HEIGHT - 24 - planY);
      const planW = basePlanW * (exportPlanAreaScale / 100);
      const planH = basePlanH * (exportPlanAreaScale / 100);

      const baseScale = Math.min(planW / trimmedPlan.width, planH / trimmedPlan.height);
      const scale = baseScale * (exportPlanScale / 100);
      const drawW = trimmedPlan.width * scale;
      const drawH = trimmedPlan.height * scale;
      const drawX = planX + planW / 2 + exportPlanOffsetX;
      const drawY = planY + planH / 2 + exportPlanOffsetY;

      // 1. Draw plan artwork under all header & side panels
      context.save();
      context.beginPath();
      context.rect(0, 0, EXPORT_CANVAS_WIDTH, EXPORT_CANVAS_HEIGHT);
      context.clip();
      context.translate(drawX, drawY);
      context.drawImage(trimmedPlan, -drawW / 2, -drawH / 2, drawW, drawH);
      context.restore();

      // 2. Red top header banner (drawn on top of top plan edge)
      context.fillStyle = redColor;
      context.fillRect(0, 0, EXPORT_CANVAS_WIDTH, headerH);
      context.fillStyle = "#ffffff";
      context.font = `800 13px ${EXPORT_FONT}`;
      context.textAlign = "left";
      drawTrackedText(context, (exportNfConformity.trim() || NF_DEFAULTS.conformity).toUpperCase(), marginX, 26, "0.08em");

      context.textAlign = "center";
      context.font = `900 30px ${EXPORT_FONT}`;
      drawTrackedText(context, (exportPlanTitle.trim() || EXPORT_THEME_DEFAULT_TITLES.nfx08070).toUpperCase(), EXPORT_CANVAS_WIDTH / 2, 46, "0.08em");
      context.textAlign = "left";

      // 3. Left instructions column with solid white background card
      if (leftColumnVisible) {
        context.save();
        context.fillStyle = "#ffffff";
        context.fillRect(0, headerH, sideW + 10, EXPORT_CANVAS_HEIGHT - headerH);
        context.restore();

        let cursorY = 95;

        // --- INCENDIE ---
        if (exportNfFireTitle.trim()) {
          drawPillBadge(marginX, cursorY, pillW, exportNfFireTitle, redColor, "incendie");
          cursorY += 47;
        }

        if (exportNfFireIntro.trim()) {
          context.fillStyle = textColor;
          context.font = `700 9.5px ${EXPORT_FONT}`;
          context.textAlign = "center";
          const introLines = getCanvasWrappedLines(context, exportNfFireIntro.trim(), boxW - 12);
          introLines.forEach((line, index) => {
            context.fillText(line, marginX + boxW / 2, cursorY + index * 12);
          });
          context.textAlign = "left";
          cursorY += introLines.length * 12 + 8;
        }

        drawEmergencyBox(cursorY, exportNfFireNumbers, exportNfEmergencyNote, redColor, 78);
        cursorY += 93;

        // --- EVACUATION ---
        if (exportNfEvacuationTitle.trim()) {
          drawPillBadge(marginX, cursorY, pillW, exportNfEvacuationTitle, greenColor, "evacuation");
          cursorY += 46;
        }

        // Centred like the printed sheet, and each step keeps its emphasis:
        // "1 -" headings bold, the lift warning red. Both are recognised from
        // the text itself, so a reworded notice keeps its hierarchy.
        const evacuationLines = exportNfEvacuationText.split("\n");
        const evacLineHeight = Math.round(bodySize * 1.44);
        context.textAlign = "center";
        evacuationLines.forEach((line) => {
          if (!line.trim()) {
            cursorY += Math.round(evacLineHeight * 0.6);
            return;
          }
          if (/ASCENSEUR/i.test(line)) {
            context.font = `900 ${bodySize + 0.5}px ${EXPORT_FONT}`;
            context.fillStyle = redColor;
          } else if (/^\s*\d+\s*-/.test(line)) {
            context.font = `800 ${bodySize}px ${EXPORT_FONT}`;
            context.fillStyle = textColor;
          } else {
            context.font = `500 ${bodySize - 0.5}px ${EXPORT_FONT}`;
            context.fillStyle = textColor;
          }
          getCanvasWrappedLines(context, line, boxW).forEach((wrappedLine) => {
            context.fillText(wrappedLine, marginX + boxW / 2, cursorY);
            cursorY += evacLineHeight;
          });
        });
        context.textAlign = "left";
        cursorY += 8;

        // --- ACCIDENT OU MALAISE ---
        if (exportNfMedicalTitle.trim()) {
          context.fillStyle = textColor;
          context.font = `800 9.5px ${EXPORT_FONT}`;
          context.textAlign = "center";
          context.fillText(exportNfMedicalTitle.trim().toUpperCase(), marginX + boxW / 2, cursorY + 12);
          context.textAlign = "left";
          cursorY += 16;
        }
        drawEmergencyBox(cursorY, exportNfMedicalNumbers, exportNfEmergencyNote, greenColor, 70);
        cursorY += 80;

        // --- 114 ---
        if (exportNfDeafText.trim()) {
          const deafBoxH = 48;
          context.fillStyle = "#ffffff";
          context.strokeStyle = redColor;
          context.lineWidth = 1.5;
          context.fillRect(deafBoxX, cursorY, deafBoxW, deafBoxH);
          context.strokeRect(deafBoxX, cursorY, deafBoxW, deafBoxH);

          context.fillStyle = redColor;
          tracePath(context, deafBoxX + 8, cursorY + 6, 42, 36, 4);
          context.fill();

          context.fillStyle = "#ffffff";
          context.font = `900 7px ${EXPORT_FONT}`;
          context.textAlign = "center";
          context.fillText("URGENCE", deafBoxX + 29, cursorY + 16);
          context.font = `900 11px ${EXPORT_FONT}`;
          context.fillText("114", deafBoxX + 29, cursorY + 34);
          context.textAlign = "left";

          const deafTextX = deafBoxX + 58;
          const deafTextW = deafBoxX + deafBoxW - 10 - deafTextX;
          context.save();
          context.beginPath();
          context.rect(deafBoxX + 54, cursorY, deafBoxW - 62, deafBoxH);
          context.clip();
          context.fillStyle = redColor;
          context.font = `700 8.5px ${EXPORT_FONT}`;
          const deafLines = getCanvasWrappedLines(context, exportNfDeafText.trim(), deafTextW);
          const deafFirstY = cursorY + deafBoxH / 2 - ((deafLines.length - 1) * 12) / 2 + 3;
          deafLines.forEach((line, index) => {
            context.fillText(line, deafTextX, deafFirstY + index * 12);
          });
          context.restore();
          cursorY += deafBoxH + 10;
        }

        // --- PREVENTION ---
        if (exportNfPreventionTitle.trim()) {
          drawPillBadge(marginX, cursorY, pillW, exportNfPreventionTitle, yellowColor, "prevention", "#111111");
          cursorY += 46;
        }

        // The column ends above the studio logo; clip so an over-long notice
        // is cut rather than printed across the logo.
        const preventionBottom = EXPORT_CANVAS_HEIGHT - 80;
        context.save();
        context.beginPath();
        context.rect(marginX, cursorY - bodySize - 4, boxW, Math.max(0, preventionBottom - cursorY + bodySize));
        context.clip();
        context.fillStyle = textColor;
        context.font = `700 ${bodySize - 0.5}px ${EXPORT_FONT}`;
        context.textAlign = "center";
        drawWrappedText(context, exportNfPreventionText, marginX + boxW / 2, cursorY, boxW, Math.round(bodySize * 1.5));
        context.textAlign = "left";
        context.restore();
      }

      // 4. Studio logo, bottom-left: the sheet's author. Aspect ratio kept.
      if (studioLogoImage && studioLogoImage.width && studioLogoImage.height) {
        const maxStudioW = 150;
        const maxStudioH = 58;
        const aspect = studioLogoImage.width / studioLogoImage.height;
        let studioH = maxStudioH;
        let studioW = studioH * aspect;
        if (studioW > maxStudioW) {
          studioW = maxStudioW;
          studioH = studioW / aspect;
        }
        studioW *= studioLogoScale;
        studioH *= studioLogoScale;
        // Anchored bottom-left: enlarging it grows upward and to the right,
        // so it never slides off the corner of the sheet.
        context.drawImage(
          studioLogoImage,
          marginX + exportStudioLogoOffsetX,
          EXPORT_CANVAS_HEIGHT - 20 - studioH + exportStudioLogoOffsetY,
          studioW,
          studioH
        );
      }

      // 5. Legend, at the foot of the right column. Its height follows the
      // number of equipment types instead of dropping the extras, so the sheet
      // never claims conformity over a truncated legend.
      const legendW = rightColW;
      const legendBottom = EXPORT_CANVAS_HEIGHT - 24;
      const legendRowH = 22;
      const legendHeaderH = 30;

      if (hasLegend) {
        // Rows shrink before anything is dropped; the floor keeps a 12px row
        // readable in print.
        const maxLegendH = EXPORT_CANVAS_HEIGHT * 0.42;
        const naturalH = legendHeaderH + loadedLegendImages.length * legendRowH;
        const rowH = naturalH > maxLegendH
          ? Math.max(12, Math.floor((maxLegendH - legendHeaderH) / loadedLegendImages.length))
          : legendRowH;
        const legendH = legendHeaderH + loadedLegendImages.length * rowH;
        const legendX = rightColX;
        const legendY = legendBottom - legendH;

        context.fillStyle = "#ffffff";
        context.strokeStyle = palette.legend;
        context.lineWidth = 1.5;
        context.fillRect(legendX, legendY, legendW, legendH);
        context.strokeRect(legendX, legendY, legendW, legendH);

        // Header cell
        context.beginPath();
        context.moveTo(legendX, legendY + legendHeaderH);
        context.lineTo(legendX + legendW, legendY + legendHeaderH);
        context.stroke();

        context.fillStyle = textColor;
        context.font = `900 13px ${EXPORT_FONT}`;
        context.textAlign = "center";
        drawTrackedText(context, (exportNfLegendTitle.trim() || NF_DEFAULTS.legendTitle).toUpperCase(), legendX + legendW / 2, legendY + 20, "0.14em");
        context.textAlign = "left";

        const legendLabelSize = Math.max(7, Math.min(9.5, rowH * 0.43));
        const legendIconSize = Math.max(10, Math.min(18, rowH - 4));

        loadedLegendImages.forEach(({ type, image }, index) => {
          const rowY = legendY + legendHeaderH + index * rowH;

          if (index > 0) {
            context.beginPath();
            context.moveTo(legendX, rowY);
            context.lineTo(legendX + legendW, rowY);
            context.stroke();
          }

          // Vertical divider between the pictogram and its label
          context.beginPath();
          context.moveTo(legendX + 44, rowY);
          context.lineTo(legendX + 44, rowY + rowH);
          context.stroke();

          context.drawImage(
            image,
            legendX + 22 - legendIconSize / 2,
            rowY + (rowH - legendIconSize) / 2,
            legendIconSize,
            legendIconSize
          );

          context.fillStyle = textColor;
          context.font = `700 ${legendLabelSize}px ${EXPORT_FONT}`;
          const label = iconDefinitions[type]?.label || type;
          const maxLabelW = legendW - 60;
          let printed = label;
          while (printed.length > 4 && context.measureText(printed).width > maxLabelW) {
            printed = printed.slice(0, -2);
          }
          context.fillText(
            printed === label ? label : `${printed}…`,
            legendX + 52,
            rowY + rowH / 2 + legendLabelSize * 0.36
          );
        });
      }

      return canvas.toDataURL("image/png", 1);
    }

    // ── Plan d'intervention ─────────────────────────────────────────────
    // The firefighters' sheet: no resident instructions, so the plan itself
    // takes the whole width and the right column carries the identification
    // (client, address, level) plus a large equipment legend.
    if (exportTheme === "intervention") {
      context.fillStyle = palette.sheet;
      context.fillRect(0, 0, EXPORT_CANVAS_WIDTH, EXPORT_CANVAS_HEIGHT);

      const headerH = 64;
      const textColor = palette.text;

      context.fillStyle = palette.headerStart;
      context.fillRect(0, 0, EXPORT_CANVAS_WIDTH, headerH);

      if (exportNfConformity.trim()) {
        context.fillStyle = "#ffffff";
        context.font = `700 11px ${EXPORT_FONT}`;
        context.textAlign = "left";
        context.fillText(exportNfConformity.trim().toUpperCase(), 16, headerH - 11);
      }

      const bannerTitle = exportPlanTitle.trim() || EXPORT_THEME_DEFAULT_TITLES.intervention;
      context.fillStyle = "#ffffff";
      context.font = `900 ${fitTitleFontSize(context, bannerTitle.toUpperCase(), EXPORT_CANVAS_WIDTH - 460, 34)}px ${EXPORT_FONT}`;
      context.textAlign = "center";
      drawTrackedText(context, bannerTitle.toUpperCase(), EXPORT_CANVAS_WIDTH / 2, headerH / 2 + 12, "0.1em");
      context.textAlign = "left";

      // ── Right column ────────────────────────────────────────────────
      const rightColW = 268;
      const rightColX = EXPORT_CANVAS_WIDTH - 24 - rightColW;
      const rightColCenter = rightColX + rightColW / 2;
      let columnY = headerH + 26;

      if (clientLogoImage && clientLogoImage.width && clientLogoImage.height) {
        const maxLogoW = rightColW - 40;
        const maxLogoH = 74;
        const aspect = clientLogoImage.width / clientLogoImage.height;
        let logoH = maxLogoH;
        let logoW = logoH * aspect;
        if (logoW > maxLogoW) {
          logoW = maxLogoW;
          logoH = logoW / aspect;
        }
        logoW *= clientLogoScale;
        logoH *= clientLogoScale;
        context.drawImage(
          clientLogoImage,
          rightColCenter - logoW / 2 + exportClientLogoOffsetX,
          columnY + exportClientLogoOffsetY,
          logoW,
          logoH
        );
        columnY += logoH + exportClientLogoOffsetY + 26;
      }

      const siteNameText = exportSiteName.trim() || plan?.building_name || "";
      if (siteNameText) {
        context.fillStyle = textColor;
        context.font = `800 15px ${EXPORT_FONT}`;
        context.textAlign = "center";
        const addressLines = siteNameText.split("\n");
        addressLines.forEach((line, index) => {
          context.fillText(line.trim(), rightColCenter, columnY + index * 20);
        });
        context.textAlign = "left";
        columnY += addressLines.length * 20 + 14;
      }

      // Level tag — a grey pill, the way the printed sheet marks each storey.
      const levelText = (exportLevelLabel.trim() || plan?.floor_name || "").toUpperCase();
      if (levelText) {
        context.font = `800 14px ${EXPORT_FONT}`;
        const tagW = Math.min(rightColW, context.measureText(levelText).width + 40);
        const tagH = 26;
        const tagX = rightColCenter - tagW / 2;
        context.fillStyle = palette.accent;
        tracePath(context, tagX, columnY, tagW, tagH, 4);
        context.fill();
        context.fillStyle = "#ffffff";
        context.textAlign = "center";
        drawTrackedText(context, levelText, rightColCenter, columnY + 18, "0.06em");
        context.textAlign = "left";
        columnY += tagH + 18;
      }

      // Studio logo, bottom-right under the legend. Reserved first so the
      // legend knows how much room it really has.
      let studioBlockTop = EXPORT_CANVAS_HEIGHT - 20;
      let studioDraw: { x: number; y: number; w: number; h: number } | null = null;
      if (studioLogoImage && studioLogoImage.width && studioLogoImage.height) {
        const maxStudioW = rightColW - 20;
        const maxStudioH = 66;
        const aspect = studioLogoImage.width / studioLogoImage.height;
        let studioH = maxStudioH;
        let studioW = studioH * aspect;
        if (studioW > maxStudioW) {
          studioW = maxStudioW;
          studioH = studioW / aspect;
        }
        studioW *= studioLogoScale;
        studioH *= studioLogoScale;
        const studioY = EXPORT_CANVAS_HEIGHT - 20 - studioH + exportStudioLogoOffsetY;
        studioDraw = {
          x: rightColCenter - studioW / 2 + exportStudioLogoOffsetX,
          y: studioY,
          w: studioW,
          h: studioH
        };
        studioBlockTop = Math.min(studioBlockTop, studioY - 14);
      }

      // ── Legend table ────────────────────────────────────────────────
      const hasLegend = exportShowLegend && loadedLegendImages.length > 0;
      if (hasLegend) {
        const legendX = rightColX;
        const legendW = rightColW;
        const legendTop = columnY;
        const legendAvailable = Math.max(60, studioBlockTop - legendTop);
        const headerRowH = 28;
        const iconColW = 46;

        // Shrink the rows until the whole table fits above the studio logo —
        // an intervention legend must show every symbol used on the plan.
        let labelSize = 9.5;
        let rows: { image: HTMLImageElement; lines: string[]; height: number }[] = [];
        let tableH = 0;

        for (let attempt = 0; attempt < 14; attempt++) {
          const lineHeight = Math.round(labelSize * 1.25);
          const iconSize = Math.max(11, Math.round(labelSize * 1.9));
          context.font = `700 ${labelSize}px ${EXPORT_FONT}`;
          rows = loadedLegendImages.map(({ type, image }) => {
            const lines = getCanvasWrappedLines(
              context,
              iconDefinitions[type]?.label || type,
              legendW - iconColW - 16
            );
            return { image, lines, height: Math.max(iconSize + 7, lines.length * lineHeight + 8) };
          });
          tableH = headerRowH + rows.reduce((total, row) => total + row.height, 0);
          if (tableH <= legendAvailable || labelSize <= 6) break;
          labelSize -= 0.25;
        }

        const lineHeight = Math.round(labelSize * 1.25);
        const iconSize = Math.max(11, Math.round(labelSize * 1.9));

        context.fillStyle = "#ffffff";
        context.strokeStyle = palette.legend;
        context.lineWidth = 1.5;
        context.fillRect(legendX, legendTop, legendW, tableH);
        context.strokeRect(legendX, legendTop, legendW, tableH);

        context.beginPath();
        context.moveTo(legendX, legendTop + headerRowH);
        context.lineTo(legendX + legendW, legendTop + headerRowH);
        context.stroke();

        context.fillStyle = textColor;
        context.font = `900 13px ${EXPORT_FONT}`;
        context.textAlign = "center";
        drawTrackedText(
          context,
          (exportNfLegendTitle.trim() || NF_DEFAULTS.legendTitle).toUpperCase(),
          legendX + legendW / 2,
          legendTop + 19,
          "0.14em"
        );
        context.textAlign = "left";

        let rowY = legendTop + headerRowH;
        rows.forEach(({ image, lines, height }, index) => {
          if (index > 0) {
            context.beginPath();
            context.moveTo(legendX, rowY);
            context.lineTo(legendX + legendW, rowY);
            context.stroke();
          }

          context.beginPath();
          context.moveTo(legendX + iconColW, rowY);
          context.lineTo(legendX + iconColW, rowY + height);
          context.stroke();

          context.drawImage(
            image,
            legendX + iconColW / 2 - iconSize / 2,
            rowY + (height - iconSize) / 2,
            iconSize,
            iconSize
          );

          context.fillStyle = textColor;
          context.font = `700 ${labelSize}px ${EXPORT_FONT}`;
          context.textAlign = "center";
          const textTop = rowY + (height - lines.length * lineHeight) / 2 + lineHeight * 0.76;
          lines.forEach((line, lineIndex) => {
            context.fillText(line, legendX + iconColW + (legendW - iconColW) / 2, textTop + lineIndex * lineHeight);
          });
          context.textAlign = "left";

          rowY += height;
        });
      }

      if (studioDraw) {
        context.drawImage(studioLogoImage!, studioDraw.x, studioDraw.y, studioDraw.w, studioDraw.h);
      }

      // ── The plan: everything left of the identification column ──────
      const columnUsed = hasLegend || Boolean(clientLogoImage) || Boolean(siteNameText) || Boolean(levelText) || Boolean(studioDraw);
      const planX = 26;
      const planY = headerH + 16;
      const planRight = columnUsed ? rightColX - 20 : EXPORT_CANVAS_WIDTH - 26;
      const basePlanW = Math.max(120, planRight - planX);
      const basePlanH = Math.max(120, EXPORT_CANVAS_HEIGHT - 22 - planY);
      const planW = basePlanW * (exportPlanAreaScale / 100);
      const planH = basePlanH * (exportPlanAreaScale / 100);

      const baseScale = Math.min(planW / trimmedPlan.width, planH / trimmedPlan.height);
      const scale = baseScale * (exportPlanScale / 100);
      const drawW = trimmedPlan.width * scale;
      const drawH = trimmedPlan.height * scale;
      const drawX = planX + planW / 2 + exportPlanOffsetX;
      const drawY = planY + planH / 2 + exportPlanOffsetY;

      context.save();
      if (!exportDisablePlanClipping) {
        const clipX1 = 0;
        const clipX2 = columnUsed ? rightColX - 4 : EXPORT_CANVAS_WIDTH;
        const clipY1 = headerH;
        const clipY2 = EXPORT_CANVAS_HEIGHT;
        context.beginPath();
        context.rect(clipX1, clipY1, Math.max(0, clipX2 - clipX1), Math.max(0, clipY2 - clipY1));
        context.clip();
      } else {
        context.beginPath();
        context.rect(0, 0, EXPORT_CANVAS_WIDTH, EXPORT_CANVAS_HEIGHT);
        context.clip();
      }
      context.translate(drawX, drawY);
      context.drawImage(trimmedPlan, -drawW / 2, -drawH / 2, drawW, drawH);
      context.restore();

      return canvas.toDataURL("image/png", 1);
    }

    // ── Plan d'évacuation ───────────────────────────────────────────────
    // Green banner, a prose instruction column on the left ending with the
    // assembly point, the plan in the middle under its level tag, and the
    // client identity plus legend on the right.
    if (exportTheme === "evacuation") {
      context.fillStyle = palette.sheet;
      context.fillRect(0, 0, EXPORT_CANVAS_WIDTH, EXPORT_CANVAS_HEIGHT);

      const textColor = palette.text;
      const redColor = palette.safety;
      const greenColor = palette.intervention;
      const amberColor = palette.accent;
      const bodySize = exportEvacBodyFontSize;

      // Pictograms borrowed from the icon library: the exit sign in the banner
      // and the assembly point in its box.
      const [exitPictogram, assemblyPictogram] = await Promise.all(
        (["issue_de_secours", "point_rassemblement"] as IconType[]).map(async (type) => {
          const src = getIconImageSource(type, iconDefinitions);
          if (!src) return null;
          try {
            return await loadImage(src);
          } catch {
            return null;
          }
        })
      );

      // ── Banner ──────────────────────────────────────────────────────
      const bannerX = 24;
      const bannerY = 22;
      const bannerW = EXPORT_CANVAS_WIDTH - bannerX * 2;
      const bannerH = 56;
      context.fillStyle = palette.headerStart;
      context.fillRect(bannerX, bannerY, bannerW, bannerH);

      const bannerTitle = (exportPlanTitle.trim() || EXPORT_THEME_DEFAULT_TITLES.evacuation).toUpperCase();
      const titleSize = fitTitleFontSize(context, bannerTitle, bannerW - 460, 34);
      context.font = `900 ${titleSize}px ${EXPORT_FONT}`;
      const titleWidth = context.measureText(bannerTitle).width;

      // Pictogram plate then title, measured as one group so the pair sits on
      // the banner's axis rather than the text alone.
      const plateSize = bannerH - 16;
      const plateGap = 12;
      const groupWidth = (exitPictogram ? plateSize + plateGap : 0) + titleWidth;
      let bannerCursorX = bannerX + (bannerW - groupWidth) / 2;

      if (exitPictogram) {
        context.fillStyle = "#ffffff";
        tracePath(context, bannerCursorX, bannerY + 8, plateSize, plateSize, 4);
        context.fill();
        context.drawImage(exitPictogram, bannerCursorX + 4, bannerY + 12, plateSize - 8, plateSize - 8);
        bannerCursorX += plateSize + plateGap;
      }

      context.fillStyle = "#ffffff";
      context.font = `900 ${titleSize}px ${EXPORT_FONT}`;
      context.textAlign = "left";
      context.fillText(bannerTitle, bannerCursorX, bannerY + bannerH / 2 + titleSize * 0.36);

      // Conformity mention at the far right of the band
      if (exportEvacConformity.trim()) {
        context.fillStyle = "rgba(255,255,255,0.92)";
        context.font = `600 9.5px ${EXPORT_FONT}`;
        context.textAlign = "right";
        context.fillText(exportEvacConformity.trim().toUpperCase(), bannerX + bannerW - 12, bannerY + bannerH - 9);
        context.textAlign = "left";
      }

      const contentTop = bannerY + bannerH + 22;

      // ── Left instruction column ─────────────────────────────────────
      const colX = 24;
      const colW = 290;
      const colCenter = colX + colW / 2;
      const leftColumnVisible = exportShowSafety;

      /** Small handset glyph for the emergency-call line. */
      const drawEvacHandset = (x: number, y: number, size: number, color: string) => {
        context.save();
        context.fillStyle = color;
        context.strokeStyle = color;
        context.lineWidth = size * 0.16;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.beginPath();
        context.arc(x + size * 0.35, y + size * 0.35, size * 0.35, Math.PI * 0.75, Math.PI * 1.75);
        context.stroke();
        context.beginPath();
        context.arc(x + size * 0.15, y + size * 0.15, size * 0.18, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.arc(x + size * 0.75, y + size * 0.75, size * 0.18, 0, Math.PI * 2);
        context.fill();
        context.restore();
      };

      /** Coloured pill with its title centred, matching the printed sheet. */
      const drawEvacPill = (y: number, label: string, color: string, picto: HTMLImageElement | null, labelColor = "#ffffff") => {
        context.fillStyle = color;
        tracePath(context, colX, y, colW, 26, 13);
        context.fill();

        const badgeText = label.toUpperCase();
        context.font = `900 14px ${EXPORT_FONT}`;
        const spacedCtx = context as CanvasRenderingContext2D & { letterSpacing?: string };
        const previousSpacing = spacedCtx.letterSpacing;
        if (previousSpacing !== undefined) spacedCtx.letterSpacing = "0.1em";
        const badgeWidth = context.measureText(badgeText).width;
        if (previousSpacing !== undefined) spacedCtx.letterSpacing = previousSpacing;

        const iconZone = picto ? 30 : 0;
        const rightLimit = colX + colW - iconZone - 8;
        let badgeX = colX + (colW - badgeWidth) / 2;
        if (badgeX + badgeWidth > rightLimit) badgeX = Math.max(colX + 10, rightLimit - badgeWidth);

        context.fillStyle = labelColor;
        context.textAlign = "left";
        drawTrackedText(context, badgeText, badgeX, y + 18, "0.1em");

        if (picto) {
          context.drawImage(picto, colX + colW - 28, y + 4, 18, 18);
        }
      };

      /** Centred prose block; blank lines act as paragraph spacers. */
      const drawEvacProse = (y: number, text: string, size: number) => {
        const lineHeight = Math.round(size * 1.34);
        let cursor = y;
        context.fillStyle = textColor;
        context.font = `700 ${size}px ${EXPORT_FONT}`;
        context.textAlign = "center";
        text.split("\n").forEach((paragraph) => {
          if (!paragraph.trim()) {
            cursor += Math.round(lineHeight * 0.55);
            return;
          }
          getCanvasWrappedLines(context, paragraph, colW - 16).forEach((line) => {
            context.fillText(line, colCenter, cursor);
            cursor += lineHeight;
          });
        });
        context.textAlign = "left";
        return cursor;
      };

      if (leftColumnVisible) {
        let cursorY = contentTop;

        if (exportEvacFireTitle.trim()) {
          drawEvacPill(cursorY, exportEvacFireTitle, redColor, null);
          cursorY += 38;
        }
        cursorY = drawEvacProse(cursorY, exportEvacFireText, bodySize) + 6;

        // Emergency call line: a handset then the free-text call wording.
        if (exportEvacCallText.trim()) {
          const callLines = exportEvacCallText.split("\n").filter((line) => line.trim());
          context.font = `700 ${bodySize + 1}px ${EXPORT_FONT}`;
          const callLineH = Math.round((bodySize + 1) * 1.4);
          drawEvacHandset(colX + 6, cursorY - 2, 16, redColor);
          context.fillStyle = textColor;
          context.textAlign = "left";
          callLines.forEach((line, index) => {
            context.fillText(line.trim(), colX + 30, cursorY + 9 + index * callLineH);
          });
          cursorY += callLines.length * callLineH + 12;
        }

        if (exportEvacTitle.trim()) {
          drawEvacPill(cursorY, exportEvacTitle, greenColor, exitPictogram);
          cursorY += 38;
        }
        cursorY = drawEvacProse(cursorY, exportEvacText, bodySize) + 10;

        if (exportEvacPreventionTitle.trim()) {
          drawEvacPill(cursorY, exportEvacPreventionTitle, amberColor, null, "#ffffff");
          cursorY += 38;
        }
        cursorY = drawEvacProse(cursorY, exportEvacPreventionText, bodySize) + 16;

        // Assembly point: green-framed box with its pictogram and label.
        if (exportEvacAssemblyLabel.trim()) {
          const boxH = 54;
          context.fillStyle = "#ffffff";
          context.strokeStyle = greenColor;
          context.lineWidth = 1.5;
          context.fillRect(colX, cursorY, colW, boxH);
          context.strokeRect(colX, cursorY, colW, boxH);
          if (assemblyPictogram) {
            context.drawImage(assemblyPictogram, colX + 10, cursorY + 9, 36, 36);
          }
          context.fillStyle = textColor;
          context.font = `800 ${bodySize + 0.5}px ${EXPORT_FONT}`;
          const labelX = colX + (assemblyPictogram ? 56 : 14);
          const labelLines = getCanvasWrappedLines(context, exportEvacAssemblyLabel.trim(), colX + colW - 12 - labelX);
          const labelTop = cursorY + boxH / 2 - ((labelLines.length - 1) * 12) / 2 + 4;
          labelLines.forEach((line, index) => {
            context.fillText(line, labelX, labelTop + index * 12);
          });
          cursorY += boxH + 12;
        }

        // 114 box, shared wording with the normative sheet.
        if (exportNfDeafText.trim()) {
          const deafBoxH = 48;
          context.fillStyle = "#ffffff";
          context.strokeStyle = redColor;
          context.lineWidth = 1.5;
          context.fillRect(colX, cursorY, colW, deafBoxH);
          context.strokeRect(colX, cursorY, colW, deafBoxH);

          context.fillStyle = redColor;
          tracePath(context, colX + 8, cursorY + 6, 40, 36, 4);
          context.fill();
          context.fillStyle = "#ffffff";
          context.font = `900 7px ${EXPORT_FONT}`;
          context.textAlign = "center";
          context.fillText("URGENCE", colX + 28, cursorY + 16);
          context.font = `900 11px ${EXPORT_FONT}`;
          context.fillText("114", colX + 28, cursorY + 34);
          context.textAlign = "left";

          context.save();
          context.beginPath();
          context.rect(colX + 52, cursorY, colW - 60, deafBoxH);
          context.clip();
          context.fillStyle = redColor;
          context.font = `700 8px ${EXPORT_FONT}`;
          const deafLines = getCanvasWrappedLines(context, exportNfDeafText.trim(), colW - 70);
          const deafTop = cursorY + deafBoxH / 2 - ((deafLines.length - 1) * 11) / 2 + 3;
          context.textAlign = "center";
          deafLines.forEach((line, index) => {
            context.fillText(line, colX + 52 + (colW - 60) / 2, deafTop + index * 11);
          });
          context.textAlign = "left";
          context.restore();
        }
      }

      // Studio logo, bottom-left
      if (studioLogoImage && studioLogoImage.width && studioLogoImage.height) {
        const maxStudioW = colW - 40;
        const maxStudioH = 62;
        const aspect = studioLogoImage.width / studioLogoImage.height;
        let studioH = maxStudioH;
        let studioW = studioH * aspect;
        if (studioW > maxStudioW) {
          studioW = maxStudioW;
          studioH = studioW / aspect;
        }
        studioW *= studioLogoScale;
        studioH *= studioLogoScale;
        context.drawImage(
          studioLogoImage,
          colX + exportStudioLogoOffsetX,
          EXPORT_CANVAS_HEIGHT - 22 - studioH + exportStudioLogoOffsetY,
          studioW,
          studioH
        );
      }

      // ── Right column: client identity, then the legend ──────────────
      const rightColW = 250;
      const rightColX = EXPORT_CANVAS_WIDTH - 24 - rightColW;
      const rightColCenter = rightColX + rightColW / 2;
      let columnY = contentTop + 6;

      if (clientLogoImage && clientLogoImage.width && clientLogoImage.height) {
        const maxLogoW = rightColW - 20;
        const maxLogoH = 76;
        const aspect = clientLogoImage.width / clientLogoImage.height;
        let logoH = maxLogoH;
        let logoW = logoH * aspect;
        if (logoW > maxLogoW) {
          logoW = maxLogoW;
          logoH = logoW / aspect;
        }
        logoW *= clientLogoScale;
        logoH *= clientLogoScale;
        context.drawImage(
          clientLogoImage,
          rightColCenter - logoW / 2 + exportClientLogoOffsetX,
          columnY + exportClientLogoOffsetY,
          logoW,
          logoH
        );
        columnY += logoH + exportClientLogoOffsetY + 28;
      }

      const siteNameText = exportSiteName.trim() || plan?.building_name || "";
      if (siteNameText) {
        context.fillStyle = textColor;
        context.font = `800 15px ${EXPORT_FONT}`;
        context.textAlign = "center";
        const addressLines = siteNameText.split("\n");
        addressLines.forEach((line, index) => {
          context.fillText(line.trim(), rightColCenter, columnY + index * 20);
        });
        context.textAlign = "left";
        columnY += addressLines.length * 20;
      }

      const hasLegend = exportShowLegend && loadedLegendImages.length > 0;
      if (hasLegend) {
        const legendTop = Math.max(columnY + 40, contentTop + 190);
        const legendAvailable = Math.max(60, EXPORT_CANVAS_HEIGHT - 40 - legendTop);
        const headerRowH = 26;
        const iconColW = 44;

        let labelSize = 9;
        let rows: { image: HTMLImageElement; lines: string[]; height: number }[] = [];
        let tableH = 0;

        for (let attempt = 0; attempt < 14; attempt++) {
          const lineHeight = Math.round(labelSize * 1.25);
          const iconSize = Math.max(11, Math.round(labelSize * 1.9));
          context.font = `700 ${labelSize}px ${EXPORT_FONT}`;
          rows = loadedLegendImages.map(({ type, image }) => {
            const lines = getCanvasWrappedLines(context, iconDefinitions[type]?.label || type, rightColW - iconColW - 14);
            return { image, lines, height: Math.max(iconSize + 6, lines.length * lineHeight + 7) };
          });
          tableH = headerRowH + rows.reduce((total, row) => total + row.height, 0);
          if (tableH <= legendAvailable || labelSize <= 6) break;
          labelSize -= 0.25;
        }

        const lineHeight = Math.round(labelSize * 1.25);
        const iconSize = Math.max(11, Math.round(labelSize * 1.9));

        context.fillStyle = "#ffffff";
        context.strokeStyle = palette.legend;
        context.lineWidth = 1.5;
        context.fillRect(rightColX, legendTop, rightColW, tableH);
        context.strokeRect(rightColX, legendTop, rightColW, tableH);

        context.beginPath();
        context.moveTo(rightColX, legendTop + headerRowH);
        context.lineTo(rightColX + rightColW, legendTop + headerRowH);
        context.stroke();

        context.fillStyle = textColor;
        context.font = `900 13px ${EXPORT_FONT}`;
        context.textAlign = "center";
        drawTrackedText(
          context,
          (exportNfLegendTitle.trim() || NF_DEFAULTS.legendTitle).toUpperCase(),
          rightColCenter,
          legendTop + 18,
          "0.12em"
        );
        context.textAlign = "left";

        let rowY = legendTop + headerRowH;
        rows.forEach(({ image, lines, height }, index) => {
          if (index > 0) {
            context.beginPath();
            context.moveTo(rightColX, rowY);
            context.lineTo(rightColX + rightColW, rowY);
            context.stroke();
          }
          context.beginPath();
          context.moveTo(rightColX + iconColW, rowY);
          context.lineTo(rightColX + iconColW, rowY + height);
          context.stroke();

          context.drawImage(image, rightColX + iconColW / 2 - iconSize / 2, rowY + (height - iconSize) / 2, iconSize, iconSize);

          context.fillStyle = textColor;
          context.font = `700 ${labelSize}px ${EXPORT_FONT}`;
          context.textAlign = "center";
          const textTop = rowY + (height - lines.length * lineHeight) / 2 + lineHeight * 0.76;
          lines.forEach((line, lineIndex) => {
            context.fillText(line, rightColX + iconColW + (rightColW - iconColW) / 2, textTop + lineIndex * lineHeight);
          });
          context.textAlign = "left";
          rowY += height;
        });
      }

      // ── The plan, with its level tag underneath ─────────────────────
      const levelText = (exportLevelLabel.trim() || plan?.floor_name || "").toUpperCase();
      const levelBandH = levelText ? 46 : 12;
      const planX = leftColumnVisible ? colX + colW + 22 : 24;
      const planRight = hasLegend || clientLogoImage || siteNameText ? rightColX - 22 : EXPORT_CANVAS_WIDTH - 24;
      const planY = contentTop;
      const basePlanW = Math.max(120, planRight - planX);
      const basePlanH = Math.max(120, EXPORT_CANVAS_HEIGHT - 24 - levelBandH - planY);
      const planW = basePlanW * (exportPlanAreaScale / 100);
      const planH = basePlanH * (exportPlanAreaScale / 100);

      const baseScale = Math.min(planW / trimmedPlan.width, planH / trimmedPlan.height);
      const scale = baseScale * (exportPlanScale / 100);
      const drawW = trimmedPlan.width * scale;
      const drawH = trimmedPlan.height * scale;
      const drawX = planX + planW / 2 + exportPlanOffsetX;
      const drawY = planY + planH / 2 + exportPlanOffsetY;

      context.save();
      if (!exportDisablePlanClipping) {
        const clipX1 = leftColumnVisible ? colX + colW + 4 : 0;
        const clipX2 = hasLegend || clientLogoImage || siteNameText ? rightColX - 4 : EXPORT_CANVAS_WIDTH;
        const clipY1 = contentTop;
        const clipY2 = EXPORT_CANVAS_HEIGHT;
        context.beginPath();
        context.rect(clipX1, clipY1, Math.max(0, clipX2 - clipX1), Math.max(0, clipY2 - clipY1));
        context.clip();
      } else {
        context.beginPath();
        context.rect(0, 0, EXPORT_CANVAS_WIDTH, EXPORT_CANVAS_HEIGHT);
        context.clip();
      }
      context.translate(drawX, drawY);
      context.drawImage(trimmedPlan, -drawW / 2, -drawH / 2, drawW, drawH);
      context.restore();

      if (levelText) {
        context.font = `800 15px ${EXPORT_FONT}`;
        const tagW = Math.min(planW, context.measureText(levelText).width + 44);
        const tagH = 28;
        const tagX = planX + planW / 2 - tagW / 2;
        const tagY = planY + planH + 8;
        context.fillStyle = palette.muted;
        tracePath(context, tagX, tagY, tagW, tagH, 4);
        context.fill();
        context.fillStyle = "#ffffff";
        context.textAlign = "center";
        drawTrackedText(context, levelText, planX + planW / 2, tagY + 19, "0.06em");
        context.textAlign = "left";
      }

      return canvas.toDataURL("image/png", 1);
    }

    if (exportTheme === "consignes") {
      context.fillStyle = palette.sheet;
      context.fillRect(0, 0, EXPORT_CANVAS_WIDTH, EXPORT_CANVAS_HEIGHT);

      const sideW = 388;
      const mainX = sideW;
      const headerH = 90;
      const red = palette.safety;
      const green = palette.legend;
      const darkGreen = palette.headerStart;
      const grey = palette.muted;

      context.fillStyle = red;
      context.fillRect(0, 0, sideW, 94);
      context.fillStyle = "#ffffff";
      context.font = `900 38px ${EXPORT_FONT}`;
      context.textAlign = "center";
      drawTrackedText(context, "CONSIGNES", sideW / 2, 42, "0.14em");
      context.font = `700 13px ${EXPORT_FONT}`;
      context.fillText("EN CAS D'INCENDIE", sideW / 2, 69);

      const consignesHeaderGradient = context.createLinearGradient(mainX, 0, EXPORT_CANVAS_WIDTH, headerH);
      consignesHeaderGradient.addColorStop(0, palette.headerStart);
      consignesHeaderGradient.addColorStop(1, palette.headerEnd);
      context.fillStyle = consignesHeaderGradient;
      context.fillRect(mainX, 0, EXPORT_CANVAS_WIDTH - mainX, headerH);
      context.fillStyle = "#ffffff";
      context.font = `900 42px ${EXPORT_FONT}`;
      const bandTitle = exportPlanTitle.trim() || "PLAN D'ÉVACUATION";
      const bandWidth = EXPORT_CANVAS_WIDTH - mainX;
      context.font = `800 ${fitTitleFontSize(context, bandTitle, bandWidth - 80, 48)}px ${EXPORT_FONT}`;
      drawTrackedText(context, bandTitle, mainX + bandWidth / 2, 58, "0.16em");

      const levelW = 72;
      context.fillStyle = darkGreen;
      context.fillRect(mainX, headerH, levelW, 70);
      context.fillStyle = "#ffffff";
      context.font = `700 15px ${EXPORT_FONT}`;
      context.fillText("Niveau", mainX + levelW / 2, headerH + 21);
      context.font = `800 36px ${EXPORT_FONT}`;
      context.fillText(plan?.floor_name || "0", mainX + levelW / 2, headerH + 58);

      context.fillStyle = palette.text;
      context.font = `800 26px ${EXPORT_FONT}`;
      context.fillText(exportSiteName || plan?.building_name || "Nom du site", mainX + (EXPORT_CANVAS_WIDTH - mainX) / 2, headerH + 34);
      context.font = `500 16px ${EXPORT_FONT}`;
      context.fillText(plan?.floor_name || plan?.title || "", mainX + (EXPORT_CANVAS_WIDTH - mainX) / 2, headerH + 57);
      context.textAlign = "left";

      // Logos sit in the plan header band (from mainX to the right edge).
      // Offset them so they clear the level block on the far left of that band.
      drawHeaderLogo(context, clientLogoImage, "left", headerH, mainX + levelW + 12, mainX + levelW + 96, clientLogoScale, exportClientLogoOffsetX, exportClientLogoOffsetY);
      drawHeaderLogo(context, studioLogoImage, "right", headerH, EXPORT_CANVAS_WIDTH - 108, EXPORT_CANVAS_WIDTH - 12, studioLogoScale, exportStudioLogoOffsetX, exportStudioLogoOffsetY);

      const drawSectionBar = (y: number, label: string, color: string) => {
        context.fillStyle = color;
        context.fillRect(16, y, sideW - 32, 24);
        context.fillStyle = "#ffffff";
        context.font = `800 14px ${EXPORT_FONT}`;
        context.textAlign = "center";
        drawTrackedText(context, label, sideW / 2, y + 17, "0.14em");
        context.textAlign = "left";
      };

      const drawInstructionBlock = (
        y: number,
        title: string,
        body: string,
        color: string,
        height: number,
        fontSize: number
      ) => {
        drawSectionBar(y, title, color);
        context.save();
        context.beginPath();
        context.rect(18, y + 34, sideW - 36, height - 44);
        context.clip();
        context.fillStyle = palette.text;
        context.font = `500 ${fontSize}px ${EXPORT_FONT}`;
        drawWrappedText(context, body, 24, y + 54, sideW - 48, Math.round(fontSize * 1.38));
        context.restore();
      };

      if (exportShowSafety) {
        drawInstructionBlock(112, "INCENDIE", exportSafetyText, red, 300, Math.max(10, exportSafetyFontSize - 3));
        drawInstructionBlock(426, "ÉVACUATION", "Suivez le cheminement indiqué.\nN'utilisez pas les ascenseurs.\nRejoignez le point de rassemblement.\nAidez les personnes en difficulté sans vous mettre en danger.", green, 255, 13);
      }
      if (exportShowIntervention) {
        drawInstructionBlock(700, "RESPONSABLES D'INTERVENTION", exportInterventionText, green, 205, Math.max(10, exportInterventionFontSize - 3));
      }

      drawSectionBar(922, "PRÉVENTION", grey);
      context.fillStyle = palette.text;
      context.font = `500 12px ${EXPORT_FONT}`;
      drawWrappedText(
        context,
        "Fermez portes et fenêtres.\nN'encombrez pas les issues.\nInterdiction de fumer dans les zones signalées.",
        24,
        970,
        sideW - 48,
        18
      );

      const leftColumnVisibleConsignes = exportShowSafety || exportShowIntervention;
      const planX = leftColumnVisibleConsignes ? mainX + 36 : 36;
      const planY = headerH + 84;
      const planW = EXPORT_CANVAS_WIDTH - planX - 36;
      const planH = EXPORT_CANVAS_HEIGHT - planY - 118;
      const baseScale = Math.min(planW / trimmedPlan.width, planH / trimmedPlan.height);
      const scale = baseScale * (exportPlanScale / 100);
      const drawW = trimmedPlan.width * scale;
      const drawH = trimmedPlan.height * scale;
      const drawX = planX + planW / 2 + exportPlanOffsetX;
      const drawY = planY + planH / 2 + exportPlanOffsetY;

      context.save();
      context.beginPath();
      context.rect(planX, planY, planW, planH);
      context.clip();
      context.translate(drawX, drawY);
      context.drawImage(trimmedPlan, -drawW / 2, -drawH / 2, drawW, drawH);
      context.restore();

      if (exportShowLegend) {
      const legendW = 410;
      const legendH = 150;
      const legendX = planX + 60;
      const legendY = EXPORT_CANVAS_HEIGHT - legendH - 62;
      context.fillStyle = "rgba(255,255,255,0.96)";
      tracePath(context, legendX, legendY, legendW, legendH, 8);
      context.fill();
      context.strokeStyle = palette.border;
      context.lineWidth = 1.5;
      tracePath(context, legendX, legendY, legendW, legendH, 8);
      context.stroke();
      context.fillStyle = palette.text;
      context.font = `800 13px ${EXPORT_FONT}`;
      context.textAlign = "center";
      context.fillText("LÉGENDE PLAN", legendX + legendW / 2, legendY + 22);
      context.textAlign = "left";

      const legendColumns = 2;
      const legendRows = Math.ceil(Math.min(loadedLegendImages.length, 10) / legendColumns);
      const rowH = Math.max(21, Math.floor((legendH - 38) / Math.max(1, legendRows)));
      loadedLegendImages.slice(0, 10).forEach(({ type, image }, index) => {
        const col = index % legendColumns;
        const row = Math.floor(index / legendColumns);
        const x = legendX + 18 + col * (legendW / legendColumns);
        const y = legendY + 38 + row * rowH;
        context.drawImage(image, x, y - 12, 18, 18);
        context.fillStyle = palette.text;
        context.font = `500 10px ${EXPORT_FONT}`;
        const label = iconDefinitions[type]?.label || type;
        context.fillText(label.length > 26 ? `${label.slice(0, 24)}...` : label, x + 26, y + 2);
      });
      } // end legend block (consignes)

      context.fillStyle = "#ffffff";
      context.fillRect(mainX + 16, EXPORT_CANVAS_HEIGHT - 46, 250, 26);
      context.fillStyle = palette.text;
      context.font = `600 13px ${EXPORT_FONT}`;
      context.fillText(`Mis à jour le ${new Date().toLocaleDateString("fr-FR")}`, mainX + 24, EXPORT_CANVAS_HEIGHT - 28);

      return canvas.toDataURL("image/png", 1);
    }

    // ── Sheet background ────────────────────────────────────────────────
    context.fillStyle = palette.sheet;
    context.fillRect(0, 0, EXPORT_CANVAS_WIDTH, EXPORT_CANVAS_HEIGHT);

    // ── Header band ─────────────────────────────────────────────────────
    const headerGradient = context.createLinearGradient(0, 0, EXPORT_CANVAS_WIDTH, EXPORT_HEADER_H);
    headerGradient.addColorStop(0, palette.headerStart);
    headerGradient.addColorStop(1, palette.headerEnd);
    context.fillStyle = headerGradient;
    context.fillRect(0, 0, EXPORT_CANVAS_WIDTH, EXPORT_HEADER_H);

    // Safety-signage accent rule under the band
    context.fillStyle = palette.accent;
    context.fillRect(0, EXPORT_HEADER_H, EXPORT_CANVAS_WIDTH, 4);

    context.textAlign = "center";
    context.fillStyle = "#ffffff";
    context.font = `800 42px ${EXPORT_FONT}`;
    const sheetTitle = exportPlanTitle.trim() || "PLAN D'ÉVACUATION";
    context.font = `800 ${fitTitleFontSize(context, sheetTitle, EXPORT_CANVAS_WIDTH - 120, 42)}px ${EXPORT_FONT}`;
    drawTrackedText(context, sheetTitle, EXPORT_CANVAS_WIDTH / 2, 50, "0.12em");

    context.fillStyle = "rgba(255,255,255,0.92)";
    context.font = `600 24px ${EXPORT_FONT}`;
    context.fillText(
      exportSiteName || plan?.building_name || "Nom du site",
      EXPORT_CANVAS_WIDTH / 2,
      84
    );
    context.textAlign = "left";

    // ── Header logos: client on the left, studio on the right ───────────
    // Both sit inside the coloured band, so a white plate keeps coloured or
    // dark logos legible regardless of the theme palette.
    drawHeaderLogo(context, clientLogoImage, "left", EXPORT_HEADER_H, undefined, undefined, clientLogoScale, exportClientLogoOffsetX, exportClientLogoOffsetY);
    drawHeaderLogo(context, studioLogoImage, "right", EXPORT_HEADER_H, undefined, undefined, studioLogoScale, exportStudioLogoOffsetX, exportStudioLogoOffsetY);

    // ── Column geometry ─────────────────────────────────────────────────
    // Columns are dropped entirely when every panel they hold is hidden, and the
    // plan reclaims the freed width so the sheet never shows a dead side strip.
    const leftColumnVisible = exportShowSafety || exportShowIntervention;
    const contentTop = EXPORT_HEADER_H + 22;
    const contentBottom = EXPORT_CANVAS_HEIGHT - EXPORT_FOOTER_H - 18;
    const leftX = EXPORT_MARGIN;
    const leftColumnWidth = leftColumnVisible ? EXPORT_SIDE_W : 0;
    const rightX = exportShowLegend
      ? EXPORT_CANVAS_WIDTH - EXPORT_MARGIN - EXPORT_SIDE_W
      : EXPORT_CANVAS_WIDTH - EXPORT_MARGIN;
    const planX = leftX + leftColumnWidth + (leftColumnVisible ? EXPORT_GUTTER : 0);
    const basePlanW = Math.max(0, rightX - EXPORT_GUTTER - planX);
    const basePlanH = contentBottom - contentTop;
    const planW = basePlanW * (exportPlanAreaScale / 100);
    const planH = basePlanH * (exportPlanAreaScale / 100);
    const planY = contentTop;

    const topPanelH = exportSafetyPanelHeight;
    const bottomPanelY = contentTop + topPanelH + 22;
    const bottomPanelH = exportInterventionPanelHeight;
    const legendHeight = exportLegendPanelHeight;

    // ── Left column: instructions ───────────────────────────────────────
    if (exportShowSafety) {
      drawPanel(
        context,
        leftX,
        contentTop,
        EXPORT_SIDE_W,
        topPanelH,
        "Consignes de sécurité",
        exportSafetyText,
        exportSafetyFontSize,
        palette.safety
      );
    }
    if (exportShowIntervention) {
      drawPanel(
        context,
        leftX,
        bottomPanelY,
        EXPORT_SIDE_W,
        bottomPanelH,
        "Équipe d'intervention",
        exportInterventionText,
        exportInterventionFontSize,
        palette.intervention
      );
    }

    // ── Right column: legend ────────────────────────────────────────────
    if (exportShowLegend) {
    drawCard(context, rightX, contentTop, EXPORT_SIDE_W, legendHeight, "Légende", palette.legend);

    context.save();
    context.beginPath();
    context.rect(rightX + 1, contentTop + EXPORT_CARD_HEADER_H, EXPORT_SIDE_W - 2, legendHeight - EXPORT_CARD_HEADER_H - 2);
    context.clip();
    context.font = `400 ${exportLegendFontSize}px ${EXPORT_FONT}`;

    if (loadedLegendImages.length === 0) {
      context.fillStyle = palette.muted;
      context.fillText("Aucun équipement placé sur le plan.", rightX + 17, contentTop + EXPORT_CARD_HEADER_H + 32);
    }

    // Scale the rows down when the legend would otherwise overflow its card.
    const legendAvailable = legendHeight - EXPORT_CARD_HEADER_H - 16;
    let legendScale = 1;
    for (let attempt = 0; attempt < 12; attempt++) {
      const size = Math.max(18, Math.round(exportLegendFontSize * 2.1 * legendScale));
      const chip = size + 12;
      const rowLine = Math.max(12, Math.round(exportLegendFontSize * 1.28 * legendScale));
      const labelX = rightX + 16 + chip + 14;
      const labelWidth = rightX + EXPORT_SIDE_W - 16 - labelX;
      context.font = `400 ${Math.max(10, Math.round(exportLegendFontSize * legendScale))}px ${EXPORT_FONT}`;
      const total = loadedLegendImages.reduce((sum, { type }) => {
        const lines = getCanvasWrappedLines(context, iconDefinitions[type]?.label || type, labelWidth);
        return sum + Math.max(chip + 10, lines.length * rowLine + 16);
      }, 0);
      if (total <= legendAvailable || legendScale <= 0.55) break;
      legendScale -= 0.05;
    }

    const legendFontSize = Math.max(10, Math.round(exportLegendFontSize * legendScale));
    const iconSize = Math.max(18, Math.round(exportLegendFontSize * 2.1 * legendScale));
    const chipSize = iconSize + 12;
    const lineHeight = Math.max(12, Math.round(exportLegendFontSize * 1.28 * legendScale));
    const textX = rightX + 16 + chipSize + 14;
    const textMaxWidth = rightX + EXPORT_SIDE_W - 16 - textX;
    context.font = `400 ${legendFontSize}px ${EXPORT_FONT}`;
    let legendRowY = contentTop + EXPORT_CARD_HEADER_H + 8;

    loadedLegendImages.forEach(({ type, image }, index) => {
      const labelLines = getCanvasWrappedLines(context, iconDefinitions[type]?.label || type, textMaxWidth);
      const rowHeight = Math.max(chipSize + 10, labelLines.length * lineHeight + 16);

      // Zebra striping keeps long legends readable in print
      if (index % 2 === 1) {
        context.fillStyle = palette.panelTint;
        context.fillRect(rightX + 1, legendRowY, EXPORT_SIDE_W - 2, rowHeight);
      }

      const chipX = rightX + 16;
      const chipY = legendRowY + (rowHeight - chipSize) / 2;
      context.fillStyle = palette.chipFill;
      tracePath(context, chipX, chipY, chipSize, chipSize, 7);
      context.fill();
      context.strokeStyle = palette.border;
      context.lineWidth = 1;
      tracePath(context, chipX, chipY, chipSize, chipSize, 7);
      context.stroke();
      context.drawImage(image, chipX + 6, chipY + 6, iconSize, iconSize);

      context.fillStyle = palette.text;
      const textBlockTop = legendRowY + (rowHeight - labelLines.length * lineHeight) / 2 + lineHeight * 0.72;
      labelLines.forEach((line, lineIndex) => {
        context.fillText(line, textX, textBlockTop + lineIndex * lineHeight);
      });

      legendRowY += rowHeight;
    });
    context.restore();
    } // end legend block

    // ── Centre: the plan itself ─────────────────────────────────────────
    context.save();
    context.shadowColor = palette.shadow;
    context.shadowBlur = 14;
    context.shadowOffsetY = 4;
    context.fillStyle = "#ffffff";
    tracePath(context, planX, planY, planW, planH, EXPORT_CARD_RADIUS);
    context.fill();
    context.restore();

    const baseScale = Math.min(planW / trimmedPlan.width, planH / trimmedPlan.height);
    const scale = baseScale * (exportPlanScale / 100);
    const drawW = trimmedPlan.width * scale;
    const drawH = trimmedPlan.height * scale;
    const drawX = planX + planW / 2 + exportPlanOffsetX;
    const drawY = planY + planH / 2 + exportPlanOffsetY;

    context.save();
    if (!exportDisablePlanClipping) {
      const clipX1 = (exportShowSafety || exportShowIntervention) ? leftX + EXPORT_SIDE_W + 4 : 0;
      const clipX2 = exportShowLegend ? rightX - 4 : EXPORT_CANVAS_WIDTH;
      const clipY1 = contentTop;
      const clipY2 = contentBottom;
      tracePath(context, clipX1, clipY1, Math.max(0, clipX2 - clipX1), Math.max(0, clipY2 - clipY1), EXPORT_CARD_RADIUS);
      context.clip();
    } else {
      context.beginPath();
      context.rect(0, 0, EXPORT_CANVAS_WIDTH, EXPORT_CANVAS_HEIGHT);
      context.clip();
    }
    context.translate(drawX, drawY);
    // No rotation here: the canvas already captured the sheet turned, pictograms
    // upright. Turning the bitmap again would double the angle and tilt them back.
    context.drawImage(trimmedPlan, -drawW / 2, -drawH / 2, drawW, drawH);
    context.restore();

    context.strokeStyle = palette.border;
    context.lineWidth = 1.5;
    tracePath(context, planX, planY, planW, planH, EXPORT_CARD_RADIUS);
    context.stroke();

    // North arrow, bottom-right of the plan frame
    const northX = planX + planW - 44;
    const northY = planY + planH - 52;
    context.save();
    context.fillStyle = "rgba(255,255,255,0.92)";
    tracePath(context, northX - 20, northY - 18, 40, 56, 8);
    context.fill();
    context.strokeStyle = palette.border;
    context.lineWidth = 1;
    tracePath(context, northX - 20, northY - 18, 40, 56, 8);
    context.stroke();
    // The needle turns with the plan: north moves when the sheet is oriented to
    // the reader. The "N" itself stays upright so it remains readable.
    context.save();
    context.translate(northX, northY);
    context.rotate((exportPlanRotation * Math.PI) / 180);
    context.fillStyle = palette.text;
    context.beginPath();
    context.moveTo(0, -12);
    context.lineTo(9, 10);
    context.lineTo(0, 4);
    context.lineTo(-9, 10);
    context.closePath();
    context.fill();
    context.restore();

    context.fillStyle = palette.text;
    context.textAlign = "center";
    context.font = `700 14px ${EXPORT_FONT}`;
    context.fillText("N", northX, northY + 32);
    context.textAlign = "left";
    context.restore();

    // ── Footer ──────────────────────────────────────────────────────────
    const footerY = EXPORT_CANVAS_HEIGHT - EXPORT_FOOTER_H;
    context.fillStyle = "#ffffff";
    context.fillRect(0, footerY, EXPORT_CANVAS_WIDTH, EXPORT_FOOTER_H);
    context.fillStyle = palette.legend;
    context.fillRect(0, footerY, EXPORT_CANVAS_WIDTH, 2);

    context.save();
    context.textBaseline = "middle";
    context.fillStyle = palette.text;
    context.font = `600 15px ${EXPORT_FONT}`;
    const footerParts = [plan?.building_name, plan?.floor_name].filter(Boolean).join("  ·  ");
    context.fillText(footerParts || plan?.title || "", EXPORT_MARGIN, footerY + EXPORT_FOOTER_H / 2);

    context.textAlign = "center";
    context.fillStyle = palette.muted;
    context.font = `400 14px ${EXPORT_FONT}`;
    context.fillText(
      `${loadedLegendImages.length} type${loadedLegendImages.length > 1 ? "s" : ""} d'équipement  ·  ${icons.length} implantation${icons.length > 1 ? "s" : ""}`,
      EXPORT_CANVAS_WIDTH / 2,
      footerY + EXPORT_FOOTER_H / 2
    );

    context.textAlign = "right";
    context.fillStyle = palette.muted;
    context.fillText(
      `Mis à jour le ${new Date().toLocaleDateString("fr-FR")}`,
      EXPORT_CANVAS_WIDTH - EXPORT_MARGIN,
      footerY + EXPORT_FOOTER_H / 2
    );
    context.restore();
    context.textAlign = "left";

    return canvas.toDataURL("image/png", 1);
  };

  const buildTemplatePdf = (dataUrl: string) => {
    const selectedOfficialFond = EXPORT_OFFICIAL_FONDS[exportOfficialFond];
    const usesOfficialFond = exportOfficialFond !== "none" && Boolean(selectedOfficialFond.file);
    const selectedPaperFormat = usesOfficialFond ? selectedOfficialFond.paper : exportPaperFormat;
    const paper = EXPORT_PAPER_SIZES[selectedPaperFormat];
    const orientation = usesOfficialFond && selectedOfficialFond.orientation === "portrait" ? "portrait" : "landscape";
    const pageWidth = orientation === "portrait" ? paper.heightMm : paper.widthMm;
    const pageHeight = orientation === "portrait" ? paper.widthMm : paper.heightMm;
    const pdf = new jsPDF({
      orientation,
      unit: "mm",
      format: [pageWidth, pageHeight]
    });
    pdf.addImage(dataUrl, "PNG", 0, 0, pageWidth, pageHeight);
    return pdf;
  };

  useEffect(() => {
    if (!exportModalOpen || loading || cleaning) {
      setExportAdjustmentPreviewUrl("");
      return;
    }

    let cancelled = false;
    setExportAdjustmentPreviewLoading(true);

    const timeout = window.setTimeout(async () => {
      const dataUrl = await buildTemplateImage({
        silent: true,
        pixelRatio: EXPORT_PREVIEW_STAGE_PIXEL_RATIO,
        outputScale: 1
      });
      if (!cancelled && dataUrl) {
        setExportAdjustmentPreviewUrl(dataUrl);
      }
      if (!cancelled) {
        setExportAdjustmentPreviewLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    exportModalOpen,
    loading,
    cleaning,
    icons,
    exportTheme,
    exportOfficialFond,
    exportUseCustomColors,
    exportCustomColors,
    exportPlanTitle,
    exportSiteName,
    exportSafetyText,
    exportInterventionText,
    exportSafetyPanelHeight,
    exportSafetyFontSize,
    exportInterventionPanelHeight,
    exportInterventionFontSize,
    exportLegendPanelHeight,
    exportLegendFontSize,
    exportPlanScale,
    exportPlanAreaScale,
    exportPlanRotation,
    exportPlanOffsetX,
    exportPlanOffsetY,
    exportDisablePlanClipping,
    exportClientLogo,
    exportStudioLogo,
    exportClientLogoScale,
    exportClientLogoOffsetX,
    exportClientLogoOffsetY,
    exportStudioLogoScale,
    exportStudioLogoOffsetX,
    exportStudioLogoOffsetY,
    exportShowSafety,
    exportShowIntervention,
    exportShowLegend,
    exportNfConformity,
    exportNfFireTitle,
    exportNfFireIntro,
    exportNfFireNumbers,
    exportNfEmergencyNote,
    exportNfEvacuationTitle,
    exportNfEvacuationText,
    exportNfMedicalTitle,
    exportNfMedicalNumbers,
    exportNfDeafText,
    exportNfPreventionTitle,
    exportNfPreventionText,
    exportNfLegendTitle,
    exportNfBodyFontSize,
    exportLevelLabel,
    exportEvacConformity,
    exportEvacFireTitle,
    exportEvacFireText,
    exportEvacCallText,
    exportEvacTitle,
    exportEvacText,
    exportEvacPreventionTitle,
    exportEvacPreventionText,
    exportEvacAssemblyLabel,
    exportEvacBodyFontSize,
    iconDefinitions,
  ]);

  const handlePreviewPdf = async () => {
    setPreviewing(true);
    try {
      const dataUrl = await buildTemplateImage();
      if (!dataUrl) return;

      const pdf = buildTemplatePdf(dataUrl);
      const previewUrl = URL.createObjectURL(pdf.output("blob"));
      setExportPreviewUrl((current) => {
        if (current) revokeObjectUrlSafely(current);
        return previewUrl;
      });
    } finally {
      setPreviewing(false);
    }
  };

  const executeExportTemplateAction = async () => {
    setExporting(true);
    try {
      const dataUrl = await buildTemplateImage();
      if (!dataUrl) return;

      const filename = `${plan?.title || "plan"}_evacuation`;
      if (exportFormat === "png") {
        const link = document.createElement("a");
        link.download = `${filename}.png`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        const pdf = buildTemplatePdf(dataUrl);
        pdf.save(`${filename}.pdf`);
      }
      setExportModalOpen(false);
    } finally {
      setExporting(false);
    }
  };

  const getStageInstance = () => {
    return planCanvasRef.current?.getStage() ?? null;
  };

  /** Capture of the studio sheet, exactly as laid out, at the print resolution. */
  const captureSheetImage = (targetLongEdgePx: number) => {
    const stage = getStageInstance();
    if (!stage) return null;

    const previousView = {
      x: stage.x(),
      y: stage.y(),
      scaleX: stage.scaleX(),
      scaleY: stage.scaleY()
    };

    try {
      // The capture is expressed in absolute stage coordinates, so neutralise
      // the view transform: the exported page must not depend on the zoom.
      stage.position({ x: 0, y: 0 });
      stage.scale({ x: 1, y: 1 });
      stage.draw();

      return stage.toDataURL({
        x: 0,
        y: 0,
        width: activeSheetSize.width,
        height: activeSheetSize.height,
        pixelRatio: fitPixelRatio(activeSheetSize.width, activeSheetSize.height, targetLongEdgePx)
      });
    } finally {
      stage.position({ x: previousView.x, y: previousView.y });
      stage.scale({ x: previousView.scaleX, y: previousView.scaleY });
      stage.draw();
    }
  };

  /**
   * The one export: what the studio shows *is* the deliverable, so nothing is
   * re-composed elsewhere. On a template it captures the sheet; on a bare plan
   * it captures the plan and everything placed around it — never the viewport,
   * so the zoom and the scroll position have no say in the result.
   */
  const convertDataUrlToJpeg = async (dataUrl: string) => {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    const jpeg = canvas.toDataURL("image/jpeg", 0.94);
    releaseCanvas(canvas);
    return jpeg;
  };

  const handleOfficialFondChange = (key: ExportOfficialFondKey) => {
    setExportOfficialFond(key);
    const fond = EXPORT_OFFICIAL_FONDS[key];
    if (fond.paper !== "a4") {
      setExportPaperFormat(fond.paper);
    }
  };

  const exportStudio = async (format: "png" | "jpeg" | "pdf") => {
    const stage = getStageInstance();
    if (!stage) return;

    setSheetExporting(true);
    // Clear every selection so no handle or highlight is baked into the export.
    setSelectedIconId(null);
    setSelectedShapeId(null);
    setSelectedTextId(null);
    setSelectedBlockId(null);
    setSelectedOverlayId(null);
    setSelectedBatBlock(false);
    await new Promise((resolve) => setTimeout(resolve, 120));

    try {
      // The output is sized for the paper it is going on, so a big drawing no
      // longer means a gigantic file — it means a sharp one at 300 dpi.
      const paper = EXPORT_PAPER_SIZES[exportPaperFormat];
      const targetLongEdgePx = paperLongEdgePx(paper);

      const dataUrl = sheetActive
        ? captureSheetImage(targetLongEdgePx)
        : await getStageDataUrl(EXPORT_STAGE_PIXEL_RATIO, false, targetLongEdgePx);
      if (!dataUrl) return;

      const suffix = sheetActive ? sheetTemplate : "plan";
      const filename = `${plan?.title || "plan"}_${suffix}`;

      if (format === "png" || format === "jpeg") {
        const downloadDataUrl = format === "jpeg" ? await convertDataUrlToJpeg(dataUrl) : dataUrl;
        const link = document.createElement("a");
        link.download = `${filename}.${format === "jpeg" ? "jpg" : "png"}`;
        link.href = downloadDataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }

      if (sheetActive) {
        // A template is drawn at the paper's own proportions: it fills the page.
        const sheetLandscape = activeSheetSize.width >= activeSheetSize.height;
        const pdfWidth = sheetLandscape ? paper.widthMm : paper.heightMm;
        const pdfHeight = sheetLandscape ? paper.heightMm : paper.widthMm;
        const pdf = new jsPDF({
          orientation: sheetLandscape ? "landscape" : "portrait",
          unit: "mm",
          format: exportPaperFormat
        });
        // "FAST" is deflate: a plan is mostly white, and storing the image raw
        // is what turned a perfectly ordinary sheet into hundreds of megabytes.
        pdf.addImage(dataUrl, "PNG", 0, 0, pdfWidth, pdfHeight, undefined, "FAST");
        pdf.save(`${filename}.pdf`);
        return;
      }

      // A bare plan has whatever shape the building has, so the page follows it
      // and the drawing is centred inside, with a margin to keep it printable.
      const image = await loadImage(dataUrl);
      const landscape = image.width >= image.height;
      const pageWidth = landscape ? paper.widthMm : paper.heightMm;
      const pageHeight = landscape ? paper.heightMm : paper.widthMm;
      const margin = 8;
      const scale = Math.min(
        (pageWidth - margin * 2) / image.width,
        (pageHeight - margin * 2) / image.height
      );
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;

      const pdf = new jsPDF({
        orientation: landscape ? "landscape" : "portrait",
        unit: "mm",
        format: exportPaperFormat
      });
      pdf.addImage(
        dataUrl,
        "PNG",
        (pageWidth - drawWidth) / 2,
        (pageHeight - drawHeight) / 2,
        drawWidth,
        drawHeight,
        undefined,
        "FAST"
      );
      pdf.save(`${filename}.pdf`);
    } catch (err) {
      console.error("Studio export failed:", err);
      alert("Impossible d'exporter. Rechargez la page puis réessayez.");
    } finally {
      setSheetExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white text-slate-950">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-safety-green" />
          <p className="text-lg font-medium text-slate-700">Chargement du plan de sécurité...</p>
        </div>
      </div>
    );
  }

  const backgroundUrl = (plan?.use_cleaned_background && plan?.cleaned_background_file)
    ? plan.cleaned_background_file
    : plan?.background_file || "";

  const backgroundType = (plan?.use_cleaned_background && plan?.cleaned_background_file)
    ? "image"
    : plan?.background_type || "image";

  const costEstimatePanel = (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Coût estimé</div>
      {cleanMethod === "grok" ? (
        <>
          <div className="mt-1 text-xl font-bold text-slate-950">≈ 0,05 $ US / image</div>
          <p className="mt-1 text-xs text-slate-500">
            Modèle grok-imagine-image-quality · résolution 2K · analyse grok-4.5 incluse.
          </p>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Estimation indicative. Le montant réel facturé par xAI peut varier selon la taille de l'image et les éventuelles nouvelles tentatives.
          </p>
        </>
      ) : (
        <>
          <div className="mt-1 text-xl font-bold text-safety-green">Gratuit</div>
          <p className="mt-1 text-xs text-slate-500">Aucun appel à une API externe.</p>
        </>
      )}
    </div>
  );

  const cleaningHistoryPanel = (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-950">
            Historique de nettoyage{cleanTargetOverlay ? ` — ${cleanTargetOverlay.label || "plan secondaire"}` : " — plan principal"}
          </h3>
          <p className="mt-1 text-xs text-slate-500">Choisissez une version nettoyée pour la remettre comme fond de ce plan.</p>
        </div>
        <button
          type="button"
          onClick={() => void fetchCleaningHistory()}
          disabled={cleaningHistoryLoading || grokCleaning}
          className="inline-flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-safety-green transition-colors hover:bg-green-100 disabled:opacity-50"
        >
          {cleaningHistoryLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Actualiser
        </button>
      </div>

      {cleaningHistoryLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-semibold text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Chargement de l'historique...
        </div>
      ) : cleaningHistory.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-medium text-slate-500">
          Aucune version nettoyée enregistrée pour ce plan.
        </div>
      ) : (
        <div className="grid max-h-96 gap-3 overflow-y-auto pr-1 md:grid-cols-2">
          {cleaningHistory.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-slate-950">{item.title}</div>
                  <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {formatHistoryDate(item.created_at)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleUseHistory(item)}
                  disabled={cleaningHistoryApplyingId === item.id || grokCleaning}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-safety-green px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-green-600 disabled:opacity-50"
                >
                  {cleaningHistoryApplyingId === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                  Utiliser
                </button>
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <img src={item.image_url} alt="Plan nettoyé historique" className="h-36 w-full object-contain" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Save the current edits then leave the editor.
  const handleSaveAndLeave = async () => {
    if (await handleSave()) router.push("/evacuation-plans");
  };

  return (
    <ProtectedRoute>
      {/* Fixed application frame. The geometry is inline rather than utility classes
          so it cannot depend on a stylesheet being regenerated: the viewport must
          never scroll, only the panels do. */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          boxSizing: "border-box",
          overflow: "hidden"
        }}
        className="studio-shell flex min-h-0 min-w-0 flex-col bg-[#1b1b1d] text-neutral-200"
      >
        {/* ───────────────── Top bar ───────────────── */}
        <header className="flex min-h-16 w-full max-w-full min-w-0 shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-brand-orange/40 bg-[#2d2d30] px-2 py-0.5 shadow-[inset_0_2px_0_rgba(255,116,0,0.85)]">
          <div className="flex w-56 min-w-[200px] shrink-0 items-center gap-2">
            <BrandLogo compact className="h-8 w-8 shrink-0" priority />
            <button
              type="button"
              onClick={() => {
                if (hasUnsavedChanges()) setPendingNav(true);
                else router.push("/evacuation-plans");
              }}
              title="Retour aux plans"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="h-5 w-px shrink-0 bg-white/10" />
            <button
              type="button"
              onClick={() => setLeftDockOpen((open) => !open)}
              title={leftDockOpen ? "Masquer le panneau Bibliothèque / Calques" : "Afficher le panneau Bibliothèque / Calques"}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors ${
                leftDockOpen ? "bg-white/10 text-neutral-100" : "text-neutral-500 hover:bg-white/10"
              }`}
            >
              <PanelLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setRightDockOpen((open) => !open)}
              title={rightDockOpen ? "Masquer les propriétés" : "Afficher les propriétés"}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors ${
                rightDockOpen ? "bg-white/10 text-neutral-100" : "text-neutral-500 hover:bg-white/10"
              }`}
            >
              <PanelRight className="h-4 w-4" />
            </button>
            <span className="h-5 w-px shrink-0 bg-white/10" />
            <div className="min-w-0">
              <h1 className="truncate text-[13px] font-semibold leading-tight text-neutral-100">
                {plan?.title || "Plan d'évacuation"}
              </h1>
              <p className="truncate text-[10px] leading-tight text-neutral-500">
                {plan?.building_name} &middot; {plan?.floor_name}
              </p>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 overflow-hidden">
            <div className="flex min-h-7 min-w-0 items-center gap-1.5 whitespace-nowrap overflow-x-auto no-scrollbar scroll-smooth [&>*]:shrink-0">
            {/* Undo / Redo */}
            <div className="flex items-center gap-0.5 rounded bg-black/25 p-0.5">
              <button
                type="button"
                onClick={handleUndo}
                disabled={historyIndex <= 0}
                className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
                title="Annuler la dernière action (Cmd+Z / Ctrl+Z)"
              >
                <Undo2 className="h-3.5 w-3.5" />
                <span>Annuler</span>
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={historyIndex < 0 || historyIndex >= history.length - 1}
                className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
                title="Rétablir l'action annulée (Cmd+Shift+Z / Ctrl+Y)"
              >
                <Redo2 className="h-3.5 w-3.5" />
                <span>Rétablir</span>
              </button>
            </div>

            {/* Canvas Rotation */}
            <div className="flex items-center gap-1 rounded bg-black/25 px-1.5 py-0.5">
              <span className="text-[10px] font-semibold text-neutral-400">Plan:</span>
              <button
                type="button"
                onClick={() => setCanvasRotation((r) => (r - 90 + 360) % 360)}
                className="flex cursor-pointer items-center justify-center rounded p-1 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
                title="Pivoter le plan de -90° (Sens anti-horaire)"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setCanvasRotation(0)}
                disabled={canvasRotation === 0}
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
                  canvasRotation === 0
                    ? "text-neutral-500 cursor-default"
                    : "bg-sky-500/20 text-sky-300 hover:bg-sky-500/40 cursor-pointer"
                }`}
                title={
                  planReadingAngle === null
                    ? "Remettre la rotation du plan à 0° (Réinitialiser)"
                    : `Rotation totale ${effectivePlanRotation}° = ${canvasRotation}° manuels ${
                        planReadingAngle >= 0 ? "−" : "+"
                      } ${Math.abs(Math.round(planReadingAngle))}° du repère « Vous êtes ici ». Cliquez pour remettre la part manuelle à 0°.`
                }
              >
                {effectivePlanRotation}°{planReadingAngle !== null ? " ↻" : ""}
              </button>
              <button
                type="button"
                onClick={() => setCanvasRotation((r) => (r + 90) % 360)}
                className="flex cursor-pointer items-center justify-center rounded p-1 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
                title="Pivoter le plan de +90° (Sens horaire)"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Affichage: bare plan, or the printed sheet edited in place */}
            <div className="flex items-center gap-1 rounded bg-black/25 px-1.5 py-0.5">
              <Eye className="h-3.5 w-3.5 text-neutral-400" />
              <span className="text-[10px] font-semibold text-neutral-400">Affichage :</span>
              <select
                value={sheetTemplate}
                onChange={(event) => applySheetTemplate(event.target.value as SheetTemplateKey | "none")}
                title="Travailler sur le plan seul, ou sur la feuille complète avec ses côtés"
                className="cursor-pointer rounded bg-transparent px-1 py-0.5 text-[11px] font-semibold text-neutral-200 outline-none hover:bg-white/10"
              >
                <option value="none" className="bg-[#2d2d30]">Plan seul</option>
                {(Object.keys(SHEET_TEMPLATES) as SheetTemplateKey[]).map((key) => (
                  <option key={key} value={key} className="bg-[#2d2d30]">
                    Feuille {SHEET_TEMPLATES[key].label}
                  </option>
                ))}
              </select>
              {sheetActive && (
                <button
                  type="button"
                  onClick={() => applySheetTemplate(sheetTemplate as SheetTemplateKey, { reset: true })}
                  title="Réinitialiser la mise en page du modèle"
                  className="flex cursor-pointer items-center justify-center rounded p-1 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
              )}
              {sheetActive && (
                <>
                  <select
                    value={activeSheetTemplateVersionId}
                    onChange={(event) => applyStoredSheetTemplateVersion(event.target.value)}
                    title="Charger une version enregistrée de ce template"
                    className="max-w-40 cursor-pointer rounded bg-transparent px-1 py-0.5 text-[11px] font-semibold text-neutral-200 outline-none hover:bg-white/10"
                  >
                    <option value="" className="bg-[#2d2d30]">Versions</option>
                    {currentSheetTemplateVersions.map((version) => (
                      <option key={version.id} value={version.id} className="bg-[#2d2d30]">
                        {version.id.startsWith("draft:") ? "Dernière modif" : version.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={saveCurrentSheetTemplateVersion}
                    title="Enregistrer cette mise en page comme une nouvelle version"
                    className="flex cursor-pointer items-center justify-center rounded p-1 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <Save className="h-3 w-3" />
                  </button>
                  {activeSheetTemplateVersionId && !activeSheetTemplateVersionId.startsWith("draft:") && (
                    <button
                      type="button"
                      onClick={deleteCurrentSheetTemplateVersion}
                      title="Supprimer la version sélectionnée"
                      className="flex cursor-pointer items-center justify-center rounded p-1 text-neutral-500 transition-colors hover:bg-red-500/15 hover:text-red-300"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </>
              )}
              <button
                type="button"
                onClick={openSheetSettings}
                title="Réglages de la feuille : nom du site, titre et logos"
                className="flex cursor-pointer items-center justify-center rounded p-1 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Settings className="h-3 w-3" />
              </button>
            </div>

            <button
              type="button"
              onClick={openWatermarkSettings}
              title="Configurer la version filigranée et le bloc Bon à tirer"
              className={`flex cursor-pointer items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                watermarkConfig.enabled
                  ? "border-red-500/50 bg-red-950/70 text-red-100 hover:bg-red-900/80"
                  : "border-white/10 bg-black/20 text-neutral-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Stamp className={`h-3.5 w-3.5 ${watermarkConfig.enabled ? "text-red-400" : "text-neutral-400"}`} />
              <span>{watermarkConfig.enabled ? "Version filigranée active" : "Version filigranée"}</span>
            </button>
            {watermarkConfig.enabled && (
              <button
                type="button"
                onClick={disableWatermark}
                title="Retirer uniquement le filigrane et le bloc BAT"
                className="flex cursor-pointer items-center gap-1 rounded px-2 py-1.5 text-[10px] font-semibold text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-3 w-3" />
                Désactiver
              </button>
            )}

            {/* One export, for both modes: it always captures the studio. */}
            <ExportButtons
              onExport={(format) => void exportStudio(format)}
              exporting={sheetExporting}
              paperFormat={exportPaperFormat}
              paperOptions={EXPORT_PAPER_OPTIONS}
              onPaperFormatChange={(key) => setExportPaperFormat(key as ExportPaperFormat)}
            />

            <button
              onClick={handleSave}
              disabled={saving}
              title="Sauvegarder le projet"
              className="flex cursor-pointer items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              <span>{saveStatus || "Sauvegarder"}</span>
            </button>

            </div>

            <div className="flex min-h-7 min-w-0 items-center gap-1.5 whitespace-nowrap overflow-x-auto no-scrollbar [&>*]:shrink-0">

            <span className="h-5 w-px bg-white/10" />

            <input
              type="file"
              ref={changePlanInputRef}
              accept="image/*,application/pdf"
              onChange={handleChangePlanFile}
              className="hidden"
            />

            <input
              type="file"
              ref={planOverlayInputRef}
              accept="image/*,application/pdf"
              multiple
              onChange={handleAddPlanOverlayFile}
              className="hidden"
            />

            <button
              onClick={() => changePlanInputRef.current?.click()}
              disabled={changingBackground || cleaning || grokCleaning}
              title="Importer un autre plan d'arrière-plan principal (Image ou PDF)"
              className="flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              {changingBackground ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
              ) : (
                <FileUp className="h-3.5 w-3.5 text-sky-400" />
              )}
              <span>Changer le plan</span>
            </button>

            <button
              onClick={() => planOverlayInputRef.current?.click()}
              disabled={importingOverlays}
              title="Insérer une ou plusieurs images/PDF sur le canvas (chaque page PDF devient un plan manipulable)"
              className="flex cursor-pointer items-center gap-1.5 rounded border border-sky-600/40 bg-sky-950/60 px-2.5 py-1.5 text-[11px] font-semibold text-sky-200 transition-colors hover:bg-sky-900/80 hover:text-white"
            >
              {importingOverlays ? <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" /> : <FileUp className="h-3.5 w-3.5 text-sky-400" />}
              <span>{importingOverlays ? "Import..." : "+ Insérer des plans"}</span>
            </button>

            {selectedOverlayId && selectedOverlayId !== MAIN_PLAN_ID && (
              <button
                onClick={() => {
                  setSelectedCleanTargetId(selectedOverlayId);
                  setCleanModalOpen(true);
                }}
                disabled={cleaning || grokCleaning}
                title="Nettoyer directement le plan secondaire actuellement sélectionné"
                className="flex cursor-pointer items-center gap-1.5 rounded border border-emerald-600/40 bg-emerald-950/60 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-200 transition-colors hover:bg-emerald-900/80 hover:text-white"
              >
                <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                <span>Nettoyer ce plan</span>
              </button>
            )}

            <button
              type="button"
              onClick={activateAreaSelection}
              disabled={sheetActive}
              title={sheetActive
                ? "La sélection par zone est disponible dans l’affichage Plan seul"
                : "Tracer un rectangle avec la souris pour sélectionner plusieurs pictogrammes, formes et textes"}
              className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                areaSelectionMode
                  ? "border-sky-400 bg-sky-900/80 text-sky-100"
                  : multiSelectionCount > 0
                    ? "border-sky-600/50 bg-sky-950/70 text-sky-200 hover:bg-sky-900/80"
                    : "border-white/10 bg-black/20 text-neutral-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              <BoxSelect className="h-3.5 w-3.5" />
              <span>{areaSelectionMode ? "Tracez la zone…" : multiSelectionCount > 0 ? `${multiSelectionCount} sélectionnés` : "Sélection par zone"}</span>
            </button>

            {multiSelectionCount >= 2 && (
              <button
                type="button"
                onClick={handleGroupMultiSelection}
                title="Créer un groupe indépendant avec les objets sélectionnés"
                className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                  sharedObjectGroupId
                    ? "border-violet-500/50 bg-violet-950/70 text-violet-200 hover:bg-violet-900/80"
                    : "border-white/10 bg-black/20 text-neutral-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <GroupIcon className="h-3.5 w-3.5" />
                <span>{sharedObjectGroupId ? "Mettre à jour le groupe d’objets" : "Regrouper la sélection"}</span>
              </button>
            )}
            {multiSelectionCount > 0 && selectedMultiObjectGroupIds.length > 0 && (
              <button
                type="button"
                onClick={handleUngroupMultiSelection}
                title="Dissocier le groupe d’objets sans supprimer ses éléments"
                className="flex cursor-pointer items-center gap-1 rounded px-2 py-1.5 text-[10px] font-semibold text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Ungroup className="h-3.5 w-3.5" />
                <span>Dissocier les objets</span>
              </button>
            )}
            {multiSelectionCount > 0 && (
              <button
                type="button"
                onClick={handleExportSelectedGroupSvg}
                title="Exporter la sélection ou le groupe d’objets en SVG"
                className="flex cursor-pointer items-center gap-1 rounded px-2 py-1.5 text-[10px] font-semibold text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Exporter SVG</span>
              </button>
            )}

            {selectedOverlayId && (
              <button
                type="button"
                onClick={handleGroupSelectedPlan}
                title="Associer au plan sélectionné les pictogrammes, zones et textes placés visuellement dessus"
                className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                  selectedPlanGroupId
                    ? "border-indigo-500/50 bg-indigo-950/70 text-indigo-200 hover:bg-indigo-900/80"
                    : "border-white/10 bg-black/20 text-neutral-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <GroupIcon className="h-3.5 w-3.5" />
                <span>{selectedPlanGroupId ? "Mettre à jour le groupe" : "Regrouper avec le plan"}</span>
              </button>
            )}
            {selectedOverlayId && selectedPlanGroupId && (
              <button
                type="button"
                onClick={handleUngroupSelectedPlan}
                title="Dissocier uniquement les éléments regroupés, sans les supprimer"
                className="flex cursor-pointer items-center gap-1 rounded px-2 py-1.5 text-[10px] font-semibold text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Ungroup className="h-3.5 w-3.5" />
                <span>Dissocier</span>
              </button>
            )}

            {hasLockableSelection && (
              <button
                type="button"
                onClick={toggleSelectedObjectLock}
                title={selectedObjectLocked ? "Déverrouiller l’objet sélectionné" : "Verrouiller l’objet sélectionné pour éviter un déplacement accidentel"}
                className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                  selectedObjectLocked
                    ? "border-amber-500/50 bg-amber-950/70 text-amber-200 hover:bg-amber-900/80"
                    : "border-white/10 bg-black/20 text-neutral-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                {selectedObjectLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                <span>{selectedObjectLocked ? "Objet verrouillé" : "Verrouiller l’objet"}</span>
              </button>
            )}

            <button
              onClick={() => setKeepPlanRatio((prev) => !prev)}
              title={
                keepPlanRatio
                  ? "Mode d'agrandissement actuel : Proportions réelles conservées (🔒 Garder ratio). Cliquer pour passer en Déformation libre."
                  : "Mode d'agrandissement actuel : Déformation libre (🔓 Déformer). Cliquer pour verrouiller les proportions réelles."
              }
              className={`flex cursor-pointer items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                keepPlanRatio
                  ? "border-emerald-600/40 bg-emerald-950/60 text-emerald-200 hover:bg-emerald-900/80"
                  : "border-amber-600/40 bg-amber-950/60 text-amber-200 hover:bg-amber-900/80"
              }`}
            >
              {keepPlanRatio ? (
                <>
                  <Lock className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Proportions réelles (🔒 Garder)</span>
                </>
              ) : (
                <>
                  <Unlock className="h-3.5 w-3.5 text-amber-400" />
                  <span>Déformation libre (🔓 Déformer)</span>
                </>
              )}
            </button>

            {selectedOverlayId && selectedOverlayId !== MAIN_PLAN_ID && (
              <button
                onClick={handleDeleteSelectedOverlay}
                title="Supprimer le plan secondaire sélectionné"
                className="flex cursor-pointer items-center gap-1.5 rounded border border-red-600/40 bg-red-950/60 px-2 py-1 text-[11px] font-semibold text-red-200 transition-colors hover:bg-red-900/80 hover:text-white"
              >
                <Trash2 className="h-3.5 w-3.5 text-red-400" />
                <span>Supprimer plan</span>
              </button>
            )}

            <button
              onClick={openPolygonCrop}
              disabled={cropping || changingBackground || cleaning || grokCleaning}
              title="Rogner / Croper le plan avec un tracé libre au crayon/lasso ou un cadre"
              className="flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              {cropping ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
              ) : (
                <Crop className="h-3.5 w-3.5 text-sky-400" />
              )}
              <span>Rogner</span>
            </button>

            <button
              onClick={() => {
                setSelectedCleanTargetId(selectedOverlayId || "main");
                setCleanModalOpen(true);
              }}
              disabled={cleaning || grokCleaning}
              title="Nettoyer le plan sélectionné"
              className="flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              {cleaning || grokCleaning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              <span>Nettoyer</span>
            </button>

            {(selectedOverlay
              ? selectedOverlay.canRevertOriginal && !selectedOverlay.isOriginal
              : plan?.use_cleaned_background) && (
              <button
                onClick={() => {
                  setSelectedCleanTargetId(selectedOverlay?.tempId || MAIN_PLAN_ID);
                  setRevertConfirmOpen(true);
                }}
                disabled={cleaning}
                title="Revenir au plan original"
                className="flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                {cleaning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                <span>Original</span>
              </button>
            )}

            </div>
          </div>
        </header>

        {/* ───────────────── Workspace: left rail | canvas | right rail ───────────────── */}
        <div className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden">
          {/* Left dock — fixed width, never scrolls the page */}
          <aside
            style={{ width: leftDockOpen ? 208 : 0, minWidth: leftDockOpen ? 208 : 0, flex: leftDockOpen ? "0 0 208px" : "0 0 0px" }}
            className="flex shrink-0 flex-col overflow-hidden border-r border-black/50 bg-[#252527]"
          >
            <div className="grid h-9 shrink-0 grid-cols-2 border-b border-black/50 bg-[#202022] p-1">
              <button
                type="button"
                onClick={() => setLeftDockTab("library")}
                className={`flex cursor-pointer items-center justify-center gap-1 rounded text-[10px] font-semibold transition-colors ${
                  leftDockTab === "library" ? "bg-white/10 text-white" : "text-neutral-500 hover:text-neutral-200"
                }`}
              >
                <Library className="h-3.5 w-3.5" />
                Bibliothèque
              </button>
              <button
                type="button"
                onClick={() => setLeftDockTab("layers")}
                className={`flex cursor-pointer items-center justify-center gap-1 rounded text-[10px] font-semibold transition-colors ${
                  leftDockTab === "layers" ? "bg-sky-600 text-white" : "text-neutral-500 hover:text-neutral-200"
                }`}
              >
                <Layers3 className="h-3.5 w-3.5" />
                Calques
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {leftDockTab === "library" ? (
                <IconToolbar
                  onAddIcon={handleAddIcon}
                  activeIconType={placementIconType}
                  onCancelPlacement={() => setPlacementIconType(null)}
                  iconDefinitions={availableIconDefinitions}
                  onAddSvg={handleAddSvgPictogram}
                  onDeleteSvg={handleDeleteSvgPictogram}
                  onRenameSvg={handleRenameSvgPictogram}
                  onAddText={handleAddText}
                  placementTextActive={placementText}
                  onCancelTextPlacement={() => setPlacementText(false)}
                />
              ) : (
                <LayerPanel
                  items={activeLayerItems}
                  selectedId={selectedLayerId}
                  onSelect={handleSelectLayer}
                  onToggleVisibility={handleToggleLayerVisibility}
                  onToggleLock={handleToggleLayerLock}
                  onMove={handleMoveLayer}
                  onReorder={handleReorderLayers}
                />
              )}
            </div>
          </aside>

          {/* Canvas — the only fluid region. At 100% CSS flex gives it exactly
              the space left after the two fixed docks, without relying on a
              JavaScript copy of the browser width. */}
          <div
            className="relative"
            style={
              canvasWidthPercent < 100
                ? {
                    width: `max(160px, calc((100% - ${leftDockWidth + rightDockWidth}px) * ${canvasWidthPercent / 100}))`,
                    flex: "0 0 auto",
                    minWidth: 0,
                    overflow: "hidden"
                  }
                : { flex: "1 1 0%", minWidth: 0, overflow: "hidden" }
            }
          >
            {cleaning ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[#1b1b1d]">
                <Loader2 className="h-9 w-9 animate-spin text-emerald-500" />
                <p className="text-xs text-neutral-400">{cleaningText}</p>
              </div>
            ) : (
              plan && (
                <PlanCanvas
                  backgroundUrl={backgroundUrl}
                  backgroundType={backgroundType}
                  icons={icons}
                  onIconsChange={handleIconsChange}
                  selectedIconId={selectedIconId}
                  planRotation={effectivePlanRotation}
                  onSelectIcon={(iconId) => {
                    setSelectedIconId(iconId);
                    if (iconId) {
                      setMultiSelection({ iconIds: [], shapeIds: [], textIds: [] });
                      setSelectedBatBlock(false);
                      setSelectedShapeId(null);
                      setSelectedTextId(null);
                      setSelectedBlockId(null);
                    }
                  }}
                  sheet={sheetProp}
                  onSheetBlocksChange={setSheetBlocks}
                  selectedBlockId={selectedBlockId}
                  onSelectBlock={(blockId) => {
                    setSelectedBlockId(blockId);
                    if (blockId) {
                      setMultiSelection({ iconIds: [], shapeIds: [], textIds: [] });
                      setSelectedBatBlock(false);
                    }
                  }}
                  sheetImages={sheetLogoImages}
                  sheetLegendEntries={sheetLegendEntries}
                  sheetPictoImages={sheetLegendImages}
                  onPlaceSheetIcon={handlePlaceSheetIcon}
                  onPlaceSheetText={handlePlaceSheetText}
                  onPlaceSheetShape={handlePlaceSheetShape}
                  planReframeMode={sheetReframeMode}
                  planPlacement={sheetPlanPlacement}
                  onPlanPlacementChange={setSheetPlanPlacement}
                  mainPlanTransform={mainPlanTransform}
                  onMainPlanTransformChange={setMainPlanTransform}
                  mainPlanLocked={mainPlanLocked}
                  mainPlanVisible={mainPlanVisible}
                  mainPlanZIndex={mainPlanZIndex}
                  mainPlanGroupId={mainPlanGroupId}
                  mainPlanGroupingEnabled={mainPlanGroupingEnabled}
                  areaSelectionMode={areaSelectionMode}
                  multiSelection={multiSelection}
                  onMultiSelectionChange={setMultiSelection}
                  onAreaSelectionComplete={handleAreaSelectionComplete}
                  planOverlays={planOverlays}
                  onPlanOverlaysChange={setPlanOverlays}
                  selectedOverlayId={selectedOverlayId}
                  onSelectOverlay={(overlayId) => {
                    setSelectedOverlayId(overlayId);
                    if (overlayId) {
                      setMultiSelection({ iconIds: [], shapeIds: [], textIds: [] });
                      setSelectedBatBlock(false);
                      setSelectedIconId(null);
                      setSelectedShapeId(null);
                      setSelectedTextId(null);
                      setSelectedBlockId(null);
                    }
                  }}
                  keepPlanRatio={keepPlanRatio}
                  watermark={watermarkConfig}
                  onWatermarkChange={setWatermarkConfig}
                  selectedBatBlock={selectedBatBlock}
                  onSelectBatBlock={(selected) => {
                    setSelectedBatBlock(selected);
                    if (selected) setMultiSelection({ iconIds: [], shapeIds: [], textIds: [] });
                  }}
                  zoom={zoom}
                  setZoom={setZoom}
                  mode={mode}
                  placementIconType={placementIconType}
                  placementIconSize={defaultIconSize}
                  onPlaceIcon={handlePlaceIcon}
                  iconDefinitions={iconDefinitions}
                  fitSignal={fitSignal}
                  canvasRef={planCanvasRef}
                  eraserSize={eraserSize}
                  eraserShape={eraserShape}
                  eraserTarget={eraserTarget}
                  undoEraseSignal={undoEraseSignal}
                  resetEraseSignal={resetEraseSignal}
                  eraseStrokeTarget={eraseStrokeTarget}
                  onEraseStrokesChange={setEraseStrokeCount}
                  shapes={shapes}
                  onShapesChange={setShapes}
                  selectedShapeId={selectedShapeId}
                  onSelectShape={(shapeId) => {
                    setSelectedShapeId(shapeId);
                    if (shapeId) {
                      const clickedShape = shapes.find((shape) => shape.tempId === shapeId);
                      setMultiSelection(
                        clickedShape?.object_group_id
                          ? getObjectGroupSelection(clickedShape.object_group_id)
                          : { iconIds: [], shapeIds: [], textIds: [] }
                      );
                      setSelectedBatBlock(false);
                      setSelectedIconId(null);
                      setSelectedTextId(null);
                      setSelectedBlockId(null);
                    }
                  }}
                  shapeTool={shapeTool}
                  onFinishShapeTool={() => setShapeTool(null)}
                  shapeStrokeWidth={shapeStrokeWidth}
                  shapeColor={shapeColor}
                  texts={texts}
                  onTextsChange={handleTextsChange}
                  selectedTextId={selectedTextId}
                  onSelectText={(textId) => {
                    setSelectedTextId(textId);
                    if (textId) {
                      setMultiSelection({ iconIds: [], shapeIds: [], textIds: [] });
                      setSelectedBatBlock(false);
                      setSelectedIconId(null);
                      setSelectedShapeId(null);
                      setSelectedBlockId(null);
                    }
                  }}
                  placementText={placementText}
                  onPlaceText={handlePlaceText}
                />
              )
            )}
          </div>

          {/* Right dock — kept narrow so the plan keeps the maximum area */}
          <aside
            style={{ width: rightDockOpen ? 224 : 0, minWidth: rightDockOpen ? 224 : 0, flex: rightDockOpen ? "0 0 224px" : "0 0 0px" }}
            className="shrink-0 flex flex-col overflow-hidden border-l border-black/50 bg-[#252527]"
          >
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-black/40 px-3">
              <Settings className="h-3.5 w-3.5 text-neutral-500" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">
                Propriétés
              </span>
            </div>

            {selectedBlock ? (
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
                <div className="border-b border-black/40 px-3 py-3">
                  <p className="truncate text-xs font-semibold text-neutral-100">{selectedBlock.label}</p>
                  <p className="text-[10px] text-neutral-500">
                    {selectedBlock.kind === "picto"
                      ? "Pictogramme libre · glissez-le où vous voulez sur la feuille"
                      : selectedBlock.kind === "plan"
                        ? "Fenêtre du plan · glissez pour la déplacer, poignées pour la redimensionner"
                        : "Bloc de la feuille · glissez à la souris, double-cliquez pour écrire dessus"}
                  </p>
                </div>

                <div className="space-y-3 p-3">
                  {selectedBlock.kind === "plan" ? (
                    <>
                      <div className="rounded border border-white/10 bg-black/20 p-2.5">
                        <p className="text-[10px] leading-relaxed text-neutral-400">
                          Glissez le plan pour déplacer sa fenêtre sur la feuille. Maintenez{" "}
                          <kbd className="rounded bg-white/10 px-1 font-semibold text-neutral-200">Alt</kbd> en
                          glissant — ou activez le bouton ci-dessous — pour recadrer le plan à
                          l&apos;intérieur du cadre.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSheetReframeMode((active) => !active)}
                        className={`w-full rounded border py-1.5 text-[11px] font-semibold transition-colors ${
                          sheetReframeMode
                            ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                            : "border-white/10 text-neutral-300 hover:bg-white/10"
                        }`}
                      >
                        {sheetReframeMode ? "Recadrage actif — glissez le plan" : "Recadrer le plan dans le cadre"}
                      </button>
                      <div>
                        <div className="mb-1 flex justify-between text-[10px] text-neutral-400">
                          <span>Zoom du plan</span>
                          <span>{sheetPlanPlacement.scale}%</span>
                        </div>
                        <input
                          type="range"
                          min={20}
                          max={300}
                          value={sheetPlanPlacement.scale}
                          onChange={(event) =>
                            setSheetPlanPlacement((placement) => ({
                              ...placement,
                              scale: Number(event.target.value)
                            }))
                          }
                          className="w-full accent-emerald-500"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setSheetPlanPlacement({ scale: 100, offsetX: 0, offsetY: 0 })}
                        className="w-full rounded border border-white/10 py-1.5 text-[11px] font-semibold text-neutral-300 transition-colors hover:bg-white/10"
                      >
                        Recentrer le plan dans le cadre
                      </button>
                    </>
                  ) : null}

                  {selectedBlock.kind !== "plan" &&
                    selectedBlock.kind !== "image" &&
                    selectedBlock.kind !== "picto" &&
                    selectedBlock.kind !== "shape" && (
                    <>
                      {selectedBlock.title !== undefined && (
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                            Titre du bloc
                          </span>
                          <input
                            value={selectedBlock.title ?? ""}
                            onChange={(event) => updateSelectedBlock({ title: event.target.value })}
                            className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-neutral-100 outline-none focus:border-emerald-500"
                          />
                        </label>
                      )}

                      {selectedBlock.kind !== "legend" && (
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                            Texte
                          </span>
                          <textarea
                            value={selectedBlock.text ?? ""}
                            onChange={(event) => updateSelectedBlock({ text: event.target.value })}
                            rows={selectedBlock.kind === "band" || selectedBlock.kind === "numbers" ? 2 : 9}
                            className="w-full resize-y rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] leading-relaxed text-neutral-100 outline-none focus:border-emerald-500"
                          />
                        </label>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                            Taille
                          </span>
                          <input
                            type="number"
                            min={6}
                            max={90}
                            step={0.5}
                            value={selectedBlock.fontSize ?? 14}
                            onChange={(event) => updateSelectedBlock({ fontSize: Number(event.target.value) })}
                            className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-neutral-100 outline-none focus:border-emerald-500"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                            Interligne
                          </span>
                          <input
                            type="number"
                            min={0.8}
                            max={3}
                            step={0.05}
                            value={selectedBlock.lineHeight ?? 1.3}
                            onChange={(event) => updateSelectedBlock({ lineHeight: Number(event.target.value) })}
                            className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-neutral-100 outline-none focus:border-emerald-500"
                          />
                        </label>
                      </div>

                      <div className="flex items-center gap-1">
                        {(["left", "center", "right"] as const).map((align) => (
                          <button
                            key={align}
                            type="button"
                            onClick={() => updateSelectedBlock({ align })}
                            className={`flex-1 rounded py-1 text-[10px] font-semibold transition-colors ${
                              (selectedBlock.align ?? "left") === align
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "text-neutral-400 hover:bg-white/10"
                            }`}
                          >
                            {align === "left" ? "Gauche" : align === "center" ? "Centre" : "Droite"}
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-3">
                        <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold text-neutral-400">
                          <input
                            type="checkbox"
                            checked={(selectedBlock.fontStyle ?? "normal").includes("bold")}
                            onChange={(event) =>
                              updateSelectedBlock({ fontStyle: event.target.checked ? "bold" : "normal" })
                            }
                            className="h-3.5 w-3.5 accent-emerald-500"
                          />
                          Gras
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold text-neutral-400">
                          <input
                            type="checkbox"
                            checked={Boolean(selectedBlock.uppercase)}
                            onChange={(event) => updateSelectedBlock({ uppercase: event.target.checked })}
                            className="h-3.5 w-3.5 accent-emerald-500"
                          />
                          Majuscules
                        </label>
                      </div>
                    </>
                  )}

                  {selectedBlock.kind === "shape" && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                            Trait
                          </span>
                          <input
                            type="color"
                            value={selectedBlock.stroke || "#000000"}
                            onChange={(event) => updateSelectedBlock({ stroke: event.target.value })}
                            className="h-7 w-full cursor-pointer rounded border border-white/10 bg-black/30"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                            Remplissage
                          </span>
                          <input
                            type="color"
                            value={selectedBlock.fill || selectedBlock.stroke || "#000000"}
                            onChange={(event) => updateSelectedBlock({ fill: event.target.value })}
                            className="h-7 w-full cursor-pointer rounded border border-white/10 bg-black/30"
                          />
                        </label>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                            Épaisseur
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={60}
                            value={selectedBlock.strokeWidth ?? 3}
                            onChange={(event) => updateSelectedBlock({ strokeWidth: Number(event.target.value) })}
                            className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-neutral-100 outline-none focus:border-emerald-500"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                            Opacité {Math.round((selectedBlock.fillOpacity ?? 0.35) * 100)}%
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={selectedBlock.fillOpacity ?? 0.35}
                            onChange={(event) => updateSelectedBlock({ fillOpacity: Number(event.target.value) })}
                            className="mt-2 w-full accent-emerald-500"
                          />
                        </label>
                      </div>
                      {selectedBlock.shapeType !== "line" && selectedBlock.shapeType !== "polyline" && (
                        <button
                          type="button"
                          onClick={() => updateSelectedBlock({
                            fill: selectedBlock.fill ? undefined : selectedBlock.stroke || "#000000"
                          })}
                          className="w-full rounded border border-white/10 py-1.5 text-[10px] font-semibold text-neutral-300 transition-colors hover:bg-white/10"
                        >
                          {selectedBlock.fill ? "Retirer le remplissage" : "Ajouter un remplissage"}
                        </button>
                      )}
                    </div>
                  )}

                  {selectedBlock.kind !== "image" && selectedBlock.kind !== "picto" && selectedBlock.kind !== "shape" && (
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { key: "color" as const, label: "Texte" },
                        { key: "fill" as const, label: "Fond" },
                        { key: "stroke" as const, label: "Bordure" },
                        { key: "titleFill" as const, label: "Fond titre" },
                        { key: "titleColor" as const, label: "Texte titre" }
                      ])
                        .filter((field) =>
                          field.key === "titleFill" || field.key === "titleColor"
                            ? Boolean(selectedBlock.title)
                            : true
                        )
                        .map((field) => (
                          <label key={field.key} className="block">
                            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                              {field.label}
                            </span>
                            <input
                              type="color"
                              value={selectedBlock[field.key] || "#000000"}
                              onChange={(event) => updateSelectedBlock({ [field.key]: event.target.value })}
                              className="h-7 w-full cursor-pointer rounded border border-white/10 bg-black/30"
                            />
                          </label>
                        ))}
                    </div>
                  )}

                  {selectedBlock.kind === "picto" && (
                    <div className="border-t border-white/10 pt-3">
                      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                        Couleur du pictogramme
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => updateSelectedBlock({ color: undefined })}
                          className={`rounded border px-2 py-1 text-[10px] font-medium transition-colors ${
                            !selectedBlock.color
                              ? "border-sky-500 bg-sky-500/20 text-sky-300"
                              : "border-black/50 bg-[#1b1b1d] text-neutral-300 hover:bg-white/10"
                          }`}
                          title="Rendre au pictogramme sa couleur d’origine"
                        >
                          D&apos;origine
                        </button>
                        {ICON_COLOR_SWATCHES.map((swatch) => (
                          <button
                            key={swatch.value}
                            type="button"
                            onClick={() => updateSelectedBlock({ color: swatch.value })}
                            className={`h-6 w-6 cursor-pointer rounded border transition-transform hover:scale-110 ${
                              selectedBlock.color?.toLowerCase() === swatch.value
                                ? "border-white ring-2 ring-sky-400"
                                : "border-black/50"
                            }`}
                            style={{ backgroundColor: swatch.value }}
                            title={swatch.label}
                            aria-label={swatch.label}
                          />
                        ))}
                        <input
                          type="color"
                          value={selectedBlock.color || "#ef4444"}
                          onChange={(event) => updateSelectedBlock({ color: event.target.value.toLowerCase() })}
                          className="h-6 w-8 cursor-pointer rounded border border-black/50 bg-transparent p-0"
                          title="Choisir une couleur libre"
                        />
                      </div>
                      {selectedBlock.color ? (
                        <p className="mt-1.5 text-[10px] leading-snug text-amber-400/90">
                          Une teinte modifiée peut ne plus être conforme à la couleur réglementaire du pictogramme.
                        </p>
                      ) : null}
                    </div>
                  )}

                  <div className="border-t border-white/10 pt-3">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                      Ordre du calque
                    </span>
                    <div className="grid grid-cols-4 gap-1">
                      {([
                        { direction: "front" as const, label: "Tout devant", symbol: "⇈", disabled: selectedSheetLayerIndex <= 0 },
                        { direction: "up" as const, label: "Avancer", symbol: "↑", disabled: selectedSheetLayerIndex <= 0 },
                        { direction: "down" as const, label: "Reculer", symbol: "↓", disabled: selectedSheetLayerIndex < 0 || selectedSheetLayerIndex >= sheetLayerItems.length - 1 },
                        { direction: "back" as const, label: "Tout derrière", symbol: "⇊", disabled: selectedSheetLayerIndex < 0 || selectedSheetLayerIndex >= sheetLayerItems.length - 1 },
                      ]).map((control) => (
                        <button
                          key={control.direction}
                          type="button"
                          disabled={control.disabled}
                          onClick={() => handleMoveLayer(selectedBlock.id, control.direction)}
                          title={control.label}
                          aria-label={control.label}
                          className="flex h-7 cursor-pointer items-center justify-center rounded border border-white/10 text-sm font-semibold text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
                        >
                          {control.symbol}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[9px] leading-snug text-neutral-500">
                      Le calque placé le plus haut apparaît devant les autres blocs de la feuille.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t border-white/10 pt-3">
                    {([
                      { key: "x" as const, label: "X" },
                      { key: "y" as const, label: "Y" },
                      { key: "width" as const, label: "Largeur" },
                      { key: "height" as const, label: "Hauteur" }
                    ]).map((field) => (
                      <label key={field.key} className="block">
                        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                          {field.label}
                        </span>
                        <input
                          type="number"
                          value={Math.round(selectedBlock[field.key])}
                          onChange={(event) => updateSelectedBlock({ [field.key]: Number(event.target.value) })}
                          className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-neutral-100 outline-none focus:border-emerald-500"
                        />
                      </label>
                    ))}
                  </div>

                  <div className="flex items-center justify-between border-t border-white/10 pt-3">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold text-neutral-400">
                      <input
                        type="checkbox"
                        checked={selectedBlock.visible}
                        onChange={(event) => updateSelectedBlock({ visible: event.target.checked })}
                        className="h-3.5 w-3.5 accent-emerald-500"
                      />
                      Visible
                    </label>
                    {selectedBlock.kind !== "plan" && (
                      <button
                        type="button"
                        onClick={() => {
                          setSheetBlocks((blocks) => blocks.filter((block) => block.id !== selectedBlock.id));
                          setSelectedBlockId(null);
                        }}
                        className="flex cursor-pointer items-center gap-1.5 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-400 transition-colors hover:bg-red-500/20"
                      >
                        <Trash2 className="h-3 w-3" />
                        Supprimer
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : multiSelectionCount > 0 ? (
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
                <div className="flex items-center gap-3 border-b border-black/40 px-3 py-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-violet-500/30 bg-violet-500/10 text-violet-300">
                    <GroupIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-neutral-100">
                      {sharedObjectGroupId ? "Groupe d’objets" : "Sélection multiple"}
                    </p>
                    <p className="text-[10px] text-neutral-500">
                      {multiSelectionCount} objet{multiSelectionCount > 1 ? "s" : ""} · {selectedMultiShapes.length} tracé{selectedMultiShapes.length > 1 ? "s" : ""}
                    </p>
                  </div>
                </div>

                <div className="space-y-4 p-3">
                  <div className="rounded border border-violet-500/20 bg-violet-500/5 p-2.5">
                    <p className="text-[10px] leading-relaxed text-neutral-400">
                      {sharedObjectGroupId
                        ? "Ce groupe se déplace comme un seul objet. La couleur et l’épaisseur ci-dessous s’appliquent à tous ses tracés."
                        : "Regroupez la sélection pour la déplacer comme un seul objet et retrouver ses tracés en un clic."}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {multiSelectionCount >= 2 && (
                        <button
                          type="button"
                          onClick={handleGroupMultiSelection}
                          className={`flex cursor-pointer items-center justify-center gap-1.5 rounded border py-1.5 text-[10px] font-semibold transition-colors ${
                            sharedObjectGroupId
                              ? "border-violet-500/40 bg-violet-500/20 text-violet-200"
                              : "border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10"
                          }`}
                        >
                          <GroupIcon className="h-3.5 w-3.5" />
                          {sharedObjectGroupId ? "Groupe actif" : "Grouper"}
                        </button>
                      )}
                      {selectedMultiObjectGroupIds.length > 0 && (
                        <button
                          type="button"
                          onClick={handleUngroupMultiSelection}
                          className="flex cursor-pointer items-center justify-center gap-1.5 rounded border border-white/10 bg-white/5 py-1.5 text-[10px] font-semibold text-neutral-300 transition-colors hover:bg-white/10"
                        >
                          <Ungroup className="h-3.5 w-3.5" />
                          Dissocier
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleExportSelectedGroupSvg}
                        className="flex cursor-pointer items-center justify-center gap-1.5 rounded border border-white/10 bg-white/5 py-1.5 text-[10px] font-semibold text-neutral-300 transition-colors hover:bg-white/10"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Exporter SVG
                      </button>
                    </div>
                  </div>

                  {selectedMultiShapes.length > 0 ? (
                    <>
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                            Couleur des tracés
                          </span>
                          {multiShapeColorsMixed && (
                            <span className="text-[9px] font-medium text-amber-400">Couleurs mixtes</span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <input
                            type="color"
                            value={multiShapeColor}
                            onChange={(event) => handleUpdateMultiShapeStyle("color", event.target.value)}
                            className="h-7 w-9 shrink-0 cursor-pointer rounded border border-black/50 bg-transparent"
                          />
                          <input
                            type="text"
                            value={multiShapeColor}
                            onChange={(event) => handleUpdateMultiShapeStyle("color", event.target.value)}
                            className="w-full rounded border border-black/50 bg-[#1b1b1d] px-2 py-1 text-[11px] tabular-nums text-neutral-200 focus:border-violet-500/60 focus:outline-none"
                          />
                        </div>
                        <div className="mt-2.5 grid grid-cols-6 gap-1.5">
                          {PRESET_COLORS.map((preset) => (
                            <button
                              key={`multi-stroke-${preset.hex}`}
                              type="button"
                              title={`${preset.name} — appliquer aux ${selectedMultiShapes.length} tracés`}
                              onClick={() => handleUpdateMultiShapeStyle("color", preset.hex)}
                              className={`h-6 w-full rounded border transition-transform hover:scale-105 focus:outline-none ${
                                !multiShapeColorsMixed && multiShapeColor === preset.hex
                                  ? "border-violet-400 ring-2 ring-violet-400/50"
                                  : "border-white/20"
                              }`}
                              style={{ backgroundColor: preset.hex }}
                            />
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                            Épaisseur commune
                          </span>
                          <span className={`text-[10px] tabular-nums ${multiShapeWidthsMixed ? "text-amber-400" : "text-neutral-400"}`}>
                            {multiShapeWidthsMixed ? "Mixte" : `${multiShapeStrokeWidth} px`}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={40}
                          value={multiShapeStrokeWidth}
                          onChange={(event) => handleUpdateMultiShapeStyle("stroke_width", Number(event.target.value))}
                          className="mt-1.5 h-1 w-full cursor-pointer accent-violet-500"
                        />
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            max={40}
                            value={multiShapeStrokeWidth}
                            onChange={(event) => handleUpdateMultiShapeStyle("stroke_width", Number(event.target.value))}
                            className="w-20 rounded border border-black/50 bg-[#1b1b1d] px-2 py-1 text-[11px] tabular-nums text-neutral-200 focus:border-violet-500/60 focus:outline-none"
                          />
                          <span className="text-[10px] text-neutral-500">px pour tous les tracés</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="rounded border border-white/10 bg-black/15 p-2.5 text-[10px] leading-relaxed text-neutral-500">
                      Cette sélection ne contient aucune ligne. Les commandes de couleur et d’épaisseur apparaissent dès qu’un tracé est inclus.
                    </p>
                  )}
                </div>
              </div>
            ) : selectedIcon ? (
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
                {/* Selected element identity */}
                {(() => {
                  const definition = iconDefinitions[selectedIcon.icon_type];
                  return (
                    <div className="flex items-center gap-3 border-b border-black/40 px-3 py-3">
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-white/10 p-1.5"
                        style={{
                          backgroundColor: `${definition?.color || "#22c55e"}1a`,
                          color: definition?.color || "#22c55e"
                        }}
                      >
                        {definition?.imageUrl ? (
                          <img src={definition.imageUrl} alt="" className="h-full w-full object-contain" />
                        ) : (
                          <span className="h-full w-full" dangerouslySetInnerHTML={{ __html: definition?.svg || "" }} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-neutral-100">
                          {definition?.label || selectedIcon.icon_type}
                        </p>
                        <p className="text-[10px] text-neutral-500">Équipement de sécurité</p>
                      </div>
                    </div>
                  );
                })()}

                <div className="space-y-4 p-3">
                  {/* The marker that orients the whole sheet */}
                  {isYouAreHereIcon(selectedIcon.icon_type, iconDefinitions) && (
                    <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2.5">
                      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-300">
                        Orientation du plan
                      </span>
                      <p className="mb-2 text-[10px] leading-relaxed text-neutral-400">
                        La rotation de ce repère est la direction du regard du lecteur. Le plan
                        tourne aussitôt à l&apos;écran pour amener cette direction vers le haut de la
                        feuille, et les pictogrammes d&apos;équipement sont automatiquement redressés
                        — seules les flèches directionnelles suivent.
                      </p>
                      <div className="mb-2 grid grid-cols-4 gap-1">
                        {[0, 90, 180, 270].map((angle) => (
                          <button
                            key={angle}
                            type="button"
                            onClick={() => handleUpdateSelectedIcon("rotation", angle)}
                            className={`cursor-pointer rounded py-1 text-[11px] font-semibold transition-colors ${
                              Math.round(selectedIcon.rotation) === angle
                                ? "bg-emerald-600 text-white"
                                : "bg-white/[0.06] text-neutral-300 hover:bg-white/15"
                            }`}
                          >
                            {angle}°
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-neutral-400">
                        <span>Angle appliqué</span>
                        <span className="tabular-nums text-emerald-300">
                          {Math.round(selectedIcon.rotation)}°
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Label */}
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                      Libellé
                    </label>
                    <input
                      type="text"
                      value={selectedIcon.label}
                      onChange={(e) => handleUpdateSelectedIcon("label", e.target.value)}
                      placeholder="Ex: Hall principal…"
                      className="w-full rounded border border-black/50 bg-[#1b1b1d] px-2 py-1.5 text-xs text-neutral-200 placeholder-neutral-600 focus:border-emerald-500/60 focus:outline-none"
                    />
                  </div>

                  {/* Geometry */}
                  <div>
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                      Transformation
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex items-center gap-1.5 rounded border border-black/50 bg-[#1b1b1d] px-2 py-1.5">
                        <span className="text-[10px] font-medium text-neutral-500">L</span>
                        <input
                          type="number"
                          min="15"
                          max="1000"
                          value={Math.round(selectedIcon.width)}
                          onChange={(e) => handleUpdateSelectedIcon("width", Number(e.target.value))}
                          className="w-full bg-transparent text-xs tabular-nums text-neutral-200 focus:outline-none"
                        />
                      </label>
                      <label className="flex items-center gap-1.5 rounded border border-black/50 bg-[#1b1b1d] px-2 py-1.5">
                        <span className="text-[10px] font-medium text-neutral-500">H</span>
                        <input
                          type="number"
                          min="15"
                          max="1000"
                          value={Math.round(selectedIcon.height)}
                          onChange={(e) => handleUpdateSelectedIcon("height", Number(e.target.value))}
                          className="w-full bg-transparent text-xs tabular-nums text-neutral-200 focus:outline-none"
                        />
                      </label>
                    </div>

                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-neutral-500">Largeur</span>
                        <span className="text-[10px] tabular-nums text-neutral-400">
                          {Math.round(selectedIcon.width)} px
                        </span>
                      </div>
                      <input
                        type="range"
                        min="15"
                        max="1000"
                        value={Math.round(selectedIcon.width)}
                        onChange={(e) => handleUpdateSelectedIcon("width", Number(e.target.value))}
                        className="h-1 w-full cursor-pointer accent-emerald-500"
                      />

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-neutral-500">Hauteur</span>
                        <span className="text-[10px] tabular-nums text-neutral-400">
                          {Math.round(selectedIcon.height)} px
                        </span>
                      </div>
                      <input
                        type="range"
                        min="15"
                        max="1000"
                        value={Math.round(selectedIcon.height)}
                        onChange={(e) => handleUpdateSelectedIcon("height", Number(e.target.value))}
                        className="h-1 w-full cursor-pointer accent-emerald-500"
                      />

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-neutral-500">Rotation</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] tabular-nums text-neutral-400">
                            {Math.round(selectedIcon.rotation)}&deg;
                          </span>
                          {Math.round(selectedIcon.rotation) !== 0 && (
                            <button
                              type="button"
                              onClick={() => handleUpdateSelectedIcon("rotation", 0)}
                              className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-bold text-sky-300 transition-colors hover:bg-sky-500/40"
                              title="Remettre la rotation à 0° (Zéro)"
                            >
                              0° (Remettre à 0)
                            </button>
                          )}
                        </div>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="360"
                        value={Math.round(selectedIcon.rotation)}
                        onChange={(e) => handleUpdateSelectedIcon("rotation", Number(e.target.value))}
                        className="h-1 w-full cursor-pointer accent-emerald-500"
                      />
                      <div className="grid grid-cols-4 gap-1 pt-1">
                        {[0, 90, 180, 270].map((deg) => (
                          <button
                            key={deg}
                            type="button"
                            onClick={() => handleUpdateSelectedIcon("rotation", deg)}
                            className={`rounded py-1 text-[10px] font-medium transition-colors ${
                              Math.round(selectedIcon.rotation) === deg
                                ? "bg-sky-500 font-bold text-white shadow-sm"
                                : "bg-[#1b1b1d] text-neutral-400 hover:bg-white/10 hover:text-white"
                            }`}
                          >
                            {deg}°
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Flip / Mirror controls */}
                  <div className="border-t border-black/40 pt-3">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                      Sens & Miroir (Retourner)
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleUpdateSelectedIcon("flip_x", !selectedIcon.flip_x)}
                        className={`flex items-center justify-center gap-1.5 rounded border px-2 py-1.5 text-xs font-medium transition-colors ${
                          selectedIcon.flip_x
                            ? "border-sky-500 bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/50"
                            : "border-black/50 bg-[#1b1b1d] text-neutral-300 hover:bg-white/10"
                        }`}
                        title="Retourner l'icône de gauche à droite (Miroir horizontal)"
                      >
                        <FlipHorizontal className="h-3.5 w-3.5" />
                        <span>Miroir ↔</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateSelectedIcon("flip_y", !selectedIcon.flip_y)}
                        className={`flex items-center justify-center gap-1.5 rounded border px-2 py-1.5 text-xs font-medium transition-colors ${
                          selectedIcon.flip_y
                            ? "border-sky-500 bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/50"
                            : "border-black/50 bg-[#1b1b1d] text-neutral-300 hover:bg-white/10"
                        }`}
                        title="Retourner l'icône de haut en bas (Miroir vertical)"
                      >
                        <FlipVertical className="h-3.5 w-3.5" />
                        <span>Miroir ↕</span>
                      </button>
                    </div>
                  </div>

                  {/* Pictogram colour */}
                  <div className="border-t border-black/40 pt-3">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                      Couleur du pictogramme
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleUpdateSelectedIcon("color", "")}
                        className={`rounded border px-2 py-1 text-[10px] font-medium transition-colors ${
                          !selectedIcon.color
                            ? "border-sky-500 bg-sky-500/20 text-sky-300"
                            : "border-black/50 bg-[#1b1b1d] text-neutral-300 hover:bg-white/10"
                        }`}
                        title="Rendre au pictogramme sa couleur réglementaire"
                      >
                        D&apos;origine
                      </button>
                      {ICON_COLOR_SWATCHES.map((swatch) => (
                        <button
                          key={swatch.value}
                          type="button"
                          onClick={() => handleUpdateSelectedIcon("color", swatch.value)}
                          className={`h-6 w-6 cursor-pointer rounded border transition-transform hover:scale-110 ${
                            selectedIcon.color?.toLowerCase() === swatch.value
                              ? "border-white ring-2 ring-sky-400"
                              : "border-black/50"
                          }`}
                          style={{ backgroundColor: swatch.value }}
                          title={swatch.label}
                          aria-label={swatch.label}
                        />
                      ))}
                      <input
                        type="color"
                        value={selectedIcon.color || "#ef4444"}
                        onChange={(event) => handleUpdateSelectedIcon("color", event.target.value.toLowerCase())}
                        className="h-6 w-8 cursor-pointer rounded border border-black/50 bg-transparent p-0"
                        title="Choisir une couleur libre"
                      />
                    </div>
                    {selectedIcon.color ? (
                      <p className="mt-1.5 text-[10px] leading-snug text-amber-400/90">
                        Les couleurs des pictogrammes sont normalisées (NF X08-070) : une
                        teinte modifiée peut ne plus être conforme.
                      </p>
                    ) : null}
                  </div>

                  {/* Offset with a leader line */}
                  <div className="border-t border-black/40 pt-3">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                      Déport
                    </span>
                    {selectedIcon.anchor_x == null ? (
                      <button
                        onClick={handleOffsetIcon}
                        title="Laisser un point à l'emplacement réel et déplacer le pictogramme"
                        className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded border border-white/10 bg-white/[0.04] py-1.5 text-[11px] font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        <Anchor className="h-3.5 w-3.5" />
                        Déporter le pictogramme
                      </button>
                    ) : (
                      <>
                        <p className="mb-2 text-[10px] leading-relaxed text-neutral-500">
                          Point à X {Math.round(selectedIcon.anchor_x)} · Y{" "}
                          {Math.round(selectedIcon.anchor_y ?? 0)}. Faites glisser le point sur
                          le plan pour corriger l&apos;emplacement réel.
                        </p>
                        <button
                          onClick={handleClearIconOffset}
                          title="Ramener le pictogramme sur son point"
                          className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded border border-white/10 bg-white/[0.04] py-1.5 text-[11px] font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                          Supprimer le déport
                        </button>
                      </>
                    )}
                  </div>

                  {/* Clipboard */}
                  <div className="border-t border-black/40 pt-3">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                      Presse-papier
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={handleCopyIcon}
                        title="Copier l'icône (⌘C) — position comprise"
                        className="flex cursor-pointer items-center justify-center gap-1.5 rounded border border-white/10 bg-white/[0.04] py-1.5 text-[11px] font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copier
                      </button>
                      <button
                        onClick={handleDuplicateIcon}
                        title="Dupliquer sur place, légèrement décalé (⌘D)"
                        className="flex cursor-pointer items-center justify-center gap-1.5 rounded border border-white/10 bg-white/[0.04] py-1.5 text-[11px] font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        <CopyPlus className="h-3.5 w-3.5" />
                        Dupliquer
                      </button>
                    </div>
                    <button
                      onClick={() => pasteIconFromClipboard(0)}
                      disabled={!clipboardHasIcon}
                      title="Coller à la position d'origine (⌘V)"
                      className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 py-1.5 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-30"
                    >
                      <ClipboardPaste className="h-3.5 w-3.5" />
                      Coller à la même position
                    </button>
                  </div>

                  {/* Destructive action */}
                  <div className="border-t border-black/40 pt-3">
                    <button
                      onClick={handleDeleteSelected}
                      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded border border-red-500/30 bg-red-500/10 py-2 text-[11px] font-semibold text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Supprimer l&apos;élément</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : selectedText ? (
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
                {/* Text identity */}
                <div className="flex items-center gap-3 border-b border-black/40 px-3 py-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-white/10 bg-emerald-500/10 p-1.5 text-emerald-300">
                    <Type className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-neutral-100">Texte</p>
                    <p className="text-[10px] text-neutral-500">Annotation texte</p>
                  </div>
                </div>

                <div className="space-y-4 p-3">
                  {/* Content */}
                  <div>
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                      Contenu
                    </span>
                    <textarea
                      value={selectedText.text}
                      onChange={(e) => handleUpdateSelectedText("text", e.target.value)}
                      rows={3}
                      placeholder="Saisir le texte…"
                      className="w-full resize-y rounded border border-black/50 bg-[#1b1b1d] px-2 py-1.5 text-xs text-neutral-200 placeholder-neutral-600 focus:border-emerald-500/60 focus:outline-none"
                    />
                  </div>

                  {/* Font family */}
                  <div>
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                      Police
                    </span>
                    <select
                      value={selectedText.font_family}
                      onChange={(e) => handleUpdateSelectedText("font_family", e.target.value)}
                      className="w-full cursor-pointer rounded border border-black/50 bg-[#1b1b1d] px-2 py-1.5 text-xs text-neutral-200 focus:border-emerald-500/60 focus:outline-none"
                    >
                      {FONT_OPTIONS.map((font) => (
                        <option key={font} value={font} className="bg-[#252527]">
                          {font}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Font size */}
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                        Taille
                      </span>
                      <input
                        type="number"
                        min={6}
                        max={400}
                        value={Math.round(selectedText.font_size)}
                        onChange={(e) => handleUpdateSelectedText("font_size", Math.max(6, Number(e.target.value)))}
                        className="w-16 rounded border border-black/50 bg-[#1b1b1d] px-1.5 py-0.5 text-right text-[11px] tabular-nums text-neutral-200 focus:border-emerald-500/60 focus:outline-none"
                      />
                    </div>
                    <input
                      type="range"
                      min={6}
                      max={200}
                      value={Math.round(selectedText.font_size)}
                      onChange={(e) => handleUpdateSelectedText("font_size", Number(e.target.value))}
                      className="mt-1.5 h-1 w-full cursor-pointer accent-emerald-500"
                    />
                  </div>

                  {/* Style: bold / italic */}
                  <div>
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                      Style
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleUpdateSelectedText("bold", !selectedText.bold)}
                        className={`flex cursor-pointer items-center justify-center rounded border py-1.5 text-[11px] font-bold transition-colors ${
                          selectedText.bold
                            ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                            : "border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/10"
                        }`}
                      >
                        Gras
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateSelectedText("italic", !selectedText.italic)}
                        className={`flex cursor-pointer items-center justify-center rounded border py-1.5 text-[11px] italic transition-colors ${
                          selectedText.italic
                            ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                            : "border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/10"
                        }`}
                      >
                        Italique
                      </button>
                    </div>
                  </div>

                  {/* Text color */}
                  <div>
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                      Couleur du texte
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={selectedText.color}
                        onChange={(e) => handleUpdateSelectedText("color", e.target.value)}
                        className="h-7 w-9 shrink-0 cursor-pointer rounded border border-black/50 bg-transparent"
                      />
                      <input
                        type="text"
                        value={selectedText.color}
                        onChange={(e) => handleUpdateSelectedText("color", e.target.value)}
                        className="w-full rounded border border-black/50 bg-[#1b1b1d] px-2 py-1 text-[11px] tabular-nums text-neutral-200 focus:border-emerald-500/60 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Background */}
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                        Fond coloré
                      </span>
                      <input
                        type="checkbox"
                        checked={!!selectedText.background_color}
                        onChange={(e) =>
                          handleUpdateSelectedText("background_color", e.target.checked ? "#ffffff" : null)
                        }
                        className="h-3.5 w-3.5 cursor-pointer accent-emerald-500"
                      />
                    </div>
                    {selectedText.background_color && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <input
                          type="color"
                          value={selectedText.background_color}
                          onChange={(e) => handleUpdateSelectedText("background_color", e.target.value)}
                          className="h-7 w-9 shrink-0 cursor-pointer rounded border border-black/50 bg-transparent"
                        />
                        <input
                          type="text"
                          value={selectedText.background_color}
                          onChange={(e) => handleUpdateSelectedText("background_color", e.target.value)}
                          className="w-full rounded border border-black/50 bg-[#1b1b1d] px-2 py-1 text-[11px] tabular-nums text-neutral-200 focus:border-emerald-500/60 focus:outline-none"
                        />
                      </div>
                    )}
                  </div>

                  {/* Rotation */}
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                        Rotation
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] tabular-nums text-neutral-400">
                          {Math.round(selectedText.rotation)}&deg;
                        </span>
                        {Math.round(selectedText.rotation) !== 0 && (
                          <button
                            type="button"
                            onClick={() => handleUpdateSelectedText("rotation", 0)}
                            className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-bold text-sky-300 transition-colors hover:bg-sky-500/40"
                            title="Remettre la rotation à 0° (Zéro)"
                          >
                            0° (Remettre à 0)
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={360}
                      value={Math.round(selectedText.rotation)}
                      onChange={(e) => handleUpdateSelectedText("rotation", Number(e.target.value))}
                      className="mt-1.5 h-1 w-full cursor-pointer accent-emerald-500"
                    />
                    <div className="grid grid-cols-4 gap-1 pt-1.5">
                      {[0, 90, 180, 270].map((deg) => (
                        <button
                          key={deg}
                          type="button"
                          onClick={() => handleUpdateSelectedText("rotation", deg)}
                          className={`rounded py-1 text-[10px] font-medium transition-colors ${
                            Math.round(selectedText.rotation) === deg
                              ? "bg-sky-500 font-bold text-white shadow-sm"
                              : "bg-[#1b1b1d] text-neutral-400 hover:bg-white/10 hover:text-white"
                          }`}
                        >
                          {deg}°
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Destructive action */}
                  <div className="border-t border-black/40 pt-3">
                    <button
                      onClick={handleDeleteSelectedText}
                      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded border border-red-500/30 bg-red-500/10 py-2 text-[11px] font-semibold text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Supprimer le texte</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : selectedShape ? (
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
                {/* Shape identity */}
                <div className="flex items-center gap-3 border-b border-black/40 px-3 py-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-white/10 bg-sky-500/10 p-1.5 text-sky-400">
                    <Waypoints className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-neutral-100">
                      {selectedShape.shape_type === "free_polygon_zone"
                        ? "Zone libre"
                        : selectedShape.shape_type === "curve_polygon_zone"
                        ? "Zone courbe"
                        : selectedShape.shape_type === "polyline"
                        ? "Polyligne ouverte"
                        : selectedShape.shape_type === "polygon_zone"
                        ? "Zone polygone"
                        : selectedShape.shape_type === "zone"
                        ? "Zone"
                        : selectedShape.shape_type === "line"
                        ? "Ligne"
                        : selectedShape.shape_type === "rect"
                        ? "Rectangle"
                        : "Cercle"}
                    </p>
                    <p className="text-[10px] text-neutral-500">Forme & Zone du plan</p>
                  </div>
                </div>

                <div className="space-y-4 p-3">
                  {/* Stroke Color */}
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                        Couleur de contour
                      </span>
                      <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-neutral-400">
                        <input
                          type="checkbox"
                          checked={selectedShape.stroke_width > 0}
                          onChange={(e) =>
                            handleUpdateSelectedShape("stroke_width", e.target.checked ? (shapeStrokeWidth || 3) : 0)
                          }
                          className="h-3.5 w-3.5 cursor-pointer accent-sky-500"
                        />
                        Afficher le contour
                      </label>
                    </div>
                    {selectedShape.stroke_width > 0 && (
                      <>
                        <div className="mt-1.5 flex items-center gap-2">
                          <input
                            type="color"
                            value={selectedShape.color || "#000000"}
                            onChange={(e) => handleUpdateSelectedShape("color", e.target.value)}
                            className="h-7 w-9 shrink-0 cursor-pointer rounded border border-black/50 bg-transparent"
                          />
                          <input
                            type="text"
                            value={selectedShape.color || "#000000"}
                            onChange={(e) => handleUpdateSelectedShape("color", e.target.value)}
                            className="w-full rounded border border-black/50 bg-[#1b1b1d] px-2 py-1 text-[11px] tabular-nums text-neutral-200 focus:border-sky-500/60 focus:outline-none"
                          />
                        </div>
                        <div className="mt-2.5 grid grid-cols-6 gap-1.5">
                          {PRESET_COLORS.map((preset) => (
                            <button
                              key={`stroke-${preset.hex}`}
                              type="button"
                              title={preset.name}
                              onClick={() => handleUpdateSelectedShape("color", preset.hex)}
                              className={`h-6 w-full rounded border transition-transform hover:scale-105 focus:outline-none ${
                                selectedShape.color === preset.hex ? "border-sky-400 ring-2 ring-sky-400/50" : "border-white/20"
                              }`}
                              style={{ backgroundColor: preset.hex }}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Stroke Width */}
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                        Épaisseur du contour
                      </span>
                      <span className="text-[10px] tabular-nums text-neutral-400">
                        {selectedShape.stroke_width} px
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={40}
                      value={selectedShape.stroke_width}
                      onChange={(e) => handleUpdateSelectedShape("stroke_width", Number(e.target.value))}
                      className="mt-1.5 h-1 w-full cursor-pointer accent-sky-500"
                    />
                  </div>

                  {isPolygonShape(selectedShape.shape_type) && selectedShape.points?.length && (
                    <div className="rounded border border-white/10 bg-black/15 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
                          Points du tracé
                        </span>
                        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] tabular-nums text-neutral-500">
                          {selectedShape.points.length} points
                        </span>
                      </div>
                      <p className="mt-1.5 text-[9px] leading-3.5 text-neutral-500">
                        Double-cliquez un point blanc sur le plan ou utilisez sa corbeille ci-dessous.
                      </p>
                      <div className="mt-2 max-h-36 space-y-1 overflow-y-auto pr-0.5">
                        {selectedShape.points.map((point, index) => {
                          const minimumPoints = selectedShape.shape_type === "polyline" ? 2 : 3;
                          const cannotDelete = Boolean(selectedShape.locked) || selectedShape.points!.length <= minimumPoints;
                          return (
                            <div
                              key={`${selectedShape.tempId}-point-row-${index}`}
                              className="flex items-center gap-2 rounded border border-white/5 bg-[#1b1b1d] px-2 py-1.5"
                            >
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-sky-400/60 bg-sky-500/10 text-[9px] font-bold text-sky-300">
                                {pointLabel(index)}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-neutral-500">
                                X {Math.round(point.x)} · Y {Math.round(point.y)}
                              </span>
                              <button
                                type="button"
                                disabled={cannotDelete}
                                onClick={() => handleDeleteSelectedShapePoint(index)}
                                title={cannotDelete
                                  ? `Le tracé doit conserver au moins ${minimumPoints} points`
                                  : `Supprimer le point ${pointLabel(index)}`}
                                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-red-400 transition-colors hover:bg-red-500/15 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-25"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Fill Color (Background) */}
                  {selectedShape.shape_type !== "line" && selectedShape.shape_type !== "polyline" && (
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                          Couleur de fond
                        </span>
                        <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-neutral-400">
                          <input
                            type="checkbox"
                            checked={selectedShape.fill_color !== null && selectedShape.fill_color !== undefined}
                            onChange={(e) =>
                              handleUpdateSelectedShape("fill_color", e.target.checked ? selectedShape.color : null)
                            }
                            className="h-3.5 w-3.5 cursor-pointer accent-sky-500"
                          />
                          Remplir
                        </label>
                      </div>
                      {selectedShape.fill_color !== null && selectedShape.fill_color !== undefined && (
                        <>
                          <div className="mt-1.5 flex items-center gap-2">
                            <input
                              type="color"
                              value={selectedShape.fill_color || selectedShape.color}
                              onChange={(e) => handleUpdateSelectedShape("fill_color", e.target.value)}
                              className="h-7 w-9 shrink-0 cursor-pointer rounded border border-black/50 bg-transparent"
                            />
                            <input
                              type="text"
                              value={selectedShape.fill_color || selectedShape.color}
                              onChange={(e) => handleUpdateSelectedShape("fill_color", e.target.value)}
                              className="w-full rounded border border-black/50 bg-[#1b1b1d] px-2 py-1 text-[11px] tabular-nums text-neutral-200 focus:border-sky-500/60 focus:outline-none"
                            />
                          </div>

                          <div className="mt-2.5 grid grid-cols-6 gap-1.5">
                            {PRESET_COLORS.map((preset) => (
                              <button
                                key={`fill-${preset.hex}`}
                                type="button"
                                title={preset.name}
                                onClick={() => handleUpdateSelectedShape("fill_color", preset.hex)}
                                className={`h-6 w-full rounded border transition-transform hover:scale-105 focus:outline-none ${
                                  selectedShape.fill_color === preset.hex ? "border-sky-400 ring-2 ring-sky-400/50" : "border-white/20"
                                }`}
                                style={{ backgroundColor: preset.hex }}
                              />
                            ))}
                          </div>

                          <div className="mt-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                                Opacité du fond
                              </span>
                              <span className="text-[10px] tabular-nums text-neutral-400">
                                {Math.round((selectedShape.fill_opacity !== undefined ? selectedShape.fill_opacity : 0.35) * 100)}%
                              </span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.05}
                              value={selectedShape.fill_opacity !== undefined ? selectedShape.fill_opacity : 0.35}
                              onChange={(e) => handleUpdateSelectedShape("fill_opacity", Number(e.target.value))}
                              className="mt-1.5 h-1 w-full cursor-pointer accent-sky-500"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Global Curve Tension */}
                  {(selectedShape.shape_type === "polygon_zone" || selectedShape.shape_type === "free_polygon_zone") && (
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                          Courbure globale
                        </span>
                        <span className="text-[10px] tabular-nums text-neutral-400">
                          {Math.round((selectedShape.tension || 0) * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={selectedShape.tension || 0}
                        onChange={(e) => handleUpdateSelectedShape("tension", Number(e.target.value))}
                        className="mt-1.5 h-1 w-full cursor-pointer accent-sky-500"
                      />
                      <p className="mt-1 text-[9px] text-neutral-500">
                        Pour courber un seul côté, faites glisser la poignée bleue située au milieu de ce côté. (Double-cliquez dessus pour rétablir une ligne droite).
                      </p>
                    </div>
                  )}

                  {/* Delete Shape */}
                  <div className="border-t border-black/40 pt-3">
                    <button
                      onClick={handleDeleteSelectedShape}
                      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded border border-red-500/30 bg-red-500/10 py-2 text-[11px] font-semibold text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Supprimer la forme</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : sheetActive ? (
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  Blocs de la feuille
                </p>
                <div className="space-y-1">
                  {sheetBlocks.map((block) => (
                    <div
                      key={block.id}
                      className="flex items-center gap-1.5 rounded border border-white/5 bg-black/20 px-2 py-1.5"
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedBlockId(block.id)}
                        className="min-w-0 flex-1 truncate text-left text-[11px] text-neutral-300 transition-colors hover:text-white"
                      >
                        {block.label}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSheetBlocks((blocks) =>
                            blocks.map((item) =>
                              item.id === block.id ? { ...item, visible: !item.visible } : item
                            )
                          )
                        }
                        title={block.visible ? "Masquer ce bloc" : "Afficher ce bloc"}
                        className={`shrink-0 rounded p-1 transition-colors hover:bg-white/10 ${
                          block.visible ? "text-emerald-400" : "text-neutral-600"
                        }`}
                      >
                        <Eye className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const block = createFreeTextBlock(
                      sheetBlocks.length + 1,
                      activeSheetSize.width,
                      activeSheetSize.height
                    );
                    setSheetBlocks((blocks) => [...blocks, block]);
                    setSelectedBlockId(block.id);
                  }}
                  className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 py-1.5 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20"
                >
                  <Type className="h-3.5 w-3.5" />
                  Ajouter un texte
                </button>
                <p className="mt-3 text-[10px] leading-relaxed text-neutral-500">
                  Cliquez un bloc sur la feuille pour le déplacer, le redimensionner et changer son
                  texte ou ses couleurs.
                </p>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <HelpCircle className="h-8 w-8 text-neutral-700" />
                <p className="text-[11px] leading-relaxed text-neutral-500">
                  Sélectionnez un équipement ou un texte sur le plan pour l&apos;ajuster.
                </p>
                {clipboardHasIcon && (
                  <button
                    onClick={() => pasteIconFromClipboard(0)}
                    title="Coller à la position d'origine (⌘V)"
                    className="mt-2 flex cursor-pointer items-center justify-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20"
                  >
                    <ClipboardPaste className="h-3.5 w-3.5" />
                    Coller l&apos;icône copiée
                  </button>
                )}
              </div>
            )}
          </aside>
        </div>

        {/* ───────────────── Bottom status bar ───────────────── */}
        <footer className="flex h-8 w-full min-w-0 shrink-0 items-center justify-between gap-4 overflow-hidden border-t border-black/50 bg-[#2d2d30] px-2">
          <div className="flex min-w-0 shrink items-center gap-3">
            <ZoomControls
              zoom={zoom}
              onZoomChange={setZoom}
              mode={mode}
              onModeChange={(nextMode) => {
                if (nextMode === "erase") setShapeTool(null);
                setMode(nextMode);
              }}
              onFitToView={() => setFitSignal((signal) => signal + 1)}
            />

            <span className="h-4 w-px bg-white/10" />

            {/* Shape tools */}
            <div className="flex items-center gap-0.5 rounded bg-black/30 p-0.5">
              {([
                { kind: "line" as ShapeKind, Icon: Minus, label: "Ligne" },
                { kind: "rect" as ShapeKind, Icon: Square, label: "Carré" },
                { kind: "circle" as ShapeKind, Icon: Circle, label: "Cercle" },
                { kind: "zone" as ShapeKind, Icon: PaintBucket, label: "Zone" },
                { kind: "polyline" as ShapeKind, Icon: Waypoints, label: "Polyligne" },
                { kind: "free_polygon_zone" as ShapeKind, Icon: Waypoints, label: "Zone libre" },
                { kind: "curve_polygon_zone" as ShapeKind, Icon: Waypoints, label: "Zone courbe" }
              ]).map(({ kind, Icon, label }) => (
                <button
                  key={kind}
                  onClick={() => {
                    setShapeTool((current) => (current === kind ? null : kind));
                    setMode("select");
                    setPlacementIconType(null);
                    setPlacementText(false);
                  }}
                  title={kind === "polyline"
                    ? `${label} — Maj trace à 0°/90°; cliquez le dernier point, Entrée ou double-clic pour terminer; la plume reste active pour la ligne suivante`
                    : isPolygonTool(kind)
                    ? `${label} — cliquez pour ajouter des points, puis Entrée ou double-clic pour terminer`
                    : `${label} — glissez sur le plan ou sur le template pour tracer`}
                  className={`flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                    shapeTool === kind
                      ? "bg-sky-600 text-white"
                      : "text-neutral-400 hover:bg-white/10 hover:text-neutral-200"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden 2xl:inline">{label}</span>
                </button>
              ))}
            </div>

            {shapeTool && (
              <label className="flex items-center gap-1.5 text-[11px] text-neutral-500" title="Épaisseur du trait">
                <input
                  type="range"
                  min="1"
                  max="30"
                  value={shapeStrokeWidth}
                  onChange={(event) => setShapeStrokeWidth(Number(event.target.value))}
                  className="h-1 w-20 cursor-pointer accent-sky-500"
                />
                <span className="w-6 tabular-nums text-neutral-400">{shapeStrokeWidth}</span>
              </label>
            )}

            {/* Color picker for shapes and zones */}
            {shapeTool && (
              <label className="flex items-center gap-1.5 text-[11px] text-neutral-500" title="Couleur de la forme">
                <span className="hidden 2xl:inline">Couleur</span>
                <input
                  type="color"
                  value={shapeColor}
                  onChange={(event) => setShapeColor(event.target.value)}
                  className="h-5 w-7 cursor-pointer rounded border border-black/40 bg-transparent"
                />
              </label>
            )}

            {mode === "erase" && (
              <>
                <span className="h-4 w-px bg-white/10" />
                <div className="flex items-center gap-2">
                  <div className="flex overflow-hidden rounded border border-black/50 bg-[#1b1b1d]">
                    <button
                      type="button"
                      onClick={() => setEraserTarget("lines")}
                      className={`h-6 cursor-pointer px-2 text-[10px] font-semibold transition-colors ${
                        eraserTarget === "lines"
                          ? "bg-amber-500 text-white"
                          : "text-neutral-500 hover:bg-white/10 hover:text-neutral-200"
                      }`}
                      title="Découper les lignes dessinées pour créer des ouvertures"
                    >
                      Ouvertures
                    </button>
                    <button
                      type="button"
                      onClick={() => setEraserTarget("background")}
                      className={`h-6 cursor-pointer border-l border-black/50 px-2 text-[10px] font-semibold transition-colors ${
                        eraserTarget === "background"
                          ? "bg-amber-500 text-white"
                          : "text-neutral-500 hover:bg-white/10 hover:text-neutral-200"
                      }`}
                      title="Effacer directement une partie de l’image du plan"
                    >
                      Fond du plan
                    </button>
                  </div>

                  <label className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                    <Eraser className="h-3.5 w-3.5 text-amber-400" />
                    <input
                      type="range"
                      min="4"
                      max="120"
                      value={eraserSize}
                      onChange={(event) => setEraserSize(Number(event.target.value))}
                      className="h-1 w-24 cursor-pointer accent-amber-500"
                      title="Taille de la gomme"
                    />
                    <span className="w-8 tabular-nums text-neutral-400">{eraserSize}</span>
                  </label>

                  {eraserTarget === "background" ? (
                    <>
                      <div className="flex overflow-hidden rounded border border-black/50 bg-[#1b1b1d]">
                        <button
                          type="button"
                          onClick={() => setEraserShape("square")}
                          className={`flex h-6 w-8 cursor-pointer items-center justify-center transition-colors ${
                            eraserShape === "square"
                              ? "bg-amber-500 text-white"
                              : "text-neutral-500 hover:bg-white/10 hover:text-neutral-200"
                          }`}
                          title="Gomme carrée"
                          aria-label="Gomme carrée"
                        >
                          <Square className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEraserShape("circle")}
                          className={`flex h-6 w-8 cursor-pointer items-center justify-center border-l border-black/50 transition-colors ${
                            eraserShape === "circle"
                              ? "bg-amber-500 text-white"
                              : "text-neutral-500 hover:bg-white/10 hover:text-neutral-200"
                          }`}
                          title="Gomme ronde"
                          aria-label="Gomme ronde"
                        >
                          <Circle className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => setUndoEraseSignal((signal) => signal + 1)}
                        disabled={!eraseStrokeCount}
                        className="cursor-pointer rounded px-2 py-1 text-[11px] font-medium text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100 disabled:opacity-30"
                        title="Annuler le dernier trait"
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={() => setResetEraseSignal((signal) => signal + 1)}
                        disabled={!eraseStrokeCount}
                        className="cursor-pointer rounded px-2 py-1 text-[11px] font-medium text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100 disabled:opacity-30"
                        title="Effacer tous les traits de gomme"
                      >
                        Tout rétablir
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveErasedPlan}
                        disabled={!eraseStrokeCount || savingErase}
                        className="flex cursor-pointer items-center gap-1.5 rounded bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-amber-500 disabled:opacity-30"
                      >
                        {savingErase ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        Appliquer{eraseStrokeCount ? ` (${eraseStrokeCount})` : ""}
                      </button>
                    </>
                  ) : (
                    <>
                    <button
                      type="button"
                      onClick={handleUndo}
                      disabled={historyIndex <= 0}
                      className="cursor-pointer rounded px-2 py-1 text-[11px] font-medium text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100 disabled:opacity-30"
                      title="Annuler la dernière ouverture"
                    >
                      Annuler l&apos;ouverture
                    </button>
                    <span className="text-[9px] text-neutral-500">Puis utilisez Sauvegarder</span>
                    </>
                  )}
                </div>
              </>
            )}

            <span className="h-4 w-px bg-white/10" />

            <label className="flex items-center gap-1.5 text-[11px] text-neutral-500" title="Largeur de la zone de travail">
              <span className="hidden sm:inline">Largeur</span>
              <select
                value={canvasWidthPercent}
                onChange={(event) => {
                  setCanvasWidthPercent(Number(event.target.value));
                  setFitSignal((signal) => signal + 1);
                }}
                className="cursor-pointer rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] font-medium tabular-nums text-neutral-200 hover:border-white/15 focus:border-emerald-500/60 focus:outline-none"
              >
                {[100, 90, 80, 70, 60, 50].map((value) => (
                  <option key={value} value={value} className="bg-[#252527]">
                    {value}%
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex shrink-0 items-center gap-3 text-[11px] text-neutral-500">
            <span className="tabular-nums">
              {icons.length} équipement{icons.length > 1 ? "s" : ""}
            </span>
            {selectedIcon && (
              <>
                <span className="h-3 w-px bg-white/10" />
                <span className="tabular-nums text-neutral-400">
                  X {Math.round(selectedIcon.x)} &middot; Y {Math.round(selectedIcon.y)}
                </span>
              </>
            )}
            <span className="h-3 w-px bg-white/10" />
            <span className="hidden xl:inline">
              2 doigts : déplacer &middot; &#8984;/pincer : zoom &middot; V/H : outil
            </span>
            <span className="h-3 w-px bg-white/10" />
            {planReadingAngle === null ? (
              <span
                className="text-neutral-500"
                title="Placez le pictogramme « vous etes ici » sur le plan : sa rotation orientera le plan exporté et redressera les pictogrammes."
              >
                Orientation : non définie
              </span>
            ) : (
              <button
                type="button"
                onClick={() => youAreHereIcon && setSelectedIconId(youAreHereIcon.tempId)}
                title="Sélectionner le repère « Vous êtes ici » pour régler l'orientation"
                className="cursor-pointer rounded px-1.5 py-0.5 text-emerald-400 transition-colors hover:bg-white/10"
              >
                Orientation : {Math.round(planReadingAngle)}° (Vous êtes ici)
              </button>
            )}
            <span className="h-3 w-px bg-white/10" />
            <span className={plan?.use_cleaned_background ? "text-emerald-400" : ""}>
              {plan?.use_cleaned_background ? "Fond nettoyé" : "Fond original"}
            </span>
          </div>
        </footer>

        {cleanModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 px-4 py-4 backdrop-blur-sm">
            <div className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ${cleanMethod !== "local_plan" && cleanMethod !== "local_walls" ? "max-w-5xl" : "max-w-3xl"}`}>
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">Nettoyer le plan</h2>
                  <p className="text-xs text-slate-500">Choisissez une méthode de nettoyage pour préparer le fond du plan.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCleanModalOpen(false)}
                  disabled={cleaning || grokCleaning}
                  className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-green-50 hover:text-safety-green disabled:opacity-50"
                  title="Fermer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
                {planOverlays.length > 0 && (
                  <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-sky-950">Plan concerné par le nettoyage</h3>
                    <p className="mt-0.5 text-xs text-sky-700">Sélectionnez le plan spécifique sur lequel appliquer le nettoyage :</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedCleanTargetId(MAIN_PLAN_ID)}
                        className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                          selectedCleanTargetId === MAIN_PLAN_ID
                            ? "bg-sky-600 text-white shadow-sm"
                            : "bg-white text-slate-700 border border-slate-200 hover:bg-sky-100/50"
                        }`}
                      >
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        Plan principal ({plan?.building_name || "Arrière-plan"})
                      </button>

                      {planOverlays.map((overlay, index) => (
                        <button
                          key={overlay.tempId}
                          type="button"
                          onClick={() => setSelectedCleanTargetId(overlay.tempId)}
                          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                            selectedCleanTargetId === overlay.tempId
                              ? "bg-sky-600 text-white shadow-sm"
                              : "bg-white text-slate-700 border border-slate-200 hover:bg-sky-100/50"
                          }`}
                        >
                          <span className="h-2 w-2 rounded-full bg-sky-400" />
                          Plan secondaire {index + 1} ({overlay.label || `Plan #${index + 1}`})
                        </button>
                      ))}
                    </div>
                    {cleanTargetOverlay?.canRevertOriginal && !cleanTargetOverlay.isOriginal && (
                      <button
                        type="button"
                        onClick={() => setRevertConfirmOpen(true)}
                        disabled={cleaning || grokCleaning}
                        className="mt-3 inline-flex items-center gap-2 rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-50"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Rétablir l&apos;original de ce plan secondaire
                      </button>
                    )}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-3">
                  {/* ── Option 1 : nettoyage local du plan ── */}
                  <button
                    type="button"
                    onClick={() => setCleanMethod("local_plan")}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      cleanMethod === "local_plan"
                        ? "border-safety-green bg-green-50 text-slate-950 shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-green-200 hover:bg-green-50/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                        cleanMethod === "local_plan" ? "border-safety-green" : "border-slate-300"
                      }`}>
                        {cleanMethod === "local_plan" ? <span className="h-2.5 w-2.5 rounded-full bg-safety-green" /> : null}
                      </span>
                      <span className="text-sm font-bold">Nettoyer le plan</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">Nettoyage OpenCV complet du plan. Aucune donnée envoyée à un service externe.</p>
                  </button>

                  {/* ── Option 2 : nettoyage local des murs ── */}
                  <button
                    type="button"
                    onClick={() => setCleanMethod("local_walls")}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      cleanMethod === "local_walls"
                        ? "border-safety-green bg-green-50 text-slate-950 shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-green-200 hover:bg-green-50/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                        cleanMethod === "local_walls" ? "border-safety-green" : "border-slate-300"
                      }`}>
                        {cleanMethod === "local_walls" ? <span className="h-2.5 w-2.5 rounded-full bg-safety-green" /> : null}
                      </span>
                      <span className="text-sm font-bold">Nettoyer les murs</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">Extraction locale des murs uniquement (OpenCV). Aucune donnée envoyée à un service externe.</p>
                  </button>

                  {/* ── Option 3 : vider ou convertir avec l'IA (Grok) ── */}
                  <button
                    type="button"
                    onClick={() => setCleanMethod("grok")}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      cleanMethod === "grok"
                        ? "border-safety-green bg-green-50 text-slate-950 shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-green-200 hover:bg-green-50/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                        cleanMethod === "grok" ? "border-safety-green" : "border-slate-300"
                      }`}>
                        {cleanMethod === "grok" ? <span className="h-2.5 w-2.5 rounded-full bg-safety-green" /> : null}
                      </span>
                      <span className="text-sm font-bold">Traitement avec l&apos;IA (Grok)</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      Vide ou transforme le plan principal comme chaque plan secondaire présent dans le canvas.
                    </p>
                  </button>
                </div>

                {costEstimatePanel}

                {/* ── Bloc local (plan ou murs) ── */}
                {(cleanMethod === "local_plan" || cleanMethod === "local_walls") && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <h3 className="text-sm font-bold text-slate-950">Options locales</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">Traitement OpenCV effectué sur le serveur, sans appel à une API externe.</p>
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => {
                          setCleanModalOpen(false);
                          void handleCleanPlan();
                        }}
                        disabled={cleaning}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-safety-green px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-safety-green/20 transition-colors hover:bg-green-600 disabled:opacity-50"
                      >
                        {cleaning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        Nettoyer le plan
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCleanModalOpen(false);
                          void handleCleanWalls();
                        }}
                        disabled={cleaning}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-xs font-semibold text-safety-green transition-colors hover:bg-green-100 disabled:opacity-50"
                      >
                        {cleaning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        Nettoyer murs uniquement
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Bloc Grok : clé API xAI + lancement ── */}
                {cleanMethod === "grok" && (
                  <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Clé API xAI</div>
                          <div className="mt-1 text-sm font-bold text-slate-950">
                            {xaiSettingsLoading ? "Vérification..." : xaiHasSavedKey ? "Configurée" : "Non configurée"}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {xaiHasSavedKey
                              ? `Dernière modification : ${formatXaiSettingsDate() || "date non disponible"}.`
                              : "Configurez une clé API xAI avant de lancer le nettoyage."}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setXaiKeyConfigOpen((current) => !current)}
                          disabled={grokCleaning}
                          className="inline-flex items-center justify-center rounded-xl border border-green-200 bg-green-50 px-4 py-2 text-xs font-semibold text-safety-green transition-colors hover:bg-green-100 disabled:opacity-50"
                        >
                          Configurer la clé API
                        </button>
                      </div>
                    </div>

                    {xaiKeyConfigOpen && (
                      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Clé API xAI</span>
                          <input
                            type="password"
                            value={xaiApiKey}
                            onChange={(event) => setXaiApiKey(event.target.value)}
                            placeholder="xai-..."
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            autoComplete="off"
                          />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleTestXaiKey()}
                            disabled={xaiKeyTesting || xaiKeySaving}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
                          >
                            {xaiKeyTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                            Tester
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSaveXaiKey()}
                            disabled={xaiKeySaving || !xaiApiKey.trim()}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-safety-green px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-green-600 disabled:opacity-50"
                          >
                            {xaiKeySaving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                            Enregistrer
                          </button>
                          {xaiHasSavedKey && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteXaiKey()}
                              disabled={xaiKeyDeleting}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50"
                            >
                              {xaiKeyDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                              Supprimer
                            </button>
                          )}
                        </div>
                        {xaiKeyStatus && (
                          <p className="text-[11px] font-semibold text-slate-600">{xaiKeyStatus}</p>
                        )}
                      </div>
                    )}

                    {grokError && (
                      <div className="whitespace-pre-line rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                        {grokError}
                      </div>
                    )}

                    {grokCleaning && (
                      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                        {grokStepOrder.map((step) => {
                          const stepState = getGrokStepState(step);
                          return (
                            <div key={step} className="flex items-center gap-3 text-sm">
                              <span
                                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                                  stepState === "done"
                                    ? "border-safety-green bg-safety-green text-white"
                                    : stepState === "current"
                                      ? "border-safety-green text-safety-green"
                                      : "border-slate-300 text-slate-400"
                                }`}
                              >
                                {stepState === "current" ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : stepState === "done" ? (
                                  <Check className="h-3.5 w-3.5" />
                                ) : null}
                              </span>
                              <span className={stepState === "current" ? "font-semibold text-slate-900" : "text-slate-500"}>
                                {grokStepLabels[step]}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* ── Type de plan source (Preset Grok) ── */}
                    <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
                        Type de plan source
                      </label>
                      <p className="text-xs leading-4 text-slate-500">
                        Choisissez le profil d&apos;analyse selon le document à vider ou à transformer.
                      </p>
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                        <button
                          type="button"
                          disabled={grokCleaning}
                          onClick={() => setGrokPreset("evacuation")}
                          className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all ${
                            grokPreset === "evacuation"
                              ? "border-safety-green bg-white shadow-sm ring-2 ring-safety-green/30 text-slate-950"
                              : "border-slate-200 bg-white/70 text-slate-600 hover:border-slate-300 hover:bg-white"
                          }`}
                        >
                          <div className="flex items-center gap-2 font-bold text-xs text-slate-900">
                            <Sparkles className="h-4 w-4 text-safety-green" />
                            <span>Plan d&apos;Évacuation</span>
                          </div>
                          <span className="text-[11px] leading-4 text-slate-500">
                            Supprime les flèches, pictogrammes, &apos;Vous êtes ici&apos; et légendes d&apos;un plan d&apos;évacuation.
                          </span>
                        </button>

                        <button
                          type="button"
                          disabled={grokCleaning}
                          onClick={() => setGrokPreset("autocad")}
                          className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all ${
                            grokPreset === "autocad"
                              ? "border-sky-500 bg-white shadow-sm ring-2 ring-sky-500/30 text-slate-950"
                              : "border-slate-200 bg-white/70 text-slate-600 hover:border-slate-300 hover:bg-white"
                          }`}
                        >
                          <div className="flex items-center gap-2 font-bold text-xs text-slate-900">
                            <Waypoints className="h-4 w-4 text-sky-500" />
                            <span>Plan d&apos;Architecte AutoCAD</span>
                          </div>
                          <span className="text-[11px] leading-4 text-slate-500">
                            Analyse 2-Step AutoCAD : supprime cotations, axes, cartouches, hachures, calques &amp; meubles.
                          </span>
                        </button>

                        <button
                          type="button"
                          disabled={grokCleaning}
                          onClick={() => setGrokPreset("sketch")}
                          className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all ${
                            grokPreset === "sketch"
                              ? "border-amber-500 bg-white text-slate-950 shadow-sm ring-2 ring-amber-500/30"
                              : "border-slate-200 bg-white/70 text-slate-600 hover:border-slate-300 hover:bg-white"
                          }`}
                        >
                          <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                            <Pencil className="h-4 w-4 text-amber-600" />
                            <span>Croquis au stylo</span>
                          </div>
                          <span className="text-[11px] leading-4 text-slate-500">
                            Transforme un dessin manuscrit ou une photo de croquis en plan architectural propre, prêt pour l&apos;évacuation.
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* ── Couleur des parois du croquis ── */}
                    {grokPreset === "sketch" && (
                      <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
                            Couleur des parois
                          </label>
                          <span className="font-mono text-xs font-bold uppercase text-slate-600">
                            {grokWallColor}
                          </span>
                        </div>
                        <p className="text-xs leading-4 text-slate-500">
                          Choisissez la couleur des murs du plan reconstruit. Le noir sec pur{" "}
                          <code className="font-mono text-[11px] font-bold text-slate-800">#000000</code>{" "}
                          est utilisé par défaut.
                        </p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {[
                            { label: "Noir sec", value: "#000000" },
                            { label: "Anthracite", value: "#262626" },
                            { label: "Gris foncé", value: "#4B5563" },
                            { label: "Gris moyen", value: "#6B7280" },
                          ].map((preset) => {
                            const isSelected = grokWallColor.toUpperCase() === preset.value;
                            return (
                              <button
                                key={preset.value}
                                type="button"
                                disabled={grokCleaning}
                                onClick={() => setGrokWallColor(preset.value)}
                                className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-2.5 text-center text-xs font-semibold transition-all ${
                                  isSelected
                                    ? "border-safety-green bg-white text-slate-950 shadow-sm ring-2 ring-safety-green/30"
                                    : "border-slate-200 bg-white/70 text-slate-600 hover:border-slate-300 hover:bg-white"
                                }`}
                              >
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="h-4 w-4 shrink-0 rounded-full border border-slate-300 shadow-inner"
                                    style={{ backgroundColor: preset.value }}
                                  />
                                  <span>{preset.label}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        <div className="mt-2 flex items-center gap-2 border-t border-slate-200/60 pt-3">
                          <span className="text-xs font-medium text-slate-600">Sur mesure :</span>
                          <input
                            type="color"
                            value={grokWallColor}
                            disabled={grokCleaning}
                            onChange={(e) => setGrokWallColor(e.target.value.toUpperCase())}
                            className="h-7 w-9 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
                            aria-label="Choisir la couleur des parois"
                          />
                          <input
                            type="text"
                            value={grokWallColor}
                            disabled={grokCleaning}
                            onChange={(e) => setGrokWallColor(e.target.value.toUpperCase())}
                            placeholder="#000000"
                            maxLength={7}
                            className="w-24 rounded-md border border-slate-300 bg-white px-2.5 py-1 font-mono text-xs uppercase text-slate-800 focus:border-safety-green focus:outline-none"
                            aria-label="Code HEX de la couleur des parois"
                          />
                        </div>
                        {grokColorsConflict && (
                          <p className="text-xs font-semibold text-red-600">
                            La couleur des parois doit être différente de la couleur du fond.
                          </p>
                        )}
                      </div>
                    )}

                    {/* ── Couleur de fond du plan ── */}
                    <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
                          Couleur de fond du plan
                        </label>
                        <span className="font-mono text-xs font-bold text-slate-600 uppercase">
                          {grokBackgroundColor}
                        </span>
                      </div>
                      <p className="text-xs leading-4 text-slate-500">
                        Déterminez la couleur du fond du plan nettoyé (Blanc sec pur <code className="font-mono text-[11px] font-bold text-slate-800">#FFFFFF</code> par défaut).
                      </p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {[
                          { label: "Blanc sec", value: "#FFFFFF" },
                          { label: "Blanc cassé", value: "#FAF9F6" },
                          { label: "Gris clair", value: "#F3F4F6" },
                          { label: "Sombre", value: "#121212" },
                        ].map((preset) => {
                          const isSelected = grokBackgroundColor.toUpperCase() === preset.value.toUpperCase();
                          return (
                            <button
                              key={preset.value}
                              type="button"
                              disabled={grokCleaning}
                              onClick={() => setGrokBackgroundColor(preset.value)}
                              className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-2.5 text-center text-xs font-semibold transition-all ${
                                isSelected
                                  ? "border-safety-green bg-white shadow-sm ring-2 ring-safety-green/30 text-slate-950"
                                  : "border-slate-200 bg-white/70 text-slate-600 hover:border-slate-300 hover:bg-white"
                              }`}
                            >
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="h-4 w-4 rounded-full border border-slate-300 shadow-inner shrink-0"
                                  style={{ backgroundColor: preset.value }}
                                />
                                <span>{preset.label}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-2 flex items-center gap-2 pt-1 border-t border-slate-200/60">
                        <span className="text-xs font-medium text-slate-600">Sur mesure :</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={grokBackgroundColor}
                            disabled={grokCleaning}
                            onChange={(e) => setGrokBackgroundColor(e.target.value)}
                            className="h-7 w-9 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
                          />
                          <input
                            type="text"
                            value={grokBackgroundColor}
                            disabled={grokCleaning}
                            onChange={(e) => setGrokBackgroundColor(e.target.value)}
                            placeholder="#FFFFFF"
                            maxLength={7}
                            className="w-24 rounded-md border border-slate-300 bg-white px-2.5 py-1 font-mono text-xs text-slate-800 uppercase focus:border-safety-green focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void launchGrokCleaning()}
                      disabled={grokCleaning || !xaiHasSavedKey || grokColorsConflict}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-safety-green px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-safety-green/20 transition-colors hover:bg-green-600 disabled:opacity-50"
                    >
                      {grokCleaning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      {grokPreset === "sketch" ? "Transformer le croquis en plan" : "Vider le plan avec l’IA"}
                    </button>
                    {!xaiHasSavedKey && !xaiKeyConfigOpen && (
                      <p className="text-[11px] text-slate-500">
                        Configurez d&apos;abord votre clé API xAI pour activer cette option.
                      </p>
                    )}
                  </div>
                )}
                {cleaningHistoryPanel}
              </div>
            </div>
          </div>
        )}

        {revertConfirmOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-white/80 px-4 py-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">
                    {cleanTargetOverlay ? "Rétablir le plan secondaire original ?" : "Rétablir le plan original ?"}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {cleanTargetOverlay
                      ? "L’image importée avant le premier nettoyage sera restaurée. Les versions nettoyées restent disponibles dans l’historique de ce plan secondaire."
                      : "Le fond nettoyé sera désactivé et le plan original sera affiché. Les versions nettoyées restent disponibles dans l’historique."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRevertConfirmOpen(false)}
                  disabled={cleaning}
                  className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-green-50 hover:text-safety-green disabled:opacity-50"
                  title="Fermer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setRevertConfirmOpen(false)}
                  disabled={cleaning}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Non
                </button>
                <button
                  type="button"
                  onClick={handleRevertPlan}
                  disabled={cleaning}
                  className="inline-flex items-center gap-2 rounded-xl bg-safety-green px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-green-600 disabled:opacity-50"
                >
                  {cleaning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Oui, rétablir
                </button>
              </div>
            </div>
          </div>
        )}

        {exportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 px-4 py-4 backdrop-blur-sm">
            <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="shrink-0 flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">Réglages de la feuille</h2>
                  <p className="text-xs text-slate-500">Nom du site, titre et logos utilisés par la feuille du studio. L&apos;export, lui, reprend exactement ce qu&apos;affiche le studio.</p>
                </div>
                <button
                  onClick={() => setExportModalOpen(false)}
                  disabled={exporting}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-slate-950 disabled:opacity-50"
                  title="Fermer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid flex-1 min-h-0 gap-5 p-5 lg:grid-cols-[1fr_340px]">
                {/* The preview stays pinned: only the options column scrolls.
                    Putting overflow-y-auto on the grid itself made the plan
                    scroll away with the controls. */}
                <div className="lg:sticky lg:top-0 self-start rounded-xl border border-emerald-900/30 bg-emerald-50 p-3">
                  <div className="relative flex min-h-[380px] items-center justify-center overflow-hidden border border-emerald-800/20 bg-[#f3f8f5] shadow-sm">
                    {exportAdjustmentPreviewLoading && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/65">
                        <Loader2 className="h-8 w-8 animate-spin text-safety-green" />
                      </div>
                    )}
                    {exportAdjustmentPreviewUrl ? (
                      <img
                        src={exportAdjustmentPreviewUrl}
                        alt="Aperçu exact du template d'export"
                        className="h-auto max-h-[70vh] w-full object-contain"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-3 text-sm text-slate-500">
                        <Loader2 className="h-8 w-8 animate-spin text-safety-green" />
                        <span>Génération de l'aperçu exact...</span>
                      </div>
                    )}
                  </div>
	                </div>

	                <div className="space-y-3 lg:max-h-[calc(92vh-7rem)] lg:overflow-y-auto lg:pr-1">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <h3 className="mb-3 text-sm font-bold text-slate-950">Thème d'export</h3>
	                    <div className="grid grid-cols-2 gap-2">
	                      {(Object.keys(EXPORT_THEMES) as ExportTheme[]).map((theme) => (
	                        <button
	                          key={theme}
	                          type="button"
	                          onClick={() => {
	                            setExportTheme(theme);
	                            if (!exportUseCustomColors) {
	                              setExportCustomColors(getThemeCustomColors(theme));
	                            }
	                            // A title you typed yourself survives the switch.
	                            setExportPlanTitle((current) =>
	                              isUntouchedExportTitle(current) ? EXPORT_THEME_DEFAULT_TITLES[theme] : current
	                            );
	                          }}
	                          className={`rounded-lg border px-3 py-2 text-left transition-colors ${
	                            exportTheme === theme
	                              ? "border-safety-green bg-green-50 text-slate-950"
	                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
	                          }`}
	                        >
	                          <span className="block text-xs font-bold">{EXPORT_THEMES[theme].label}</span>
	                          <span className="mt-1 block text-[11px] leading-4 text-slate-500">
	                            {EXPORT_THEMES[theme].description}
	                          </span>
	                        </button>
	                      ))}
	                    </div>
	                  </div>

	                  <div className="rounded-xl border border-slate-200 bg-white p-3">
	                    <div className="mb-3 flex items-center justify-between gap-3">
	                      <div>
	                        <h3 className="text-sm font-bold text-slate-950">Couleurs personnalisées</h3>
	                        <p className="text-[11px] leading-4 text-slate-500">Sélecteur direct ou code hexadécimal.</p>
	                      </div>
	                      <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
	                        <input
	                          type="checkbox"
	                          checked={exportUseCustomColors}
	                          onChange={(event) => {
	                            setExportUseCustomColors(event.target.checked);
	                            if (event.target.checked) {
	                              setExportCustomColors(getThemeCustomColors());
	                            }
	                          }}
	                          className="h-4 w-4 rounded border-slate-300 accent-safety-green"
	                        />
	                        Activer
	                      </label>
	                    </div>
	                    <div className="grid grid-cols-2 gap-2">
	                      {exportColorFields.map((field) => {
	                        const normalized = normalizeHexColor(
	                          exportCustomColors[field.key],
	                          DEFAULT_EXPORT_CUSTOM_COLORS[field.key]
	                        );
	                        const invalid = exportCustomColors[field.key].trim() !== "" && !isValidHexColor(exportCustomColors[field.key]);
	                        return (
	                          <label key={field.key} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
	                            <span className="mb-1 block text-[11px] font-bold text-slate-600">{field.label}</span>
	                            <div className="flex items-center gap-2">
	                              <input
	                                type="color"
	                                value={normalized}
	                                disabled={!exportUseCustomColors}
	                                onChange={(event) => updateExportCustomColor(field.key, event.target.value)}
	                                className="h-8 w-9 shrink-0 cursor-pointer rounded border border-slate-200 bg-white disabled:opacity-50"
	                              />
	                              <input
	                                value={exportCustomColors[field.key]}
	                                disabled={!exportUseCustomColors}
	                                onChange={(event) => updateExportCustomColor(field.key, event.target.value)}
	                                placeholder="#168f5a"
	                                className={`min-w-0 flex-1 rounded-md border bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 outline-none disabled:opacity-50 ${
	                                  invalid ? "border-red-300 text-red-700" : "border-slate-200 focus:border-safety-green"
	                                }`}
	                              />
	                            </div>
	                          </label>
	                        );
	                      })}
	                    </div>
	                    <button
	                      type="button"
	                      onClick={() => setExportCustomColors(getThemeCustomColors())}
	                      className="mt-2 text-xs font-semibold text-safety-green hover:text-green-700"
	                    >
	                      Réinitialiser sur le thème
	                    </button>
	                  </div>

	                  <div className="rounded-xl border border-slate-200 bg-white p-3">
	                    <div className="mb-3 flex items-center justify-between">
	                      <h3 className="text-sm font-bold text-slate-950">Ajuster le plan central</h3>
                      <button
                        type="button"
                        onClick={() => {
                          setExportPlanScale(100);
                          setExportPlanAreaScale(100);
                          setExportPlanRotation(0);
                          setExportPlanOffsetX(0);
                          setExportPlanOffsetY(0);
                        }}
                        className="text-xs font-semibold text-safety-green hover:text-blue-300"
                      >
                        Réinitialiser
                      </button>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <div className="mb-1 flex justify-between text-xs text-slate-500">
                          <span>Taille du plan (Zoom)</span>
                          <span>{exportPlanScale}%</span>
                        </div>
                        <input
                          type="range"
                          min="40"
                          max="300"
                          value={exportPlanScale}
                          onChange={(e) => setExportPlanScale(Number(e.target.value))}
                          className="w-full accent-safety-green"
                        />
                      </div>

                      <div>
                        <div className="mb-1 flex justify-between text-xs text-slate-500">
                          <span>Grandeur du cadre / Fenêtre de zone</span>
                          <span>{exportPlanAreaScale}%</span>
                        </div>
                        <input
                          type="range"
                          min="50"
                          max="200"
                          value={exportPlanAreaScale}
                          onChange={(e) => setExportPlanAreaScale(Number(e.target.value))}
                          className="w-full accent-safety-green"
                        />
                      </div>

                      <div className="pt-1">
                        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            checked={exportDisablePlanClipping}
                            onChange={(e) => setExportDisablePlanClipping(e.target.checked)}
                            className="h-4 w-4 cursor-pointer accent-safety-green"
                          />
                          <span>Plan complet sans découpage (Plein cadre)</span>
                        </label>
                        <p className="mt-0.5 pl-6 text-[11px] leading-4 text-slate-500">
                          Affiche l&apos;intégralité du plan sans le couper sur les bords lorsqu&apos;il est zoomé.
                        </p>
                      </div>

                      <div>
                        <div className="mb-1 flex justify-between text-xs text-slate-500">
                          <span>Rotation</span>
                          <span>{exportPlanRotation}°</span>
                        </div>
                        <input
                          type="range"
                          min="-180"
                          max="180"
                          value={exportPlanRotation}
                          onChange={(e) => setExportPlanRotation(Number(e.target.value))}
                          className="w-full accent-safety-green"
                        />
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                          {planReadingAngle === null ? (
                            <>
                              Placez le pictogramme <strong>« vous etes ici »</strong> sur le plan
                              et tournez-le : la rotation suivra automatiquement la direction du
                              regard, et les pictogrammes d&apos;équipement resteront droits.
                            </>
                          ) : (
                            <>
                              Repris du repère <strong>« Vous êtes ici »</strong> (
                              {Math.round(planReadingAngle)}°). Les pictogrammes d&apos;équipement
                              sont redressés automatiquement ; les flèches directionnelles suivent
                              le plan.
                            </>
                          )}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="mb-1 flex justify-between text-xs text-slate-500">
                            <span>Horizontal</span>
                            <span>{exportPlanOffsetX}px</span>
                          </div>
                          <input
                            type="range"
                            min="-300"
                            max="300"
                            value={exportPlanOffsetX}
                            onChange={(e) => setExportPlanOffsetX(Number(e.target.value))}
                            className="w-full accent-safety-green"
                          />
                        </div>

                        <div>
                          <div className="mb-1 flex justify-between text-xs text-slate-500">
                            <span>Vertical</span>
                            <span>{exportPlanOffsetY}px</span>
                          </div>
                          <input
                            type="range"
                            min="-300"
                            max="300"
                            value={exportPlanOffsetY}
                            onChange={(e) => setExportPlanOffsetY(Number(e.target.value))}
                            className="w-full accent-safety-green"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Titre du plan
                    </label>
                    <input
                      value={exportPlanTitle}
                      onChange={(e) => setExportPlanTitle(e.target.value)}
                      className="block w-full rounded-xl border border-slate-300 bg-white py-2.5 px-4 text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none"
                      placeholder={EXPORT_THEME_DEFAULT_TITLES[exportTheme]}
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Titre affiché dans le bandeau. Vide, il reprend «&nbsp;{EXPORT_THEME_DEFAULT_TITLES[exportTheme]}&nbsp;».
                    </p>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {usesAddressBlock ? "Adresse du site" : "Nom du site"}
                    </label>
                    {usesAddressBlock ? (
                      <>
                        <textarea
                          value={exportSiteName}
                          onChange={(e) => setExportSiteName(e.target.value)}
                          rows={2}
                          className="block w-full resize-none rounded-xl border border-slate-300 bg-white py-2.5 px-4 text-sm text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none"
                          placeholder={"13 RUE HENRI TUROT\n75019 PARIS"}
                        />
                        <p className="mt-1 text-[11px] text-slate-500">
                          Affichée sous le logo client, en haut à droite. Un retour à la ligne
                          = une ligne imprimée.
                        </p>
                        {usesLevelTag && (
                          <div className="mt-2">
                            <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                              Étiquette de niveau
                            </span>
                            <input
                              value={exportLevelLabel}
                              onChange={(e) => setExportLevelLabel(e.target.value)}
                              placeholder={plan?.floor_name || "REZ-DE-CHAUSSEE"}
                              className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs font-semibold text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none"
                            />
                            <p className="mt-1 text-[11px] leading-4 text-slate-500">
                              {isEvacuationTheme
                                ? "Pastille grise sous le plan. Vide, elle reprend l'étage du plan."
                                : "Pastille grise sous l'adresse. Vide, elle reprend l'étage du plan."}
                            </p>
                          </div>
                        )}
                      </>
                    ) : (
                      <input
                        value={exportSiteName}
                        onChange={(e) => setExportSiteName(e.target.value)}
                        className="block w-full rounded-xl border border-slate-300 bg-white py-2.5 px-4 text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none"
                        placeholder="Ex: Rez-de-chaussée"
                      />
                    )}
                  </div>

                  {/* ── Copy blocks. The normative sheet has its own set of
                      blocks, so the fields on offer follow the active theme
                      instead of showing controls that would do nothing. ── */}
                  {isEvacuationTheme ? (
                    <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-bold text-slate-950">Textes plan d&apos;évacuation</h3>
                          <p className="text-[11px] leading-4 text-slate-500">
                            Colonne de consignes à gauche de la planche.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={resetEvacTexts}
                          className="shrink-0 text-xs font-semibold text-safety-green hover:text-green-700"
                        >
                          Réinitialiser
                        </button>
                      </div>

                      <div>
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          Mention de conformité
                        </span>
                        <input
                          value={exportEvacConformity}
                          onChange={(e) => setExportEvacConformity(e.target.value)}
                          placeholder="Laisser vide pour ne rien imprimer"
                          className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none"
                        />
                        <p className="mt-1 text-[11px] leading-4 text-slate-500">
                          Imprimée à droite du bandeau vert.
                        </p>
                      </div>

                      <div>
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          Bloc 1 — titre
                        </span>
                        <input
                          value={exportEvacFireTitle}
                          onChange={(e) => setExportEvacFireTitle(e.target.value)}
                          placeholder="INCENDIE"
                          className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs font-semibold text-slate-950 focus:border-safety-green focus:outline-none"
                        />
                        <textarea
                          value={exportEvacFireText}
                          onChange={(e) => setExportEvacFireText(e.target.value)}
                          rows={5}
                          className="mt-2 block w-full resize-none rounded-lg border border-slate-300 bg-white py-2.5 px-3 text-[11px] leading-4 text-slate-950 focus:border-safety-green focus:outline-none"
                        />
                      </div>

                      <div>
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          Ligne d&apos;appel d&apos;urgence
                        </span>
                        <textarea
                          value={exportEvacCallText}
                          onChange={(e) => setExportEvacCallText(e.target.value)}
                          rows={2}
                          placeholder="Laisser vide pour masquer la ligne"
                          className="block w-full resize-none rounded-lg border border-slate-300 bg-white py-2 px-3 text-[11px] leading-4 text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none"
                        />
                      </div>

                      <div>
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          Bloc 2 — titre
                        </span>
                        <input
                          value={exportEvacTitle}
                          onChange={(e) => setExportEvacTitle(e.target.value)}
                          placeholder="EVACUATION"
                          className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs font-semibold text-slate-950 focus:border-safety-green focus:outline-none"
                        />
                        <textarea
                          value={exportEvacText}
                          onChange={(e) => setExportEvacText(e.target.value)}
                          rows={6}
                          className="mt-2 block w-full resize-none rounded-lg border border-slate-300 bg-white py-2.5 px-3 text-[11px] leading-4 text-slate-950 focus:border-safety-green focus:outline-none"
                        />
                      </div>

                      <div>
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          Bloc 3 — titre
                        </span>
                        <input
                          value={exportEvacPreventionTitle}
                          onChange={(e) => setExportEvacPreventionTitle(e.target.value)}
                          placeholder="PREVENTION"
                          className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs font-semibold text-slate-950 focus:border-safety-green focus:outline-none"
                        />
                        <textarea
                          value={exportEvacPreventionText}
                          onChange={(e) => setExportEvacPreventionText(e.target.value)}
                          rows={5}
                          className="mt-2 block w-full resize-none rounded-lg border border-slate-300 bg-white py-2.5 px-3 text-[11px] leading-4 text-slate-950 focus:border-safety-green focus:outline-none"
                        />
                      </div>

                      <div>
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          Point de rassemblement
                        </span>
                        <input
                          value={exportEvacAssemblyLabel}
                          onChange={(e) => setExportEvacAssemblyLabel(e.target.value)}
                          placeholder="Laisser vide pour masquer l'encadré"
                          className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none"
                        />
                      </div>

                      <div>
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          Encadré 114
                        </span>
                        <textarea
                          value={exportNfDeafText}
                          onChange={(e) => setExportNfDeafText(e.target.value)}
                          rows={2}
                          placeholder="Laisser vide pour masquer l'encadré"
                          className="block w-full resize-none rounded-lg border border-slate-300 bg-white py-2 px-3 text-[11px] leading-4 text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                            Titre de la légende
                          </span>
                          <input
                            value={exportNfLegendTitle}
                            onChange={(e) => setExportNfLegendTitle(e.target.value)}
                            placeholder="LEGENDE"
                            className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs font-semibold text-slate-950 focus:border-safety-green focus:outline-none"
                          />
                        </div>
                        <div>
                          <div className="mb-1 flex justify-between text-xs text-slate-500">
                            <span>Taille du texte</span>
                            <span>{exportEvacBodyFontSize}px</span>
                          </div>
                          <input
                            type="range"
                            min="7"
                            max="14"
                            step="0.5"
                            value={exportEvacBodyFontSize}
                            onChange={(e) => setExportEvacBodyFontSize(Number(e.target.value))}
                            className="w-full accent-safety-green"
                          />
                        </div>
                      </div>
                    </div>
                  ) : isInterventionTheme ? (
                    <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/40 p-3">
                      <div>
                        <h3 className="text-sm font-bold text-slate-950">Textes plan d&apos;intervention</h3>
                        <p className="text-[11px] leading-4 text-slate-500">
                          Colonne d&apos;identification à droite. Le plan occupe tout le reste de la feuille.
                        </p>
                      </div>

                      <div>
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          Mention de conformité
                        </span>
                        <input
                          value={exportNfConformity}
                          onChange={(e) => setExportNfConformity(e.target.value)}
                          placeholder="Laisser vide pour ne rien imprimer"
                          className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none"
                        />
                      </div>

                      <div>
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          Titre de la légende
                        </span>
                        <input
                          value={exportNfLegendTitle}
                          onChange={(e) => setExportNfLegendTitle(e.target.value)}
                          placeholder="LEGENDE"
                          className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs font-semibold text-slate-950 focus:border-safety-green focus:outline-none"
                        />
                        <p className="mt-1 text-[11px] leading-4 text-slate-500">
                          La légende reprend tous les équipements posés sur le plan et resserre
                          ses lignes pour tenir dans la colonne.
                        </p>
                      </div>
                    </div>
                  ) : isNfTheme ? (
                    <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/40 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-bold text-slate-950">Textes NF X08-070</h3>
                          <p className="text-[11px] leading-4 text-slate-500">
                            Colonne de gauche de la planche normative.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={resetNfTexts}
                          className="shrink-0 text-xs font-semibold text-safety-green hover:text-green-700"
                        >
                          Réinitialiser
                        </button>
                      </div>

                      <div>
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          Mention de conformité
                        </span>
                        <input
                          value={exportNfConformity}
                          onChange={(e) => setExportNfConformity(e.target.value)}
                          placeholder="Laisser vide pour ne rien imprimer"
                          className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none"
                        />
                        <p className="mt-1 text-[11px] leading-4 text-slate-500">
                          Imprimée dans le bandeau. Ne la laissez que si la planche est
                          réellement conforme.
                        </p>
                      </div>

                      <div className="grid grid-cols-[1fr_120px] gap-2">
                        <div>
                          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                            Bloc 1 — titre
                          </span>
                          <input
                            value={exportNfFireTitle}
                            onChange={(e) => setExportNfFireTitle(e.target.value)}
                            placeholder="INCENDIE"
                            className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs font-semibold text-slate-950 focus:border-safety-green focus:outline-none"
                          />
                        </div>
                        <div>
                          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                            Numéros
                          </span>
                          <input
                            value={exportNfFireNumbers}
                            onChange={(e) => setExportNfFireNumbers(e.target.value)}
                            placeholder="18 / 112"
                            className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs font-semibold text-slate-950 focus:border-safety-green focus:outline-none"
                          />
                        </div>
                      </div>

                      <div>
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          Phrase d&apos;appel
                        </span>
                        <input
                          value={exportNfFireIntro}
                          onChange={(e) => setExportNfFireIntro(e.target.value)}
                          className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs text-slate-950 focus:border-safety-green focus:outline-none"
                        />
                      </div>

                      <div>
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          Mention sous les numéros
                        </span>
                        <input
                          value={exportNfEmergencyNote}
                          onChange={(e) => setExportNfEmergencyNote(e.target.value)}
                          className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs text-slate-950 focus:border-safety-green focus:outline-none"
                        />
                      </div>

                      <div>
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          Bloc 2 — titre
                        </span>
                        <input
                          value={exportNfEvacuationTitle}
                          onChange={(e) => setExportNfEvacuationTitle(e.target.value)}
                          placeholder="EVACUATION"
                          className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs font-semibold text-slate-950 focus:border-safety-green focus:outline-none"
                        />
                        <textarea
                          value={exportNfEvacuationText}
                          onChange={(e) => setExportNfEvacuationText(e.target.value)}
                          rows={9}
                          className="mt-2 block w-full resize-none rounded-lg border border-slate-300 bg-white py-2.5 px-3 text-[11px] leading-4 text-slate-950 focus:border-safety-green focus:outline-none"
                        />
                        <p className="mt-1 text-[11px] leading-4 text-slate-500">
                          Une ligne commençant par « 1 - » est mise en gras, une ligne
                          mentionnant « ascenseur » passe en rouge.
                        </p>
                      </div>

                      <div className="grid grid-cols-[1fr_120px] gap-2">
                        <div>
                          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                            Bloc 3 — titre
                          </span>
                          <input
                            value={exportNfMedicalTitle}
                            onChange={(e) => setExportNfMedicalTitle(e.target.value)}
                            placeholder="ACCIDENT OU MALAISE"
                            className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs font-semibold text-slate-950 focus:border-safety-green focus:outline-none"
                          />
                        </div>
                        <div>
                          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                            Numéros
                          </span>
                          <input
                            value={exportNfMedicalNumbers}
                            onChange={(e) => setExportNfMedicalNumbers(e.target.value)}
                            placeholder="15 / 118"
                            className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs font-semibold text-slate-950 focus:border-safety-green focus:outline-none"
                          />
                        </div>
                      </div>

                      <div>
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          Encadré 114
                        </span>
                        <textarea
                          value={exportNfDeafText}
                          onChange={(e) => setExportNfDeafText(e.target.value)}
                          rows={2}
                          placeholder="Laisser vide pour masquer l'encadré"
                          className="block w-full resize-none rounded-lg border border-slate-300 bg-white py-2 px-3 text-[11px] leading-4 text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none"
                        />
                      </div>

                      <div>
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          Bloc 4 — titre
                        </span>
                        <input
                          value={exportNfPreventionTitle}
                          onChange={(e) => setExportNfPreventionTitle(e.target.value)}
                          placeholder="PREVENTION"
                          className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs font-semibold text-slate-950 focus:border-safety-green focus:outline-none"
                        />
                        <textarea
                          value={exportNfPreventionText}
                          onChange={(e) => setExportNfPreventionText(e.target.value)}
                          rows={4}
                          className="mt-2 block w-full resize-none rounded-lg border border-slate-300 bg-white py-2.5 px-3 text-[11px] leading-4 text-slate-950 focus:border-safety-green focus:outline-none"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                            Titre de la légende
                          </span>
                          <input
                            value={exportNfLegendTitle}
                            onChange={(e) => setExportNfLegendTitle(e.target.value)}
                            placeholder="LEGENDE"
                            className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs font-semibold text-slate-950 focus:border-safety-green focus:outline-none"
                          />
                        </div>
                        <div>
                          <div className="mb-1 flex justify-between text-xs text-slate-500">
                            <span>Taille du texte</span>
                            <span>{exportNfBodyFontSize}px</span>
                          </div>
                          <input
                            type="range"
                            min="7"
                            max="14"
                            step="0.5"
                            value={exportNfBodyFontSize}
                            onChange={(e) => setExportNfBodyFontSize(Number(e.target.value))}
                            className="w-full accent-safety-green"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                  <>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Consignes en cas d'incendie
                    </label>
                    <textarea
                      value={exportSafetyText}
                      onChange={(e) => setExportSafetyText(e.target.value)}
                      rows={5}
                      className="block w-full resize-none rounded-xl border border-slate-300 bg-white py-3 px-4 text-sm text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none"
                    />
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <div>
                        <div className="mb-1 flex justify-between text-xs text-slate-500">
                          <span>Hauteur cadre</span>
                          <span>{exportSafetyPanelHeight}px</span>
                        </div>
                        <input
                          type="range"
                          min="220"
                          max="520"
                          value={exportSafetyPanelHeight}
                          onChange={(e) => setExportSafetyPanelHeight(Number(e.target.value))}
                          className="w-full accent-safety-green"
                        />
                      </div>
                      <div>
                        <div className="mb-1 flex justify-between text-xs text-slate-500">
                          <span>Taille écriture</span>
                          <span>{exportSafetyFontSize}px</span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="28"
                          value={exportSafetyFontSize}
                          onChange={(e) => setExportSafetyFontSize(Number(e.target.value))}
                          className="w-full accent-safety-green"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Informations equipe intervention
                    </label>
                    <textarea
                      value={exportInterventionText}
                      onChange={(e) => setExportInterventionText(e.target.value)}
                      rows={4}
                      className="block w-full resize-none rounded-xl border border-slate-300 bg-white py-3 px-4 text-sm text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none"
                    />
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <div>
                        <div className="mb-1 flex justify-between text-xs text-slate-500">
                          <span>Hauteur cadre</span>
                          <span>{exportInterventionPanelHeight}px</span>
                        </div>
                        <input
                          type="range"
                          min="180"
                          max="520"
                          value={exportInterventionPanelHeight}
                          onChange={(e) => setExportInterventionPanelHeight(Number(e.target.value))}
                          className="w-full accent-safety-green"
                        />
                      </div>
                      <div>
                        <div className="mb-1 flex justify-between text-xs text-slate-500">
                          <span>Taille écriture</span>
                          <span>{exportInterventionFontSize}px</span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="28"
                          value={exportInterventionFontSize}
                          onChange={(e) => setExportInterventionFontSize(Number(e.target.value))}
                          className="w-full accent-safety-green"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <h3 className="mb-3 text-sm font-bold text-slate-950">Ajuster la clé / légende</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="mb-1 flex justify-between text-xs text-slate-500">
                          <span>Hauteur cadre</span>
                          <span>{exportLegendPanelHeight}px</span>
                        </div>
                        <input
                          type="range"
                          min="260"
                          max="943"
                          value={exportLegendPanelHeight}
                          onChange={(e) => setExportLegendPanelHeight(Number(e.target.value))}
                          className="w-full accent-safety-green"
                        />
                      </div>
                      <div>
                        <div className="mb-1 flex justify-between text-xs text-slate-500">
                          <span>Taille écriture</span>
                          <span>{exportLegendFontSize}px</span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="28"
                          value={exportLegendFontSize}
                          onChange={(e) => setExportLegendFontSize(Number(e.target.value))}
                          className="w-full accent-safety-green"
                        />
                      </div>
                    </div>
                  </div>
                  </>
                  )}

                  {/* Logos: who made the sheet, and who it is for */}
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <h3 className="mb-1 text-sm font-bold text-slate-950">Logos</h3>
                    <p className="mb-3 text-[11px] leading-4 text-slate-500">
                      {isInterventionTheme
                        ? "Colonne de droite : logo client en haut, au-dessus de l'adresse. Logo studio (auteur de la planche) en bas, sous la légende."
                        : isNfTheme || isEvacuationTheme
                          ? "Logo client en haut à droite, au-dessus de l'adresse. Logo studio (auteur de la planche) en bas à gauche."
                          : "Affichés dans la bande d'en-tête. Client à gauche, studio à droite."}
                    </p>
                    <div className="space-y-3">
                      {([
                        {
                          key: "client",
                          label: "Logo client · ce plan",
                          value: exportClientLogo,
                          scale: exportClientLogoScale,
                          setScale: setExportClientLogoScale,
                          offsetX: exportClientLogoOffsetX,
                          setOffsetX: setExportClientLogoOffsetX,
                          offsetY: exportClientLogoOffsetY,
                          setOffsetY: setExportClientLogoOffsetY
                        },
                        {
                          key: "studio",
                          label: "Logo studio · tous les plans",
                          value: exportStudioLogo,
                          scale: exportStudioLogoScale,
                          setScale: setExportStudioLogoScale,
                          offsetX: exportStudioLogoOffsetX,
                          setOffsetX: setExportStudioLogoOffsetX,
                          offsetY: exportStudioLogoOffsetY,
                          setOffsetY: setExportStudioLogoOffsetY
                        }
                      ] as const).map(({ key, label, value, scale, setScale, offsetX, setOffsetX, offsetY, setOffsetY }) => (
                        <div key={key} className="rounded-lg border border-slate-200 p-2.5">
                          <div className="mb-1.5 flex items-center justify-between">
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</span>
                              <p className="mt-0.5 text-[9px] leading-3 text-slate-400">
                                {key === "client"
                                  ? "Changez-le pour chaque client; il est sauvegardé avec ce projet."
                                  : "Mémorisé dans l’application jusqu’à votre prochaine modification."}
                              </p>
                            </div>
                            {value && (scale !== 100 || offsetX !== 0 || offsetY !== 0) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setScale(100);
                                  setOffsetX(0);
                                  setOffsetY(0);
                                }}
                                className="text-[11px] font-semibold text-safety-green hover:text-green-700"
                              >
                                Réinitialiser
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <label
                              className={`flex h-12 flex-1 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-slate-300 bg-slate-50 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100 ${
                                value ? "border-safety-green/40 bg-white" : ""
                              }`}
                            >
                              {value ? (
                                <img src={value} alt={label} className="max-h-10 max-w-full object-contain" />
                              ) : (
                                <span>Choisir…</span>
                              )}
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                                className="hidden"
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  event.target.value = "";
                                  if (!file) return;
                                  void importConfiguredLogo(key, file);
                                }}
                              />
                            </label>
                            {value && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (key === "studio") {
                                    setStudioLogoPreference(DEFAULT_STUDIO_LOGO);
                                    setSaveStatus("Logo studio PREV’ INC & CIE restauré");
                                  } else {
                                    setClientLogoForPlan("");
                                    setSaveStatus("Logo client retiré — sauvegardez le plan");
                                  }
                                  window.setTimeout(() => setSaveStatus(""), 3000);
                                }}
                                title={key === "studio" ? "Rétablir le logo PREV’ INC & CIE" : "Retirer le logo client"}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600"
                              >
                                {key === "studio" ? <RefreshCw className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </button>
                            )}
                          </div>

                          {/* Size and position, only once there is something to move */}
                          {value && (
                            <div className="mt-2.5 space-y-2">
                              <div>
                                <div className="mb-1 flex justify-between text-xs text-slate-500">
                                  <span>Taille</span>
                                  <span>{scale}%</span>
                                </div>
                                <input
                                  type="range"
                                  min="40"
                                  max="500"
                                  value={scale}
                                  onChange={(e) => setScale(Number(e.target.value))}
                                  className="w-full accent-safety-green"
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <div className="mb-1 flex justify-between text-xs text-slate-500">
                                    <span>← Horizontal →</span>
                                    <span>{offsetX}px</span>
                                  </div>
                                  <input
                                    type="range"
                                    min="-250"
                                    max="250"
                                    value={offsetX}
                                    onChange={(e) => setOffsetX(Number(e.target.value))}
                                    className="w-full accent-safety-green"
                                  />
                                </div>
                                <div>
                                  <div className="mb-1 flex justify-between text-xs text-slate-500">
                                    <span>↑ Vertical ↓</span>
                                    <span>{offsetY}px</span>
                                  </div>
                                  <input
                                    type="range"
                                    min="-250"
                                    max="250"
                                    value={offsetY}
                                    onChange={(e) => setOffsetY(Number(e.target.value))}
                                    className="w-full accent-safety-green"
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      {logoSettingsError ? (
                        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-medium text-red-700">
                          {logoSettingsError}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {/* Section visibility: hide any block, the plan reclaims the space */}
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <h3 className="mb-1 text-sm font-bold text-slate-950">Sections affichées</h3>
                    <p className="mb-3 text-[11px] leading-4 text-slate-500">
                      Masquez les blocs inutiles. Le plan s'agrandit pour occuper l'espace libéré.
                    </p>
                    <div className="space-y-2">
                      {([
                        // The intervention sheet is the plan plus its legend —
                        // it has no instruction column at all. The normative one
                        // has a consignes column but no intervention panel.
                        // Showing switches that do nothing is worse than hiding
                        // them.
                        ...(isInterventionTheme
                          ? []
                          : [{
                              key: "safety",
                              label: isNfTheme || isEvacuationTheme ? "Colonne de consignes" : "Consignes de sécurité",
                              checked: exportShowSafety,
                              setter: setExportShowSafety
                            }]),
                        ...(isNfTheme || isInterventionTheme || isEvacuationTheme
                          ? []
                          : [{ key: "intervention", label: "Équipe d'intervention", checked: exportShowIntervention, setter: setExportShowIntervention }]),
                        { key: "legend", label: "Légende", checked: exportShowLegend, setter: setExportShowLegend }
                      ] as const).map(({ key, label, checked, setter }) => (
                        <label
                          key={key}
                          className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => setter(e.target.checked)}
                            className="h-4 w-4 accent-safety-green"
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-white/95 px-1 pt-3 pb-1 backdrop-blur">
                    <p className="mr-auto text-[11px] leading-tight text-slate-500">
                      Le format du fichier et le format papier se choisissent
                      <br />
                      dans le bouton <span className="font-semibold text-slate-700">Export</span> de la barre du studio.
                    </p>
                    <button
                      onClick={() => setExportModalOpen(false)}
                      className="flex items-center justify-center space-x-2 rounded-xl bg-safety-green px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-safety-green/10 hover:bg-green-600"
                    >
                      <Check className="h-4 w-4" />
                      <span>Terminé</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {exportPreviewUrl && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-white/85 px-4 py-4 backdrop-blur-sm">
            <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3">
                <div>
                  <h2 className="text-base font-bold text-slate-950">Prévisualisation PDF</h2>
                  <p className="text-xs text-slate-500">Vérifiez le rendu avant de télécharger.</p>
                </div>
                <button
                  onClick={() => {
                    revokeObjectUrlSafely(exportPreviewUrl);
                    setExportPreviewUrl("");
                  }}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-slate-950"
                  title="Fermer la prévisualisation"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <iframe
                src={exportPreviewUrl}
                title="Prévisualisation PDF"
                className="h-full w-full bg-white"
              />
            </div>
          </div>
        )}

        {/* Unsaved-changes confirmation when leaving the editor */}
        {pendingNav && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#252527] p-5 shadow-2xl">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-neutral-100">
                    Enregistrer les modifications ?
                  </h2>
                  <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">
                    Vous avez des modifications non enregistrées. Voulez-vous les
                    sauvegarder avant de quitter ?
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSaveAndLeave()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Sauvegarder et quitter
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingNav(false);
                    router.push("/evacuation-plans");
                  }}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.04] py-2.5 text-[12px] font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  Quitter sans enregistrer
                </button>
                <button
                  type="button"
                  onClick={() => setPendingNav(false)}
                  className="w-full rounded-lg py-2 text-[12px] font-medium text-neutral-500 transition-colors hover:text-neutral-200"
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal : Confirmation Sauvegarder ou non avant export */}
        {exportSaveConfirmOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
            <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#232326] p-6 text-neutral-100 shadow-2xl">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                  <Save className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Sauvegarder avant d&apos;exporter ?</h3>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-400">
                    Vous avez des modifications non enregistrées sur votre plan. Voulez-vous sauvegarder les modifications en base de données avant de télécharger le fichier ?
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-2">
                <button
                  type="button"
                  onClick={async () => {
                    setExportSaveConfirmOpen(false);
                    if (pendingExportAction) {
                      if (await handleSave()) await pendingExportAction();
                      setPendingExportAction(null);
                    }
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500"
                >
                  <Save className="h-4 w-4" />
                  Sauvegarder et exporter
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    setExportSaveConfirmOpen(false);
                    if (pendingExportAction) {
                      await pendingExportAction();
                      setPendingExportAction(null);
                    }
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-xs font-medium text-neutral-200 transition-colors hover:bg-white/10"
                >
                  <Download className="h-4 w-4" />
                  Exporter sans sauvegarder
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setExportSaveConfirmOpen(false);
                    setPendingExportAction(null);
                  }}
                  className="w-full rounded-xl py-2 text-xs font-medium text-neutral-400 hover:text-white"
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        )}

        <WatermarkModal
          open={watermarkModalOpen}
          value={watermarkDraft}
          onChange={setWatermarkDraft}
          onApply={applyWatermarkSettings}
          onCancel={() => setWatermarkModalOpen(false)}
        />

        {/* Classic Crop Modal */}
        <CropModal
          isOpen={cropModalOpen}
          onClose={() => setCropModalOpen(false)}
          imageUrl={backgroundUrl || ""}
          onApplyCrop={handleApplyCrop}
          loading={cropping}
        />

        {/* Freehand Polygonal / Lasso Crop Modal */}
        {polygonCropModalOpen && (
          <PolygonCropModal
            isOpen
            onClose={() => setPolygonCropModalOpen(false)}
            mainBackgroundUrl={polygonCropMainUrl || backgroundUrl || ""}
            planOverlays={planOverlays}
            selectedOverlayId={selectedOverlayId}
            buildingName={plan?.building_name || "Plan principal"}
            onCropMainPlan={handleCropMainPlan}
            onCropSecondaryPlan={handleCropSecondaryPlan}
          />
        )}
      </div>
    </ProtectedRoute>
  );
}
