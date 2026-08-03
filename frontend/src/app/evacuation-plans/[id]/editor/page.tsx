"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/context/AuthContext";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, Save, Trash2, Settings, HelpCircle, Loader2, Sparkles, RefreshCw, X, FileDown, Download, Eye, PanelLeft, PanelRight, Eraser, Circle, Square, Copy, CopyPlus, ClipboardPaste } from "lucide-react";
import { IconType, SAFETY_ICONS, SafetyIconDefinition, getIconImageSource } from "@/utils/safetyIcons";
import { CanvasIcon, EraserShape, PlanCanvasHandle } from "@/components/PlanCanvas";
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
  const [selectedIconId, setSelectedIconId] = useState<string | null>(null);
  const [placementIconType, setPlacementIconType] = useState<IconType | null>(null);
  const [defaultIconSize, setDefaultIconSize] = useState({ width: 40, height: 40 });
  
  const [zoom, setZoom] = useState(1.0);
  const [fitSignal, setFitSignal] = useState(0);
  const [mode, setMode] = useState<"select" | "pan" | "erase">("select");
  const spaceHeldRef = useRef(false);
  const modeBeforeSpaceRef = useRef<"select" | "pan" | "erase">("select");
  const [leftDockOpen, setLeftDockOpen] = useState(true);
  const [rightDockOpen, setRightDockOpen] = useState(true);
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
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"png" | "pdf">("pdf");
  const [exportPaperFormat, setExportPaperFormat] = useState<ExportPaperFormat>("a4");
  const [exporting, setExporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [exportPreviewUrl, setExportPreviewUrl] = useState("");
  const [exportAdjustmentPreviewUrl, setExportAdjustmentPreviewUrl] = useState("");
  const [exportAdjustmentPreviewLoading, setExportAdjustmentPreviewLoading] = useState(false);
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
  // Total interface width: docks + workspace. Always <= the window.
  const interfaceWidth = viewportWidth ? leftDockWidth + canvasColumnWidth + rightDockWidth : 0;

  const getPlanAuthHeaders = (): Record<string, string> => {
    const authToken = token || (typeof window !== "undefined" ? localStorage.getItem("token") : null);
    return authToken ? { Authorization: `Bearer ${authToken}` } : {};
  };

  const revokeObjectUrlSafely = (url: string) => {
    if (url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
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
            label: icon.label || ""
          }));
          setIcons(canvasIcons);
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

  useEffect(() => {
    if (!placementIconType) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPlacementIconType(null);
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

      if (res.ok) {
        setSaveStatus("Sauvegardé !");
        setTimeout(() => setSaveStatus(""), 2000);
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
    return `${errorCode}${data.error || "Erreur pendant le nettoyage OpenAI."}`;
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
          return stage.toDataURL({
            x: backgroundNode.x(),
            y: backgroundNode.y(),
            width: backgroundNode.width(),
            height: backgroundNode.height(),
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
      // panning or zooming no longer invalidates the cached render.
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

    const canvas = document.createElement("canvas");
    canvas.width = EXPORT_CANVAS_WIDTH * outputScale;
    canvas.height = EXPORT_CANVAS_HEIGHT * outputScale;
    const context = canvas.getContext("2d");
    if (!context) return null;

    context.scale(outputScale, outputScale);
    context.textBaseline = "alphabetic";

    // ── Sheet background ────────────────────────────────────────────────
    context.fillStyle = "#eef3f0";
    context.fillRect(0, 0, EXPORT_CANVAS_WIDTH, EXPORT_CANVAS_HEIGHT);

    // ── Header band ─────────────────────────────────────────────────────
    const headerGradient = context.createLinearGradient(0, 0, EXPORT_CANVAS_WIDTH, EXPORT_HEADER_H);
    headerGradient.addColorStop(0, EXPORT_GREEN_DARK);
    headerGradient.addColorStop(1, EXPORT_GREEN);
    context.fillStyle = headerGradient;
    context.fillRect(0, 0, EXPORT_CANVAS_WIDTH, EXPORT_HEADER_H);

    // Safety-signage accent rule under the band
    context.fillStyle = "#f5c518";
    context.fillRect(0, EXPORT_HEADER_H, EXPORT_CANVAS_WIDTH, 4);

    context.textAlign = "center";
    context.fillStyle = "#ffffff";
    context.font = `800 42px ${EXPORT_FONT}`;
    drawTrackedText(context, "PLAN D'ÉVACUATION", EXPORT_CANVAS_WIDTH / 2, 50, "0.12em");

    context.fillStyle = "rgba(255,255,255,0.92)";
    context.font = `600 24px ${EXPORT_FONT}`;
    context.fillText(
      exportSiteName || plan?.building_name || "Nom du site",
      EXPORT_CANVAS_WIDTH / 2,
      84
    );
    context.textAlign = "left";

    // ── Column geometry ─────────────────────────────────────────────────
    const contentTop = EXPORT_HEADER_H + 22;
    const contentBottom = EXPORT_CANVAS_HEIGHT - EXPORT_FOOTER_H - 18;
    const leftX = EXPORT_MARGIN;
    const rightX = EXPORT_CANVAS_WIDTH - EXPORT_MARGIN - EXPORT_SIDE_W;
    const planX = leftX + EXPORT_SIDE_W + EXPORT_GUTTER;
    const planW = rightX - EXPORT_GUTTER - planX;
    const planY = contentTop;
    const planH = contentBottom - contentTop;

    const topPanelH = exportSafetyPanelHeight;
    const bottomPanelY = contentTop + topPanelH + 22;
    const bottomPanelH = exportInterventionPanelHeight;
    const legendHeight = exportLegendPanelHeight;

    // ── Left column: instructions ───────────────────────────────────────
    drawPanel(
      context,
      leftX,
      contentTop,
      EXPORT_SIDE_W,
      topPanelH,
      "Consignes de sécurité",
      exportSafetyText,
      exportSafetyFontSize,
      EXPORT_RED
    );
    drawPanel(
      context,
      leftX,
      bottomPanelY,
      EXPORT_SIDE_W,
      bottomPanelH,
      "Équipe d'intervention",
      exportInterventionText,
      exportInterventionFontSize,
      EXPORT_SLATE
    );

    // ── Right column: legend ────────────────────────────────────────────
    drawCard(context, rightX, contentTop, EXPORT_SIDE_W, legendHeight, "Légende", EXPORT_GREEN);

    context.save();
    context.beginPath();
    context.rect(rightX + 1, contentTop + EXPORT_CARD_HEADER_H, EXPORT_SIDE_W - 2, legendHeight - EXPORT_CARD_HEADER_H - 2);
    context.clip();
    context.font = `400 ${exportLegendFontSize}px ${EXPORT_FONT}`;

    if (loadedLegendImages.length === 0) {
      context.fillStyle = "#7d8c85";
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
        context.fillStyle = "#f4f8f6";
        context.fillRect(rightX + 1, legendRowY, EXPORT_SIDE_W - 2, rowHeight);
      }

      const chipX = rightX + 16;
      const chipY = legendRowY + (rowHeight - chipSize) / 2;
      context.fillStyle = "#f0f5f2";
      tracePath(context, chipX, chipY, chipSize, chipSize, 7);
      context.fill();
      context.strokeStyle = "rgba(12, 42, 28, 0.10)";
      context.lineWidth = 1;
      tracePath(context, chipX, chipY, chipSize, chipSize, 7);
      context.stroke();
      context.drawImage(image, chipX + 6, chipY + 6, iconSize, iconSize);

      context.fillStyle = "#1f2d27";
      const textBlockTop = legendRowY + (rowHeight - labelLines.length * lineHeight) / 2 + lineHeight * 0.72;
      labelLines.forEach((line, lineIndex) => {
        context.fillText(line, textX, textBlockTop + lineIndex * lineHeight);
      });

      legendRowY += rowHeight;
    });
    context.restore();

    // ── Centre: the plan itself ─────────────────────────────────────────
    context.save();
    context.shadowColor = "rgba(12, 42, 28, 0.16)";
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
    context.rotate((exportPlanRotation * Math.PI) / 180);
    context.drawImage(trimmedPlan, -drawW / 2, -drawH / 2, drawW, drawH);
    context.restore();

    context.strokeStyle = "rgba(12, 42, 28, 0.16)";
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
    context.strokeStyle = "rgba(12, 42, 28, 0.14)";
    context.lineWidth = 1;
    tracePath(context, northX - 20, northY - 18, 40, 56, 8);
    context.stroke();
    context.fillStyle = "#1f2d27";
    context.beginPath();
    context.moveTo(northX, northY - 12);
    context.lineTo(northX + 9, northY + 10);
    context.lineTo(northX, northY + 4);
    context.lineTo(northX - 9, northY + 10);
    context.closePath();
    context.fill();
    context.textAlign = "center";
    context.font = `700 14px ${EXPORT_FONT}`;
    context.fillText("N", northX, northY + 32);
    context.textAlign = "left";
    context.restore();

    // ── Footer ──────────────────────────────────────────────────────────
    const footerY = EXPORT_CANVAS_HEIGHT - EXPORT_FOOTER_H;
    context.fillStyle = "#ffffff";
    context.fillRect(0, footerY, EXPORT_CANVAS_WIDTH, EXPORT_FOOTER_H);
    context.fillStyle = EXPORT_GREEN;
    context.fillRect(0, footerY, EXPORT_CANVAS_WIDTH, 2);

    context.save();
    context.textBaseline = "middle";
    context.fillStyle = "#4a5b53";
    context.font = `600 15px ${EXPORT_FONT}`;
    const footerParts = [plan?.building_name, plan?.floor_name].filter(Boolean).join("  ·  ");
    context.fillText(footerParts || plan?.title || "", EXPORT_MARGIN, footerY + EXPORT_FOOTER_H / 2);

    context.textAlign = "center";
    context.fillStyle = "#7d8c85";
    context.font = `400 14px ${EXPORT_FONT}`;
    context.fillText(
      `${loadedLegendImages.length} type${loadedLegendImages.length > 1 ? "s" : ""} d'équipement  ·  ${icons.length} implantation${icons.length > 1 ? "s" : ""}`,
      EXPORT_CANVAS_WIDTH / 2,
      footerY + EXPORT_FOOTER_H / 2
    );

    context.textAlign = "right";
    context.fillStyle = "#7d8c85";
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
            <Link
              href="/dashboard"
              title="Retour au tableau de bord"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
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
                  onSelectIcon={setSelectedIconId}
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
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <HelpCircle className="h-8 w-8 text-neutral-700" />
                <p className="text-[11px] leading-relaxed text-neutral-500">
                  Sélectionnez un équipement sur le plan pour ajuster sa taille, sa rotation et son libellé.
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
                      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
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

              <div className="grid flex-1 min-h-0 gap-5 overflow-y-auto p-5 lg:grid-cols-[1fr_340px]">
                <div className="rounded-xl border border-emerald-900/30 bg-emerald-50 p-3">
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

                <div className="space-y-3">
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
      </div>
    </ProtectedRoute>
  );
}
