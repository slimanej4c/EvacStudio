"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/context/AuthContext";
import { useRouter, useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { ArrowLeft, Save, Trash2, Settings, HelpCircle, Loader2, Sparkles, RefreshCw, X, FileDown, Download, Eye, PanelLeft, PanelRight, Eraser, Circle, Square, Copy, CopyPlus, ClipboardPaste, Minus, Anchor, Undo2, Type, AlertTriangle } from "lucide-react";
import { IconType, SAFETY_ICONS, SafetyIconDefinition, getIconImageSource, isYouAreHereIcon } from "@/utils/safetyIcons";
import { CanvasIcon, CanvasShape, CanvasText, ShapeKind, EraserShape, PlanCanvasHandle, FONT_OPTIONS } from "@/components/PlanCanvas";
import { buildApiUrl } from "@/lib/api";
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

const EXPORT_CANVAS_WIDTH = 1600;
// A-series paper is 1:√2, so A4 and A3 share one design canvas — only the printed
// size and the resulting resolution differ between them.
const EXPORT_PAPER_SIZES = {
  a4: { label: "A4", widthMm: 297, heightMm: 210 },
  a3: { label: "A3", widthMm: 420, heightMm: 297 }
} as const;
type ExportPaperFormat = keyof typeof EXPORT_PAPER_SIZES;
const EXPORT_THEMES = {
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

const EXPORT_CANVAS_HEIGHT = 1131; // 1600 / √2, rounded
const ICON_CLIPBOARD_KEY = "securplan:icon-clipboard";
const EXPORT_FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const EXPORT_CARD_RADIUS = 10;
const EXPORT_CARD_HEADER_H = 38;
const EXPORT_MARGIN = 30;
const EXPORT_GUTTER = 24;
const EXPORT_SIDE_W = 292;
const EXPORT_HEADER_H = 104;
const EXPORT_FOOTER_H = 44;
const EXPORT_GREEN = "#168f5a";
const EXPORT_GREEN_DARK = "#0d6b41";
const EXPORT_RED = "#c8362c";
const EXPORT_SLATE = "#33475b";
const EXPORT_OUTPUT_SCALE = 4;
const EXPORT_STAGE_PIXEL_RATIO = 6;
const EXPORT_PREVIEW_STAGE_PIXEL_RATIO = 2;

interface EvacuationPlanBackend {
  id: number;
  title: string;
  building_name: string;
  floor_name: string;
  background_file: string;
  background_type: "image" | "pdf";
  cleaned_background_file: string | null;
  use_cleaned_background: boolean;
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
  }>;
}

interface PlanPictogramBackend {
  type: string;
  label: string;
  file_name: string;
  url: string;
}

interface OpenAICleanResult {
  before_image: string;
  after_image: string;
  quality?: "low" | "medium" | "high";
  generation_prompt?: string;
  analysis?: Record<string, unknown>;
  models?: {
    analysis?: string;
    image?: string;
  };
  warnings?: string[];
  verification?: {
    murs_oublies: Array<Record<string, unknown>>;
    murs_inventes: Array<Record<string, unknown>>;
    ouvertures_deplacees: number;
    score: number;
    recommandations: string[];
  };
}

type OpenAICleaningStatus =
  | "pending"
  | "loading_source"
  | "analyzing"
  | "prompt_ready"
  | "generating"
  | "saving_result"
  | "completed"
  | "failed";

type CleanMethod = "local" | "sketch_to_plan" | "existing_plan_cleanup";

interface OpenAICostEstimate {
  currency: string;
  estimated_min: number;
  estimated_max: number;
  is_estimate: boolean;
  details: {
    analysis: boolean;
    generation_count_max: number;
    verification: boolean;
    quality: string;
    output_size: string;
    cleaning_mode: string;
    max_automatic_corrections: number;
  };
}

interface OpenAICleanJobStatus extends Partial<OpenAICleanResult> {
  job_id: number;
  status: OpenAICleaningStatus;
  error?: string;
  error_code?: string;
  diagnostic?: string;
}

interface OpenAICleanHistoryItem {
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
  const { loading: authLoading, token } = useAuth();
  const router = useRouter();
  
  const [plan, setPlan] = useState<EvacuationPlanBackend | null>(null);
  const [availableIconDefinitions, setAvailableIconDefinitions] = useState<Record<string, SafetyIconDefinition>>(SAFETY_ICONS);
  const [icons, setIcons] = useState<CanvasIcon[]>([]);
  const [shapes, setShapes] = useState<CanvasShape[]>([]);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [shapeTool, setShapeTool] = useState<ShapeKind | null>(null);
  const [shapeStrokeWidth, setShapeStrokeWidth] = useState(3);
  const [selectedIconId, setSelectedIconId] = useState<string | null>(null);
  const [placementIconType, setPlacementIconType] = useState<IconType | null>(null);
  const [defaultIconSize, setDefaultIconSize] = useState({ width: 40, height: 40 });

  // Free text annotations
  const [texts, setTexts] = useState<CanvasText[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [placementText, setPlacementText] = useState(false);
  
  const [zoom, setZoom] = useState(1.0);
  const [fitSignal, setFitSignal] = useState(0);
  const [mode, setMode] = useState<"select" | "pan" | "erase">("select");
  const spaceHeldRef = useRef(false);
  const modeBeforeSpaceRef = useRef<"select" | "pan" | "erase">("select");
  const [leftDockOpen, setLeftDockOpen] = useState(true);
  const [rightDockOpen, setRightDockOpen] = useState(true);
  // Default to 100% so the canvas fills the available space and no inert
  // backdrop is left on the right side of the window.
  const [canvasWidthPercent, setCanvasWidthPercent] = useState(100);
  const planCanvasRef = useRef<PlanCanvasHandle>(null);
  const [eraserSize, setEraserSize] = useState(24);
  const [eraserShape, setEraserShape] = useState<EraserShape>("square");
  const [eraseStrokeCount, setEraseStrokeCount] = useState(0);
  const [undoEraseSignal, setUndoEraseSignal] = useState(0);
  const [resetEraseSignal, setResetEraseSignal] = useState(0);
  const [savingErase, setSavingErase] = useState(false);
  const [clipboardHasIcon, setClipboardHasIcon] = useState(false);

  useEffect(() => {
    setClipboardHasIcon(Boolean(window.localStorage.getItem(ICON_CLIPBOARD_KEY)));
  }, []);
  const [viewportWidth, setViewportWidth] = useState(0);

  // The interface is sized in pixels from the real window width rather than from
  // percentages resolved by CSS, so its total can never exceed the screen.
  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleaningText, setCleaningText] = useState("Traitement OpenCV en cours...");
  const [cleanModalOpen, setCleanModalOpen] = useState(false);
  const [revertConfirmOpen, setRevertConfirmOpen] = useState(false);
  const [cleanMethod, setCleanMethod] = useState<CleanMethod>("local");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiHasSavedKey, setOpenaiHasSavedKey] = useState(false);
  const [openaiSettingsUpdatedAt, setOpenaiSettingsUpdatedAt] = useState<string | null>(null);
  const [openaiSettingsLoading, setOpenaiSettingsLoading] = useState(false);
  const [openaiKeySaving, setOpenaiKeySaving] = useState(false);
  const [openaiKeyDeleting, setOpenaiKeyDeleting] = useState(false);
  const [openaiKeyStatus, setOpenaiKeyStatus] = useState("");
  const [openaiQuality, setOpenaiQuality] = useState<"low" | "medium" | "high">("medium");
  const [openaiOutputSize, setOpenaiOutputSize] = useState("auto");
  const [openaiVerificationEnabled, setOpenaiVerificationEnabled] = useState(false);
  const [openaiMaxAutomaticCorrections, setOpenaiMaxAutomaticCorrections] = useState(0);
  const [openaiCostEstimate, setOpenaiCostEstimate] = useState<OpenAICostEstimate | null>(null);
  const [openaiCostLoading, setOpenaiCostLoading] = useState(false);
  const [openaiKeepMachines, setOpenaiKeepMachines] = useState(true);
  const [openaiKeepDoorsOpenings, setOpenaiKeepDoorsOpenings] = useState(true);
  const [openaiRemoveText, setOpenaiRemoveText] = useState(false);
  const [openaiRemoveDimensions, setOpenaiRemoveDimensions] = useState(false);
  const [openaiCorrectPerspective, setOpenaiCorrectPerspective] = useState(false);
  const [openaiWallThickness, setOpenaiWallThickness] = useState(3);
  const [openaiAdditionalInstructions, setOpenaiAdditionalInstructions] = useState("");
  const [existingRemoveDimensions, setExistingRemoveDimensions] = useState(true);
  const [existingRemovePictograms, setExistingRemovePictograms] = useState(true);
  const [existingRemoveText, setExistingRemoveText] = useState(false);
  const [existingRemoveAnnotations, setExistingRemoveAnnotations] = useState(true);
  const [existingRemoveTitleBlock, setExistingRemoveTitleBlock] = useState(true);
  const [existingRemoveHatching, setExistingRemoveHatching] = useState(true);
  const [existingRemoveFurniture, setExistingRemoveFurniture] = useState(true);
  const [existingPreserveDoors, setExistingPreserveDoors] = useState(true);
  const [existingPreserveStairs, setExistingPreserveStairs] = useState(true);
  const [existingPreserveOpenings, setExistingPreserveOpenings] = useState(true);
  const [existingSimplifyRendering, setExistingSimplifyRendering] = useState(true);
  const [existingCleanupLevel, setExistingCleanupLevel] = useState<"leger" | "moyen" | "fort">("moyen");
  const [openaiCleaningStep, setOpenaiCleaningStep] = useState<OpenAICleaningStatus>("pending");
  const [openaiKeyConfigOpen, setOpenaiKeyConfigOpen] = useState(false);
  const [openaiCleaning, setOpenaiCleaning] = useState(false);
  const [openaiApplying, setOpenaiApplying] = useState(false);
  const [openaiResult, setOpenaiResult] = useState<OpenAICleanResult | null>(null);
  const [openaiError, setOpenaiError] = useState("");
  const [openaiHistory, setOpenaiHistory] = useState<OpenAICleanHistoryItem[]>([]);
  const [openaiHistoryLoading, setOpenaiHistoryLoading] = useState(false);
  const [openaiHistoryApplyingId, setOpenaiHistoryApplyingId] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState("");
  // Unsaved-changes guard: a JSON snapshot of icons/shapes/texts captured at the
  // last successful save (and at initial load). Comparing the current state to it
  // tells us whether leaving the editor would discard work.
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [pendingNav, setPendingNav] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"png" | "pdf">("pdf");
  const [exportTheme, setExportTheme] = useState<ExportTheme>("modern");
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
  const [exportPlanRotation, setExportPlanRotation] = useState(0);
  const [exportPlanOffsetX, setExportPlanOffsetX] = useState(0);
  const [exportPlanOffsetY, setExportPlanOffsetY] = useState(0);
  // Logos overlaid on the export sheet: the client's brand (left of the header)
  // and our studio's brand (right of the header). Stored as data URLs so the
  // export works fully offline once loaded.
  const [exportClientLogo, setExportClientLogo] = useState("");
  const [exportStudioLogo, setExportStudioLogo] = useState("");
  // Section visibility: each block can be hidden independently. When a whole
  // column is empty the plan widens to reclaim the space.
  const [exportShowSafety, setExportShowSafety] = useState(true);
  const [exportShowIntervention, setExportShowIntervention] = useState(true);
  const [exportShowLegend, setExportShowLegend] = useState(true);
  const iconDefinitions = useMemo(
    () => ({ ...SAFETY_ICONS, ...availableIconDefinitions }),
    [availableIconDefinitions]
  );
  const LEFT_DOCK_WIDTH = 208;
  const RIGHT_DOCK_WIDTH = 224;
  const leftDockWidth = leftDockOpen ? LEFT_DOCK_WIDTH : 0;
  const rightDockWidth = rightDockOpen ? RIGHT_DOCK_WIDTH : 0;
  const canvasColumnWidth = viewportWidth
    ? Math.max(
        160,
        Math.round((viewportWidth - leftDockWidth - rightDockWidth) * (canvasWidthPercent / 100))
      )
    : 0;
  // Total interface width: docks + workspace. Clamped to the viewport so the
  // fixed container can never exceed the window (no horizontal scroll, no
  // inert backdrop on the right when the min-width floor kicks in).
  const interfaceWidth = viewportWidth
    ? Math.min(viewportWidth, leftDockWidth + canvasColumnWidth + rightDockWidth)
    : 0;

  const getPlanAuthHeaders = (): Record<string, string> => {
    const authToken = token || (typeof window !== "undefined" ? localStorage.getItem("token") : null);
    return authToken ? { Authorization: `Bearer ${authToken}` } : {};
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
            anchor_y: icon.anchor_y ?? null
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
            color: shape.color
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
          }));
          setTexts(canvasTexts);

          // Baseline for the unsaved-changes guard: the freshly loaded state.
          setSavedSnapshot(JSON.stringify({
            icons: canvasIcons.map(({ icon_type, x, y, width, height, rotation, label, anchor_x, anchor_y }) => ({
              icon_type, x, y, width, height, rotation, label, anchor_x, anchor_y,
            })),
            shapes: canvasShapes.map(({ shape_type, x, y, width, height, rotation, stroke_width, color }) => ({
              shape_type, x, y, width, height, rotation, stroke_width, color,
            })),
            texts: canvasTexts.map(({ text, x, y, font_size, font_family, color, bold, italic, background_color, rotation }) => ({
              text, x, y, font_size, font_family, color, bold, italic, background_color, rotation,
            })),
          }));
        } else if (res.status === 401 || res.status === 403) {
          router.push("/login");
        } else {
          router.push("/dashboard");
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
            color: "#168f5a",
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
      const current = JSON.stringify({
        icons: icons.map(({ icon_type, x, y, width, height, rotation, label, anchor_x, anchor_y }) => ({
          icon_type, x, y, width, height, rotation, label, anchor_x, anchor_y,
        })),
        shapes: shapes.map(({ shape_type, x, y, width, height, rotation, stroke_width, color }) => ({
          shape_type, x, y, width, height, rotation, stroke_width, color,
        })),
        texts: texts.map(({ text, x, y, font_size, font_family, color, bold, italic, background_color, rotation }) => ({
          text, x, y, font_size, font_family, color, bold, italic, background_color, rotation,
        })),
      });
      if (current !== savedSnapshot) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [icons, shapes, texts, savedSnapshot]);

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
      else if (key === "e") setMode("erase");
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

    void fetchOpenAIHistory();
    void fetchOpenAICostEstimate();
    if (cleanMethod === "local") return;

    let cancelled = false;
    const fetchOpenAISettings = async () => {
      setOpenaiSettingsLoading(true);
      try {
        const res = await fetch(buildApiUrl(`/api/openai-settings/`), {
          headers: getPlanAuthHeaders(),
          cache: "no-store",
        });
        if (!res.ok) return;

        const data: { has_api_key: boolean; updated_at: string | null } = await res.json();
        if (cancelled) return;
        setOpenaiHasSavedKey(Boolean(data.has_api_key));
        setOpenaiSettingsUpdatedAt(data.updated_at);
      } catch (err) {
        console.error("Failed to fetch OpenAI settings:", err);
      } finally {
        if (!cancelled) setOpenaiSettingsLoading(false);
      }
    };

    void fetchOpenAISettings();
    return () => {
      cancelled = true;
    };
  }, [cleanModalOpen, cleanMethod, token]);

  useEffect(() => {
    if (!cleanModalOpen) return;
    void fetchOpenAICostEstimate();
  }, [
    cleanModalOpen,
    cleanMethod,
    openaiQuality,
    openaiOutputSize,
    openaiVerificationEnabled,
    openaiMaxAutomaticCorrections,
    token,
  ]);

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
      label: ""
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
    setTexts((current) => current.filter((t) => t.tempId !== selectedTextId));
    setSelectedTextId(null);
  };
  // ─────────────────────────────────────────────────────────────────────

  // Serialise the editable layers (without volatile client-only fields like
  // tempId/id) so a deep-equality check detects any real change.
  const buildEditableSnapshot = () =>
    JSON.stringify({
      icons: icons.map(({ icon_type, x, y, width, height, rotation, label, anchor_x, anchor_y }) => ({
        icon_type, x, y, width, height, rotation, label, anchor_x, anchor_y,
      })),
      shapes: shapes.map(({ shape_type, x, y, width, height, rotation, stroke_width, color }) => ({
        shape_type, x, y, width, height, rotation, stroke_width, color,
      })),
      texts: texts.map(({ text, x, y, font_size, font_family, color, bold, italic, background_color, rotation }) => ({
        text, x, y, font_size, font_family, color, bold, italic, background_color, rotation,
      })),
    });

  const hasUnsavedChanges = () => buildEditableSnapshot() !== savedSnapshot;

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus("Sauvegarde...");
    try {
      // Sync icons to DB
      const res = await fetch(buildApiUrl(`/api/plans/${id}/sync-icons/`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getPlanAuthHeaders(),
        },
        body: JSON.stringify(icons),
      });

      const shapesRes = await fetch(buildApiUrl(`/api/plans/${id}/sync-shapes/`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getPlanAuthHeaders(),
        },
        body: JSON.stringify(
          shapes.map((shape) => ({
            shape_type: shape.shape_type,
            x: shape.x,
            y: shape.y,
            width: shape.width,
            height: shape.height,
            rotation: shape.rotation,
            stroke_width: shape.stroke_width,
            color: shape.color
          }))
        ),
      });

      const textsRes = await fetch(buildApiUrl(`/api/plans/${id}/sync-texts/`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getPlanAuthHeaders(),
        },
        body: JSON.stringify(
          texts.map((t) => ({
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
          }))
        ),
      });

      if (res.ok && shapesRes.ok && textsRes.ok) {
        setSaveStatus("Sauvegardé !");
        setTimeout(() => setSaveStatus(""), 2000);
        // Refresh the baseline so the just-saved state is no longer "unsaved".
        setSavedSnapshot(buildEditableSnapshot());
      } else {
        setSaveStatus("Erreur");
      }
    } catch (err) {
      console.error(err);
      setSaveStatus("Erreur");
    } finally {
      setSaving(false);
    }
  };

  const handleCleanPlan = async () => {
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
        void fetchOpenAIHistory();
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
        void fetchOpenAIHistory();
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

  const handleTestOpenAIKey = async () => {
    if (!openaiApiKey.trim() && !openaiHasSavedKey) {
      setOpenaiKeyStatus("Entrez une clé ou sauvegardez-en une.");
      return;
    }

    setOpenaiKeyStatus(openaiApiKey.trim() ? "Test de la clé saisie..." : "Test de la clé sauvegardée...");
    try {
      const res = await fetch(buildApiUrl(`/api/openai/test-key/`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getPlanAuthHeaders(),
        },
        body: JSON.stringify(openaiApiKey.trim() ? { api_key: openaiApiKey.trim() } : {}),
      });
      const data = await res.json();
      setOpenaiKeyStatus(data.result === "valide" ? "Clé valide." : "Clé invalide.");
    } catch (err) {
      console.error(err);
      setOpenaiKeyStatus("Test impossible.");
    }
  };

  const handleSaveOpenAIKey = async () => {
    if (!openaiApiKey.trim()) {
      setOpenaiKeyStatus("Entrez une clé à sauvegarder.");
      return false;
    }

    setOpenaiKeySaving(true);
    setOpenaiKeyStatus(openaiHasSavedKey ? "Remplacement en cours..." : "Sauvegarde en cours...");
    try {
      const res = await fetch(buildApiUrl(`/api/openai-settings/save/`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getPlanAuthHeaders(),
        },
        body: JSON.stringify({ api_key: openaiApiKey.trim() }),
      });

      if (!res.ok) {
        setOpenaiKeyStatus("Impossible de sauvegarder la clé.");
        return false;
      }

      const data: { has_api_key: boolean; updated_at: string | null } = await res.json();
      setOpenaiApiKey("");
      setOpenaiHasSavedKey(Boolean(data.has_api_key));
      setOpenaiSettingsUpdatedAt(data.updated_at);
      setOpenaiKeyStatus(openaiHasSavedKey ? "Clé remplacée." : "Clé sauvegardée.");
      return true;
    } catch (err) {
      console.error(err);
      setOpenaiKeyStatus("Erreur lors de la sauvegarde.");
      return false;
    } finally {
      setOpenaiKeySaving(false);
    }
  };

  const handleDeleteOpenAIKey = async () => {
    setOpenaiKeyDeleting(true);
    setOpenaiKeyStatus("Suppression en cours...");
    try {
      const res = await fetch(buildApiUrl(`/api/openai-settings/delete/`), {
        method: "DELETE",
        headers: getPlanAuthHeaders(),
      });

      if (!res.ok && res.status !== 204) {
        setOpenaiKeyStatus("Impossible de supprimer la clé.");
        return;
      }

      setOpenaiApiKey("");
      setOpenaiHasSavedKey(false);
      setOpenaiSettingsUpdatedAt(null);
      setOpenaiResult(null);
      setOpenaiKeyStatus("Clé supprimée définitivement.");
    } catch (err) {
      console.error(err);
      setOpenaiKeyStatus("Erreur lors de la suppression.");
    } finally {
      setOpenaiKeyDeleting(false);
    }
  };

  const formatOpenAISettingsDate = () => {
    if (!openaiSettingsUpdatedAt) return "";
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(openaiSettingsUpdatedAt));
  };

  const hasUsableOpenAIKey = openaiHasSavedKey || Boolean(openaiApiKey.trim());

  const openaiStepLabels: Record<Exclude<OpenAICleaningStatus, "pending" | "completed" | "failed">, string> = {
    loading_source: "Préparation du plan",
    analyzing: cleanMethod === "existing_plan_cleanup" ? "Analyse du plan existant" : "Analyse du croquis",
    prompt_ready: "Création des instructions",
    generating: cleanMethod === "existing_plan_cleanup" ? "Nettoyage du plan" : "Génération du plan",
    saving_result: "Enregistrement du résultat",
  };

  const openaiStepOrder: Array<Exclude<OpenAICleaningStatus, "pending" | "completed" | "failed">> = [
    "loading_source",
    "analyzing",
    "prompt_ready",
    "generating",
    "saving_result",
  ];

  const getOpenAIStepState = (step: Exclude<OpenAICleaningStatus, "pending" | "completed" | "failed">) => {
    if (openaiCleaningStep === "completed") return "done";
    if (openaiCleaningStep === "failed") return "pending";
    const currentIndex = openaiStepOrder.indexOf(openaiCleaningStep as Exclude<OpenAICleaningStatus, "pending" | "completed" | "failed">);
    const stepIndex = openaiStepOrder.indexOf(step);
    if (currentIndex === -1) return "pending";
    if (stepIndex < currentIndex) return "done";
    if (stepIndex === currentIndex) return "current";
    return "pending";
  };

  const formatOpenAIBackendError = (data: Partial<OpenAICleanJobStatus>) => {
    const errorCode = data.error_code ? `${data.error_code} - ` : "";
    const message = `${errorCode}${data.error || "Erreur pendant le nettoyage OpenAI."}`;
    // The diagnostic names the exact check that failed. Without it an intermittent
    // PROMPT_INVALID is impossible to tell apart from any other.
    return data.diagnostic ? `${message}\n\nDétail technique : ${data.diagnostic}` : message;
  };

  const formatEstimatedCost = (estimate: OpenAICostEstimate) => {
    const currencySuffix = estimate.currency === "USD" ? "US" : estimate.currency;
    return `${estimate.estimated_min.toFixed(3)} $ – ${estimate.estimated_max.toFixed(3)} $ ${currencySuffix}`;
  };

  const getCostPayload = (method: CleanMethod = cleanMethod) => ({
    cleaning_mode: method,
    quality: openaiQuality,
    output_size: openaiOutputSize,
    verification_enabled: openaiVerificationEnabled,
    max_automatic_corrections: openaiMaxAutomaticCorrections,
  });

  const fetchOpenAICostEstimate = async () => {
    if (!id) return;
    if (cleanMethod === "local") {
      setOpenaiCostEstimate({
        currency: "USD",
        estimated_min: 0,
        estimated_max: 0,
        is_estimate: true,
        details: {
          analysis: false,
          generation_count_max: 0,
          verification: false,
          quality: openaiQuality,
          output_size: openaiOutputSize,
          cleaning_mode: "local",
          max_automatic_corrections: 0,
        },
      });
      return;
    }

    setOpenaiCostLoading(true);
    try {
      const res = await fetch(buildApiUrl(`/api/plans/${id}/openai-clean-cost-estimate/`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getPlanAuthHeaders(),
        },
        body: JSON.stringify(getCostPayload()),
      });
      if (!res.ok) return;
      const data: OpenAICostEstimate = await res.json();
      setOpenaiCostEstimate(data);
    } catch (err) {
      console.error("Failed to fetch OpenAI cost estimate:", err);
    } finally {
      setOpenaiCostLoading(false);
    }
  };

  const formatHistoryDate = (value: string) => {
    if (!value) return "Date non disponible";
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  };

  const fetchOpenAIHistory = async () => {
    if (!id) return;
    setOpenaiHistoryLoading(true);
    try {
      const res = await fetch(buildApiUrl(`/api/plans/${id}/openai-clean-history/`), {
        headers: getPlanAuthHeaders(),
        cache: "no-store",
      });
      if (!res.ok) return;
      const data: OpenAICleanHistoryItem[] = await res.json();
      setOpenaiHistory(data);
    } catch (err) {
      console.error("Failed to fetch OpenAI cleaning history:", err);
    } finally {
      setOpenaiHistoryLoading(false);
    }
  };

  const saveOpenAIKeyForCleaning = async () => {
    if (!openaiApiKey.trim()) return true;
    const saved = await handleSaveOpenAIKey();
    if (!saved) setOpenaiError("Impossible de sauvegarder la clé API.");
    return saved;
  };

  const clearOpenAIKeyInput = () => {
    setOpenaiApiKey("");
    setOpenaiKeyStatus("");
  };

  const handleOpenAIClean = async () => {
    setOpenaiCleaning(true);
    setOpenaiError("");
    setOpenaiResult(null);
    setOpenaiCleaningStep("pending");

    try {
      const keySaved = await saveOpenAIKeyForCleaning();
      if (!keySaved) return;

      const openAIPayload = cleanMethod === "existing_plan_cleanup"
        ? {
            cleaning_mode: "existing_plan_cleanup",
            quality: openaiQuality,
            output_size: openaiOutputSize,
            verification_enabled: openaiVerificationEnabled,
            max_automatic_corrections: openaiMaxAutomaticCorrections,
            supprimer_pictogrammes: existingRemovePictograms,
            supprimer_texte: existingRemoveText,
            supprimer_dimensions: existingRemoveDimensions,
            supprimer_annotations: existingRemoveAnnotations,
            supprimer_cartouche: existingRemoveTitleBlock,
            supprimer_hachures: existingRemoveHatching,
            supprimer_mobilier: existingRemoveFurniture,
            conserver_portes: existingPreserveDoors,
            conserver_escaliers: existingPreserveStairs,
            conserver_ouvertures: existingPreserveOpenings,
            simplifier_rendu: existingSimplifyRendering,
            niveau_nettoyage: existingCleanupLevel,
            instructions_supplementaires: openaiAdditionalInstructions,
          }
        : {
            cleaning_mode: "sketch_to_plan",
            quality: openaiQuality,
            output_size: openaiOutputSize,
            verification_enabled: openaiVerificationEnabled,
            max_automatic_corrections: openaiMaxAutomaticCorrections,
            conserver_machines: openaiKeepMachines,
            supprimer_texte: openaiRemoveText,
            supprimer_dimensions: openaiRemoveDimensions,
            corriger_perspective: openaiCorrectPerspective,
            conserver_ouvertures: openaiKeepDoorsOpenings,
            epaisseur_murs: openaiWallThickness,
            instructions_supplementaires: openaiAdditionalInstructions,
          };

      const res = await fetch(buildApiUrl(`/api/plans/${id}/openai-clean/`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getPlanAuthHeaders(),
        },
        body: JSON.stringify(openAIPayload),
      });

      const data: OpenAICleanJobStatus = await res.json();
      if (!res.ok) {
        setOpenaiError(formatOpenAIBackendError(data));
        setOpenaiCleaningStep("failed");
        return;
      }

      setOpenaiCleaningStep(data.status);
      let latestStatus = data;
      while (latestStatus.status !== "completed" && latestStatus.status !== "failed") {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const statusRes = await fetch(buildApiUrl(`/api/plans/${id}/openai-clean-status/?job_id=${data.job_id}`), {
          headers: getPlanAuthHeaders(),
          cache: "no-store",
        });
        latestStatus = await statusRes.json();
        setOpenaiCleaningStep(latestStatus.status);
        if (!statusRes.ok) {
          setOpenaiError(formatOpenAIBackendError(latestStatus));
          setOpenaiCleaningStep("failed");
          return;
        }
      }

      if (latestStatus.status === "failed") {
        setOpenaiError(formatOpenAIBackendError(latestStatus));
        return;
      }

      setOpenaiResult(latestStatus as OpenAICleanResult);
      void fetchOpenAIHistory();
    } catch (err) {
      console.error(err);
      setOpenaiError("Erreur lors de la communication avec le serveur.");
      setOpenaiCleaningStep("failed");
    } finally {
      setOpenaiCleaning(false);
    }
  };

  const handleUseOpenAIPlan = async () => {
    if (!openaiResult) return;

    setOpenaiApplying(true);
    setOpenaiError("");
    try {
      const res = await fetch(buildApiUrl(`/api/plans/${id}/use-openai-cleaned/`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getPlanAuthHeaders(),
        },
        body: JSON.stringify({ image_data: openaiResult.after_image }),
      });

      const data = await res.json();
      if (!res.ok) {
        setOpenaiError(data.error || "Impossible d'utiliser ce plan.");
        return;
      }

      setPlan(data);
      setOpenaiResult(null);
      setCleanModalOpen(false);
      void fetchOpenAIHistory();
    } catch (err) {
      console.error(err);
      setOpenaiError("Erreur lors de la communication avec le serveur.");
    } finally {
      setOpenaiApplying(false);
    }
  };

  const handleUseOpenAIHistory = async (historyItem: OpenAICleanHistoryItem) => {
    setOpenaiHistoryApplyingId(historyItem.id);
    setOpenaiError("");
    try {
      const res = await fetch(buildApiUrl(`/api/plans/${id}/use-openai-clean-history/`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getPlanAuthHeaders(),
        },
        body: JSON.stringify({ history_id: historyItem.id }),
      });

      const data = await res.json();
      if (!res.ok) {
        setOpenaiError(data.error || "Impossible d'utiliser cet historique.");
        return;
      }

      setPlan(data);
      setOpenaiResult(null);
      setCleanModalOpen(false);
    } catch (err) {
      console.error(err);
      setOpenaiError("Erreur lors de la communication avec le serveur.");
    } finally {
      setOpenaiHistoryApplyingId(null);
    }
  };

  const selectedIcon = icons.find((i) => i.tempId === selectedIconId);
  const selectedText = texts.find((t) => t.tempId === selectedTextId);

  // The "Vous êtes ici" marker defines the reading direction: the plan is turned
  // so that what the reader faces points up. Rotating the marker in the editor is
  // therefore how you orient the exported plan.
  const youAreHereIcon = icons.find((icon) => isYouAreHereIcon(icon.icon_type, iconDefinitions));
  const planReadingAngle = youAreHereIcon ? youAreHereIcon.rotation : null;

  const previousReadingAngleRef = useRef<number | null>(null);
  useEffect(() => {
    const previous = previousReadingAngleRef.current;
    previousReadingAngleRef.current = planReadingAngle;

    if (planReadingAngle !== null) {
      setExportPlanRotation(planReadingAngle);
      return;
    }

    // The marker drove the orientation and has just been deleted: drop the angle
    // with it, otherwise the sheet stays turned with nothing explaining why.
    if (previous !== null) setExportPlanRotation(0);
  }, [planReadingAngle]);
  const usedIconTypes = Array.from(new Set(icons.map((icon) => icon.icon_type)));

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
      label: source.label ?? ""
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
      y: selectedIcon.y + 16
    };
    setIcons((currentIcons) => [...currentIcons, duplicate]);
    setSelectedIconId(duplicate.tempId);
  };

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

  const openExportTemplate = (format: "png" | "pdf") => {
    setExportFormat(format);
    setExportSiteName((current) => current || plan?.building_name || "");
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

  const loadImage = (src: string) => {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
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

  const getStageDataUrl = async (pixelRatio: number, silent = false) => {
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
          return stage.toDataURL({
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            pixelRatio
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

  /**
   * Draws a logo inside the header band. A white rounded plate keeps coloured or
   * dark logos legible over any theme gradient. When no explicit X bounds are
   * given, the logo hugs the sheet's left/right margin.
   *
   * The logo is fit by height first, then clamped by width so wide wordmarks do
   * not overflow their plate.
   */
  const drawHeaderLogo = (
    context: CanvasRenderingContext2D,
    image: HTMLImageElement | null,
    side: "left" | "right",
    headerHeight: number,
    explicitLeftX?: number,
    explicitRightX?: number
  ) => {
    if (!image || !image.width || !image.height) return;

    const platePad = 6;
    const plateH = headerHeight - 22;
    // A logo plate is at most ~120px wide so the title stays the focal point.
    const maxPlateW = 120;
    const aspect = image.width / image.height;

    let drawH = plateH - platePad * 2;
    let drawW = drawH * aspect;
    if (drawW > maxPlateW - platePad * 2) {
      drawW = maxPlateW - platePad * 2;
      drawH = drawW / aspect;
    }

    const plateW = drawW + platePad * 2;
    const leftX = explicitLeftX ?? (side === "left" ? EXPORT_MARGIN : EXPORT_CANVAS_WIDTH - EXPORT_MARGIN - plateW);
    const rightX = explicitRightX ?? (side === "left" ? leftX + plateW : EXPORT_CANVAS_WIDTH - EXPORT_MARGIN);
    const plateX = side === "left" ? leftX : rightX - plateW;
    const plateY = (headerHeight - plateH) / 2;

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

    const canvas = document.createElement("canvas");
    canvas.width = EXPORT_CANVAS_WIDTH * outputScale;
    canvas.height = EXPORT_CANVAS_HEIGHT * outputScale;
    const context = canvas.getContext("2d");
    if (!context) return null;

    context.scale(outputScale, outputScale);
    context.textBaseline = "alphabetic";
    const palette = getExportPalette();

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
      drawHeaderLogo(context, clientLogoImage, "left", headerH, mainX + levelW + 12, mainX + levelW + 96);
      drawHeaderLogo(context, studioLogoImage, "right", headerH, EXPORT_CANVAS_WIDTH - 108, EXPORT_CANVAS_WIDTH - 12);

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
    drawHeaderLogo(context, clientLogoImage, "left", EXPORT_HEADER_H);
    drawHeaderLogo(context, studioLogoImage, "right", EXPORT_HEADER_H);

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
    const planW = Math.max(0, rightX - EXPORT_GUTTER - planX);
    const planY = contentTop;
    const planH = contentBottom - contentTop;

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
    tracePath(context, planX, planY, planW, planH, EXPORT_CARD_RADIUS);
    context.clip();
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
    const paper = EXPORT_PAPER_SIZES[exportPaperFormat];
    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: exportPaperFormat
    });
    pdf.addImage(dataUrl, "PNG", 0, 0, paper.widthMm, paper.heightMm);
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
    exportPlanRotation,
    exportPlanOffsetX,
    exportPlanOffsetY,
    exportClientLogo,
    exportStudioLogo,
    exportShowSafety,
    exportShowIntervention,
    exportShowLegend,
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

  const handleExportTemplate = async () => {
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

  // Export functions
  const getStageInstance = () => {
    const stageContainer = document.querySelector(".konvajs-content");
    if (!stageContainer) return null;
    // @ts-ignore
    return window.Konva.stages[0];
  };

  const handleExportPng = async () => {
    const stage = getStageInstance();
    if (!stage) return;
    
    // Temporarily deselect transformer to get a clean screenshot
    setSelectedIconId(null);
    await new Promise((resolve) => setTimeout(resolve, 50));

    let dataUrl = "";
    try {
      dataUrl = stage.toDataURL({ pixelRatio: EXPORT_STAGE_PIXEL_RATIO });
    } catch (err) {
      console.error("PNG export failed:", err);
      alert("Impossible d'exporter le PNG. Rechargez la page puis réessayez pour recharger le fond de plan avec les permissions d'export.");
      return;
    }

    const link = document.createElement("a");
    link.download = `${plan?.title || "plan"}_evacuation.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportPdf = async () => {
    const stage = getStageInstance();
    if (!stage) return;

    // Temporarily deselect transformer to get a clean screenshot
    setSelectedIconId(null);
    await new Promise((resolve) => setTimeout(resolve, 50));

    let dataUrl = "";
    try {
      dataUrl = stage.toDataURL({ pixelRatio: EXPORT_STAGE_PIXEL_RATIO });
    } catch (err) {
      console.error("PDF export failed:", err);
      alert("Impossible d'exporter le PDF. Rechargez la page puis réessayez pour recharger le fond de plan avec les permissions d'export.");
      return;
    }
    
    // Get actual stage sizing
    const width = stage.width();
    const height = stage.height();

    // Determine layout: landscape vs portrait
    const orientation = width > height ? "l" : "p";
    const pdf = new jsPDF({
      orientation: orientation,
      unit: "px",
      format: [width, height]
    });

    pdf.addImage(dataUrl, "PNG", 0, 0, width, height);
    pdf.save(`${plan?.title || "plan"}_evacuation.pdf`);
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
      {cleanMethod === "local" ? (
        <>
          <div className="mt-1 text-xl font-bold text-safety-green">Gratuit</div>
          <p className="mt-1 text-xs text-slate-500">Aucun appel à une API externe.</p>
        </>
      ) : openaiCostLoading && !openaiCostEstimate ? (
        <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Calcul de l'estimation...
        </div>
      ) : openaiCostEstimate ? (
        <>
          <div className="mt-1 text-xl font-bold text-slate-950">{formatEstimatedCost(openaiCostEstimate)}</div>
          <p className="mt-1 text-xs text-slate-500">
            {openaiCostEstimate.details.quality === "low" ? "Qualité basse" : openaiCostEstimate.details.quality === "high" ? "Haute qualité" : "Qualité moyenne"} · Analyse + {openaiCostEstimate.details.generation_count_max} génération{openaiCostEstimate.details.generation_count_max > 1 ? "s" : ""}
            {openaiCostEstimate.details.verification ? " · Vérification activée" : " · Aucune vérification automatique"}
          </p>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Estimation indicative basée sur les paramètres sélectionnés. Le montant réel facturé par OpenAI peut varier selon la taille de l'image, le modèle, les tokens utilisés et les éventuelles nouvelles tentatives.
          </p>
        </>
      ) : (
        <p className="mt-1 text-xs text-slate-500">Estimation indisponible pour le moment.</p>
      )}
    </div>
  );

  const cleaningHistoryPanel = (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-950">Historique de nettoyage</h3>
          <p className="mt-1 text-xs text-slate-500">Choisissez une version nettoyée pour la remettre comme fond de plan.</p>
        </div>
        <button
          type="button"
          onClick={() => void fetchOpenAIHistory()}
          disabled={openaiHistoryLoading || openaiCleaning || openaiApplying}
          className="inline-flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-safety-green transition-colors hover:bg-green-100 disabled:opacity-50"
        >
          {openaiHistoryLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Actualiser
        </button>
      </div>

      {openaiHistoryLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-semibold text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Chargement de l'historique...
        </div>
      ) : openaiHistory.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-medium text-slate-500">
          Aucun plan nettoyé enregistré pour ce plan.
        </div>
      ) : (
        <div className="grid max-h-96 gap-3 overflow-y-auto pr-1 md:grid-cols-2">
          {openaiHistory.map((item) => (
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
                  onClick={() => void handleUseOpenAIHistory(item)}
                  disabled={openaiHistoryApplyingId === item.id || openaiCleaning || openaiApplying}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-safety-green px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-green-600 disabled:opacity-50"
                >
                  {openaiHistoryApplyingId === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
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
    await handleSave();
    router.push("/dashboard");
  };

  return (
    <ProtectedRoute>
      {/* Fixed application frame. The geometry is inline rather than utility classes
          so it cannot depend on a stylesheet being regenerated: the viewport must
          never scroll, only the panels do. */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          height: "100vh",
          width: interfaceWidth ? `${interfaceWidth}px` : "100vw",
          maxWidth: "100vw",
          overflow: "hidden"
        }}
        className="flex flex-col bg-[#1b1b1d] text-neutral-200"
      >
        {/* ───────────────── Top bar ───────────────── */}
        <header className="flex h-11 shrink-0 items-center justify-between gap-4 overflow-hidden border-b border-black/50 bg-[#2d2d30] px-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (hasUnsavedChanges()) setPendingNav(true);
                else router.push("/dashboard");
              }}
              title="Retour au tableau de bord"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="h-5 w-px shrink-0 bg-white/10" />
            <button
              type="button"
              onClick={() => setLeftDockOpen((open) => !open)}
              title={leftDockOpen ? "Masquer les équipements" : "Afficher les équipements"}
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

          <div className="flex shrink-0 items-center gap-1.5">
            <ExportButtons onOpenExport={openExportTemplate} />

            <span className="h-5 w-px bg-white/10" />

            <button
              onClick={() => setCleanModalOpen(true)}
              disabled={cleaning || openaiCleaning || openaiApplying}
              className="flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              {cleaning || openaiCleaning || openaiApplying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              <span>Nettoyer</span>
            </button>

            {plan?.use_cleaned_background && (
              <button
                onClick={() => setRevertConfirmOpen(true)}
                disabled={cleaning}
                title="Revenir au plan original"
                className="flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                {cleaning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                <span>Original</span>
              </button>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="flex cursor-pointer items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              <span>{saveStatus || "Sauvegarder"}</span>
            </button>
          </div>
        </header>

        {/* ───────────────── Workspace: left rail | canvas | right rail ───────────────── */}
        <div className="flex min-h-0 flex-1" style={{ minWidth: 0 }}>
          {/* Left dock — fixed width, never scrolls the page */}
          <aside
            style={{ width: leftDockOpen ? 208 : 0, minWidth: 0, flex: "0 0 auto" }}
            className="overflow-hidden border-r border-black/50"
          >
            <IconToolbar
              onAddIcon={handleAddIcon}
              activeIconType={placementIconType}
              onCancelPlacement={() => setPlacementIconType(null)}
              iconDefinitions={availableIconDefinitions}
              onAddText={handleAddText}
              placementTextActive={placementText}
              onCancelTextPlacement={() => setPlacementText(false)}
            />
          </aside>

          {/* Canvas — the only fluid region. Its width can be reduced from the
              status bar; the surplus stays as inert backdrop on either side. */}
          <div
            className="relative"
            style={
              canvasColumnWidth
                ? { width: `${canvasColumnWidth}px`, flex: "0 0 auto", minWidth: 0, overflow: "hidden" }
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
                  onSelectIcon={(iconId) => {
                    setSelectedIconId(iconId);
                    if (iconId) {
                      setSelectedShapeId(null);
                      setSelectedTextId(null);
                    }
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
                  undoEraseSignal={undoEraseSignal}
                  resetEraseSignal={resetEraseSignal}
                  onEraseStrokesChange={setEraseStrokeCount}
                  shapes={shapes}
                  onShapesChange={setShapes}
                  selectedShapeId={selectedShapeId}
                  onSelectShape={(shapeId) => {
                    setSelectedShapeId(shapeId);
                    if (shapeId) {
                      setSelectedIconId(null);
                      setSelectedTextId(null);
                    }
                  }}
                  shapeTool={shapeTool}
                  shapeStrokeWidth={shapeStrokeWidth}
                  planRotation={exportPlanRotation}
                  texts={texts}
                  onTextsChange={handleTextsChange}
                  selectedTextId={selectedTextId}
                  onSelectText={(textId) => {
                    setSelectedTextId(textId);
                    if (textId) {
                      setSelectedIconId(null);
                      setSelectedShapeId(null);
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
            style={{ width: rightDockOpen ? 224 : 0, minWidth: 0, flex: "0 0 auto" }}
            className="flex flex-col overflow-hidden border-l border-black/50 bg-[#252527]"
          >
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-black/40 px-3">
              <Settings className="h-3.5 w-3.5 text-neutral-500" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">
                Propriétés
              </span>
            </div>

            {selectedIcon ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
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
                        exporté est tourné d&apos;autant, et les pictogrammes d&apos;équipement sont
                        automatiquement redressés — seules les flèches directionnelles suivent.
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
                        <span className="text-[10px] tabular-nums text-neutral-400">
                          {Math.round(selectedIcon.rotation)}&deg;
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="360"
                        value={Math.round(selectedIcon.rotation)}
                        onChange={(e) => handleUpdateSelectedIcon("rotation", Number(e.target.value))}
                        className="h-1 w-full cursor-pointer accent-emerald-500"
                      />
                    </div>
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
              <div className="min-h-0 flex-1 overflow-y-auto">
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
                      <span className="text-[10px] tabular-nums text-neutral-400">
                        {Math.round(selectedText.rotation)}&deg;
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={360}
                      value={Math.round(selectedText.rotation)}
                      onChange={(e) => handleUpdateSelectedText("rotation", Number(e.target.value))}
                      className="mt-1.5 h-1 w-full cursor-pointer accent-emerald-500"
                    />
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
        <footer className="flex h-8 shrink-0 items-center justify-between gap-4 overflow-hidden border-t border-black/50 bg-[#2d2d30] px-2">
          <div className="flex min-w-0 shrink items-center gap-3">
            <ZoomControls
              zoom={zoom}
              onZoomChange={setZoom}
              mode={mode}
              onModeChange={setMode}
              onFitToView={() => setFitSignal((signal) => signal + 1)}
            />

            <span className="h-4 w-px bg-white/10" />

            {/* Shape tools */}
            <div className="flex items-center gap-0.5 rounded bg-black/30 p-0.5">
              {([
                { kind: "line" as ShapeKind, Icon: Minus, label: "Ligne" },
                { kind: "rect" as ShapeKind, Icon: Square, label: "Carré" },
                { kind: "circle" as ShapeKind, Icon: Circle, label: "Cercle" }
              ]).map(({ kind, Icon, label }) => (
                <button
                  key={kind}
                  onClick={() => {
                    setShapeTool((current) => (current === kind ? null : kind));
                    setMode("select");
                    setPlacementIconType(null);
                  }}
                  title={`${label} — glissez sur le plan pour tracer`}
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

            {mode === "erase" && (
              <>
                <span className="h-4 w-px bg-white/10" />
                <div className="flex items-center gap-2">
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
            <div className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ${cleanMethod !== "local" ? "max-w-5xl" : "max-w-3xl"}`}>
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">Nettoyer le plan</h2>
                  <p className="text-xs text-slate-500">Choisissez une méthode de nettoyage pour préparer le fond du plan.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCleanModalOpen(false)}
                  disabled={cleaning || openaiCleaning || openaiApplying}
                  className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-green-50 hover:text-safety-green disabled:opacity-50"
                  title="Fermer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
                <div className="grid gap-3 lg:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setCleanMethod("local")}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      cleanMethod === "local"
                        ? "border-safety-green bg-green-50 text-slate-950 shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-green-200 hover:bg-green-50/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                        cleanMethod === "local" ? "border-safety-green" : "border-slate-300"
                      }`}>
                        {cleanMethod === "local" ? <span className="h-2.5 w-2.5 rounded-full bg-safety-green" /> : null}
                      </span>
                      <span className="text-sm font-bold">Nettoyage local</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">Utilise le système OCR/OpenCV existant. Aucune donnée n’est envoyée à un service externe.</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCleanMethod("sketch_to_plan")}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      cleanMethod === "sketch_to_plan"
                        ? "border-safety-green bg-green-50 text-slate-950 shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-green-200 hover:bg-green-50/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                        cleanMethod === "sketch_to_plan" ? "border-safety-green" : "border-slate-300"
                      }`}>
                        {cleanMethod === "sketch_to_plan" ? <span className="h-2.5 w-2.5 rounded-full bg-safety-green" /> : null}
                      </span>
                      <span className="text-sm font-bold">Croquis → plan propre avec OpenAI</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">Analyse visuelle du plan, création automatique d’instructions adaptées, puis génération d’un plan propre.</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCleanMethod("existing_plan_cleanup")}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      cleanMethod === "existing_plan_cleanup"
                        ? "border-safety-green bg-green-50 text-slate-950 shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-green-200 hover:bg-green-50/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                        cleanMethod === "existing_plan_cleanup" ? "border-safety-green" : "border-slate-300"
                      }`}>
                        {cleanMethod === "existing_plan_cleanup" ? <span className="h-2.5 w-2.5 rounded-full bg-safety-green" /> : null}
                      </span>
                      <span className="text-sm font-bold">Nettoyer un plan existant</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">Supprime les dimensions, annotations et détails inutiles d’un plan déjà existant afin de le rendre plus adapté comme base de plan d’évacuation.</p>
                  </button>
                </div>

                {costEstimatePanel}

                {cleanMethod === "local" ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <h3 className="text-sm font-bold text-slate-950">Options locales</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">Ces boutons conservent le comportement actuel de nettoyage local.</p>
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
                ) : (
                  <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">État de la clé API</div>
                          <div className="mt-1 text-sm font-bold text-slate-950">
                            {openaiSettingsLoading ? "Vérification..." : openaiHasSavedKey ? "Configurée" : "Non configurée"}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {openaiHasSavedKey
                              ? `Dernière modification : ${formatOpenAISettingsDate() || "date non disponible"}.`
                              : "Configurez une clé avant de lancer le nettoyage OpenAI."}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setOpenaiKeyConfigOpen((current) => !current)}
                          disabled={openaiCleaning || openaiApplying}
                          className="inline-flex items-center justify-center rounded-xl border border-green-200 bg-green-50 px-4 py-2 text-xs font-semibold text-safety-green transition-colors hover:bg-green-100 disabled:opacity-50"
                        >
                          Configurer la clé API
                        </button>
                      </div>
                    </div>

                    {openaiKeyConfigOpen ? (
                      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:grid-cols-[1fr_auto_auto_auto]">
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                            {openaiHasSavedKey ? "Nouvelle clé API" : "Clé API"}
                          </label>
                          <input
                            type="password"
                            value={openaiApiKey}
                            onChange={(event) => {
                              setOpenaiApiKey(event.target.value);
                              setOpenaiKeyStatus("");
                            }}
                            placeholder={openaiHasSavedKey ? "Laisser vide pour utiliser la clé sauvegardée" : "sk-..."}
                            disabled={openaiCleaning || openaiApplying || openaiKeySaving || openaiKeyDeleting}
                            className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none focus:ring-2 focus:ring-safety-green/20"
                          />
                          {openaiKeyStatus ? (
                            <p className="mt-1.5 text-xs font-medium text-slate-500">{openaiKeyStatus}</p>
                          ) : null}
                        </div>
                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={handleTestOpenAIKey}
                            disabled={openaiCleaning || openaiApplying || openaiKeySaving || openaiKeyDeleting || (!openaiApiKey.trim() && !openaiHasSavedKey)}
                            className="inline-flex h-10 items-center justify-center rounded-xl border border-green-200 bg-green-50 px-4 text-xs font-semibold text-safety-green transition-colors hover:bg-green-100 disabled:opacity-50"
                          >
                            Tester
                          </button>
                        </div>
                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => void handleSaveOpenAIKey()}
                            disabled={openaiCleaning || openaiApplying || openaiKeySaving || openaiKeyDeleting || !openaiApiKey.trim()}
                            className="inline-flex h-10 items-center justify-center rounded-xl bg-safety-green px-4 text-xs font-semibold text-white transition-colors hover:bg-green-600 disabled:opacity-50"
                          >
                            {openaiKeySaving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                            {openaiHasSavedKey ? "Remplacer" : "Sauvegarder"}
                          </button>
                        </div>
                        <div className="flex items-end gap-2">
                          <button
                            type="button"
                            onClick={clearOpenAIKeyInput}
                            disabled={openaiCleaning || openaiApplying || openaiKeySaving || openaiKeyDeleting || !openaiApiKey}
                            className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                          >
                            Effacer
                          </button>
                          {openaiHasSavedKey ? (
                            <button
                              type="button"
                              onClick={handleDeleteOpenAIKey}
                              disabled={openaiCleaning || openaiApplying || openaiKeyDeleting || openaiKeySaving}
                              className="inline-flex h-10 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-4 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50"
                            >
                              {openaiKeyDeleting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                              Supprimer
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Qualité
                        </label>
                        <div className="grid gap-2">
                          {[
                            {
                              value: "low",
                              label: "Légère",
                              description: "Traitement économique pour les tests rapides.",
                            },
                            {
                              value: "medium",
                              label: "Moyenne",
                              description: "Bon équilibre entre qualité, délai et coût.",
                            },
                            {
                              value: "high",
                              label: "Haute qualité",
                              description: "Meilleur rendu pour le résultat final.",
                            },
                          ].map((option) => (
                            <label
                              key={option.value}
                              className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                                openaiQuality === option.value
                                  ? "border-green-200 bg-green-50 text-slate-950"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              <input
                                type="radio"
                                name="openai-quality"
                                value={option.value}
                                checked={openaiQuality === option.value}
                                onChange={() => setOpenaiQuality(option.value as "low" | "medium" | "high")}
                                disabled={openaiCleaning || openaiApplying}
                                className="mt-1 h-4 w-4 accent-safety-green"
                              />
                              <span>
                                <span className="block text-sm font-semibold">{option.label}</span>
                                <span className="block text-xs leading-5 text-slate-500">{option.description}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Instructions supplémentaires
                        </label>
                        <textarea
                          value={openaiAdditionalInstructions}
                          onChange={(event) => setOpenaiAdditionalInstructions(event.target.value)}
                          disabled={openaiCleaning || openaiApplying}
                          rows={3}
                          placeholder="Facultatif"
                          className="block w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none focus:ring-2 focus:ring-safety-green/20"
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-3">
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Taille finale
                        </label>
                        <select
                          value={openaiOutputSize}
                          onChange={(event) => setOpenaiOutputSize(event.target.value)}
                          disabled={openaiCleaning || openaiApplying}
                          className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 focus:border-safety-green focus:outline-none"
                        >
                          <option value="auto">Auto</option>
                          <option value="1024x1024">1024 × 1024</option>
                          <option value="1536x1024">1536 × 1024</option>
                          <option value="1024x1536">1024 × 1536</option>
                        </select>
                      </div>
                      <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700">
                        <input
                          type="checkbox"
                          checked={openaiVerificationEnabled}
                          onChange={(event) => setOpenaiVerificationEnabled(event.target.checked)}
                          disabled={openaiCleaning || openaiApplying}
                          className="h-4 w-4 rounded border-slate-300 accent-safety-green"
                        />
                        <span>Vérification automatique</span>
                      </label>
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Corrections auto max
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="5"
                          value={openaiMaxAutomaticCorrections}
                          onChange={(event) => setOpenaiMaxAutomaticCorrections(Math.max(0, Math.min(5, Number(event.target.value))))}
                          disabled={openaiCleaning || openaiApplying}
                          className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 focus:border-safety-green focus:outline-none"
                        />
                      </div>
                    </div>

                    {cleanMethod === "sketch_to_plan" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700">
                          <input
                            type="checkbox"
                            checked={openaiKeepMachines}
                            onChange={(event) => setOpenaiKeepMachines(event.target.checked)}
                            disabled={openaiCleaning || openaiApplying}
                            className="h-4 w-4 rounded border-slate-300 accent-safety-green"
                          />
                          <span>Conserver les machines et obstacles</span>
                        </label>
                        <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700">
                          <input
                            type="checkbox"
                            checked={openaiRemoveText}
                            onChange={(event) => setOpenaiRemoveText(event.target.checked)}
                            disabled={openaiCleaning || openaiApplying}
                            className="h-4 w-4 rounded border-slate-300 accent-safety-green"
                          />
                          <span>Supprimer les textes</span>
                        </label>
                        <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700">
                          <input
                            type="checkbox"
                            checked={openaiRemoveDimensions}
                            onChange={(event) => setOpenaiRemoveDimensions(event.target.checked)}
                            disabled={openaiCleaning || openaiApplying}
                            className="h-4 w-4 rounded border-slate-300 accent-safety-green"
                          />
                          <span>Supprimer les dimensions</span>
                        </label>
                        <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700">
                          <input
                            type="checkbox"
                            checked={openaiCorrectPerspective}
                            onChange={(event) => setOpenaiCorrectPerspective(event.target.checked)}
                            disabled={openaiCleaning || openaiApplying}
                            className="h-4 w-4 rounded border-slate-300 accent-safety-green"
                          />
                          <span>Corriger la perspective</span>
                        </label>
                        <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700 sm:col-span-2">
                          <input
                            type="checkbox"
                            checked={openaiKeepDoorsOpenings}
                            onChange={(event) => setOpenaiKeepDoorsOpenings(event.target.checked)}
                            disabled={openaiCleaning || openaiApplying}
                            className="h-4 w-4 rounded border-slate-300 accent-safety-green"
                          />
                          <span>Conserver les portes et ouvertures</span>
                        </label>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                            Niveau de nettoyage
                          </label>
                          <div className="grid gap-2 sm:grid-cols-3">
                            {[
                              { value: "leger", label: "Léger" },
                              { value: "moyen", label: "Moyen" },
                              { value: "fort", label: "Fort" },
                            ].map((option) => (
                              <label
                                key={option.value}
                                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${
                                  existingCleanupLevel === option.value
                                    ? "border-green-200 bg-green-50 text-slate-950"
                                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                }`}
                              >
                                <input
                                  type="radio"
                                  name="existing-cleanup-level"
                                  value={option.value}
                                  checked={existingCleanupLevel === option.value}
                                  onChange={() => setExistingCleanupLevel(option.value as "leger" | "moyen" | "fort")}
                                  disabled={openaiCleaning || openaiApplying}
                                  className="h-4 w-4 accent-safety-green"
                                />
                                <span>{option.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          {[
                            ["Supprimer les pictogrammes existants", existingRemovePictograms, setExistingRemovePictograms],
                            ["Supprimer tous les textes", existingRemoveText, setExistingRemoveText],
                            ["Supprimer les dimensions", existingRemoveDimensions, setExistingRemoveDimensions],
                            ["Supprimer les annotations", existingRemoveAnnotations, setExistingRemoveAnnotations],
                            ["Supprimer le cartouche", existingRemoveTitleBlock, setExistingRemoveTitleBlock],
                            ["Supprimer les hachures", existingRemoveHatching, setExistingRemoveHatching],
                            ["Supprimer le mobilier", existingRemoveFurniture, setExistingRemoveFurniture],
                            ["Conserver les portes", existingPreserveDoors, setExistingPreserveDoors],
                            ["Conserver les escaliers", existingPreserveStairs, setExistingPreserveStairs],
                            ["Conserver les ouvertures", existingPreserveOpenings, setExistingPreserveOpenings],
                            ["Simplifier le rendu", existingSimplifyRendering, setExistingSimplifyRendering],
                          ].map(([label, checked, setter]) => (
                            <label key={label as string} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700">
                              <input
                                type="checkbox"
                                checked={checked as boolean}
                                onChange={(event) => (setter as React.Dispatch<React.SetStateAction<boolean>>)(event.target.checked)}
                                disabled={openaiCleaning || openaiApplying}
                                className="h-4 w-4 rounded border-slate-300 accent-safety-green"
                              />
                              <span>{label as string}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">État du traitement</div>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                        {openaiStepOrder.map((step) => {
                          const stepState = getOpenAIStepState(step);
                          return (
                            <div
                              key={step}
                              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
                                stepState === "done"
                                  ? "border-green-200 bg-green-50 text-safety-green"
                                  : stepState === "current"
                                    ? "border-blue-200 bg-blue-50 text-blue-700"
                                    : "border-slate-200 bg-white text-slate-500"
                              }`}
                            >
                              <span>{stepState === "done" ? "✓" : stepState === "current" ? "…" : "○"}</span>
                              <span>{openaiStepLabels[step]}</span>
                            </div>
                          );
                        })}
                      </div>
                      {openaiCleaningStep === "completed" ? (
                        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-safety-green">
                          ✓ Terminé
                        </div>
                      ) : null}
                      {openaiCleaningStep === "failed" ? (
                        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                          Erreur
                        </div>
                      ) : null}
                    </div>

                    {openaiError ? (
                      <div className="whitespace-pre-line rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                        {openaiError}
                      </div>
                    ) : null}

                    {openaiResult ? (
                      <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div>
                            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Avant</div>
                            <div className="flex min-h-56 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white">
                              <img src={openaiResult.before_image} alt="Plan avant nettoyage OpenAI" className="max-h-72 w-full object-contain" />
                            </div>
                          </div>
                          <div>
                            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Après</div>
                            <div className="flex min-h-56 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white">
                              <img src={openaiResult.after_image} alt="Plan après nettoyage OpenAI" className="max-h-72 w-full object-contain" />
                            </div>
                          </div>
                        </div>
                        {openaiResult.verification ? (
                          <div className="rounded-xl border border-slate-200 bg-white p-3">
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-sm font-bold text-slate-950">Vérification</span>
                              <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-safety-green">
                                Score {Math.round(openaiResult.verification.score * 100)}%
                              </span>
                            </div>
                            <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                              <span>Murs oubliés: {openaiResult.verification.murs_oublies.length}</span>
                              <span>Murs inventés: {openaiResult.verification.murs_inventes.length}</span>
                              <span>Ouvertures déplacées: {openaiResult.verification.ouvertures_deplacees}</span>
                            </div>
                            <ul className="mt-2 space-y-1 text-xs text-slate-500">
                              {openaiResult.verification.recommandations.map((recommendation) => (
                                <li key={recommendation}>{recommendation}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="flex flex-col gap-3 border-t border-slate-200 pt-4">
                      {!openaiResult && openaiCostEstimate ? (
                        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-xs font-semibold text-safety-green">
                          Coût estimé maximum pour cette opération : {openaiCostEstimate.estimated_max.toFixed(3)} $ {openaiCostEstimate.currency === "USD" ? "US" : openaiCostEstimate.currency}
                        </div>
                      ) : null}
                      <div className="flex flex-col justify-end gap-3 sm:flex-row">
                      {openaiResult ? (
                        <button
                          type="button"
                          onClick={handleOpenAIClean}
                          disabled={openaiCleaning || openaiApplying}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 px-5 py-2.5 text-xs font-semibold text-safety-green transition-colors hover:bg-green-100 disabled:opacity-50"
                        >
                          {openaiCleaning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                          {cleanMethod === "existing_plan_cleanup" ? "Renettoyer" : "Régénérer"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={openaiResult ? handleUseOpenAIPlan : handleOpenAIClean}
                        disabled={openaiCleaning || openaiApplying || (!openaiResult && !hasUsableOpenAIKey)}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-safety-green px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-safety-green/20 transition-colors hover:bg-green-600 disabled:opacity-50"
                      >
                        {openaiCleaning || openaiApplying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {openaiResult ? "Utiliser ce plan" : cleanMethod === "existing_plan_cleanup" ? "Nettoyer ce plan avec OpenAI" : "Analyser et nettoyer avec OpenAI"}
                      </button>
                      </div>
                    </div>
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
                  <h2 className="text-lg font-bold text-slate-950">Rétablir le plan original ?</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Le fond nettoyé sera désactivé et le plan original sera affiché. Les nettoyages OpenAI restent disponibles dans l'historique.
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
                  <h2 className="text-lg font-bold text-slate-950">Template d'export evacuation</h2>
                  <p className="text-xs text-slate-500">Le plan sera placé au centre avec les consignes et informations autour.</p>
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
	                      {EXPORT_CUSTOM_COLOR_FIELDS.map((field) => {
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
	                      onClick={() => setExportCustomColors(DEFAULT_EXPORT_CUSTOM_COLORS)}
	                      className="mt-2 text-xs font-semibold text-safety-green hover:text-green-700"
	                    >
	                      Réinitialiser les couleurs
	                    </button>
	                  </div>

	                  <div className="rounded-xl border border-slate-200 bg-white p-3">
	                    <div className="mb-3 flex items-center justify-between">
	                      <h3 className="text-sm font-bold text-slate-950">Ajuster le plan central</h3>
                      <button
                        type="button"
                        onClick={() => {
                          setExportPlanScale(100);
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
                          <span>Taille</span>
                          <span>{exportPlanScale}%</span>
                        </div>
                        <input
                          type="range"
                          min="40"
                          max="180"
                          value={exportPlanScale}
                          onChange={(e) => setExportPlanScale(Number(e.target.value))}
                          className="w-full accent-safety-green"
                        />
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
                      placeholder="PLAN D'ÉVACUATION"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Titre affiché dans le bandeau. Vide, il reprend « PLAN D&apos;ÉVACUATION ».
                    </p>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Nom du site
                    </label>
                    <input
                      value={exportSiteName}
                      onChange={(e) => setExportSiteName(e.target.value)}
                      className="block w-full rounded-xl border border-slate-300 bg-white py-2.5 px-4 text-slate-950 placeholder-slate-400 focus:border-safety-green focus:outline-none"
                      placeholder="Ex: Rez-de-chaussée"
                    />
                  </div>

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

                  {/* Logos: client (left of the header) and studio (right) */}
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <h3 className="mb-1 text-sm font-bold text-slate-950">Logos</h3>
                    <p className="mb-3 text-[11px] leading-4 text-slate-500">
                      Affichés dans la bande d'en-tête. Client à gauche, studio à droite.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {([
                        { key: "client", label: "Logo client", value: exportClientLogo, setter: setExportClientLogo },
                        { key: "studio", label: "Logo studio", value: exportStudioLogo, setter: setExportStudioLogo }
                      ] as const).map(({ key, label, value, setter }) => (
                        <div key={key}>
                          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</span>
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
                                  const reader = new FileReader();
                                  reader.onload = () => setter(typeof reader.result === "string" ? reader.result : "");
                                  reader.readAsDataURL(file);
                                }}
                              />
                            </label>
                            {value && (
                              <button
                                type="button"
                                onClick={() => setter("")}
                                title="Retirer le logo"
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
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
                        { key: "safety", label: "Consignes de sécurité", checked: exportShowSafety, setter: setExportShowSafety },
                        { key: "intervention", label: "Équipe d'intervention", checked: exportShowIntervention, setter: setExportShowIntervention },
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
                    <div className="mr-auto flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Format
                        </span>
                        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                          {(Object.keys(EXPORT_PAPER_SIZES) as ExportPaperFormat[]).map((key) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setExportPaperFormat(key)}
                              className={`cursor-pointer rounded px-3 py-1.5 text-xs font-bold transition-colors ${
                                exportPaperFormat === key
                                  ? "bg-safety-green text-white"
                                  : "text-slate-600 hover:bg-slate-200"
                              }`}
                            >
                              {EXPORT_PAPER_SIZES[key].label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <span className="text-[11px] leading-tight text-slate-500">
                        {EXPORT_PAPER_SIZES[exportPaperFormat].widthMm} ×{" "}
                        {EXPORT_PAPER_SIZES[exportPaperFormat].heightMm} mm &middot; paysage
                        <br />
                        {EXPORT_CANVAS_WIDTH * EXPORT_OUTPUT_SCALE} ×{" "}
                        {EXPORT_CANVAS_HEIGHT * EXPORT_OUTPUT_SCALE} px &middot;{" "}
                        {Math.round(
                          (EXPORT_CANVAS_WIDTH * EXPORT_OUTPUT_SCALE) /
                            (EXPORT_PAPER_SIZES[exportPaperFormat].widthMm / 25.4)
                        )}{" "}
                        dpi
                      </span>
                    </div>
                    <button
                      onClick={() => setExportModalOpen(false)}
                      disabled={exporting || previewing}
                      className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-800 disabled:opacity-50"
                    >
                      Annuler
                    </button>
                    <button
                      onClick={handlePreviewPdf}
                      disabled={exporting || previewing}
                      className="flex items-center justify-center space-x-2 rounded-xl border border-emerald-700 bg-emerald-950/50 px-4 py-2.5 text-sm font-semibold text-emerald-100 hover:bg-emerald-900 disabled:opacity-50"
                    >
                      {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                      <span>{previewing ? "Prévisualisation..." : "Prévisualiser PDF"}</span>
                    </button>
                    <button
                      onClick={handleExportTemplate}
                      disabled={exporting || previewing}
                      className="flex items-center justify-center space-x-2 rounded-xl bg-safety-green px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-safety-green/10 hover:bg-green-600 disabled:opacity-50"
                    >
                      {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : exportFormat === "pdf" ? <FileDown className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                      <span>{exporting ? "Generation..." : `Exporter ${exportFormat.toUpperCase()}`}</span>
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
                    router.push("/dashboard");
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
      </div>
    </ProtectedRoute>
  );
}
