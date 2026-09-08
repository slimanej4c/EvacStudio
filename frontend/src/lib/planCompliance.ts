import {
  SHEET_DOCUMENT_TYPES,
  SHEET_TEMPLATES,
  type SheetDocumentTypeKey,
  type SheetTemplateKey,
} from "./sheetTemplates";

export const EXPORT_PAPER_SIZES = {
  a4: { label: "A4", widthMm: 297, heightMm: 210 },
  a3: { label: "A3", widthMm: 420, heightMm: 297 },
  a2: { label: "A2", widthMm: 594, heightMm: 420 },
} as const;

export type ExportPaperFormat = keyof typeof EXPORT_PAPER_SIZES;
export type PlanDocumentType = SheetDocumentTypeKey | "";
export type ExportComplianceStatus = "compliant" | "attention" | "non_compliant";

export interface ExportComplianceIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface ExportComplianceReport {
  status: ExportComplianceStatus;
  issues: ExportComplianceIssue[];
  minimumPaperFormat: ExportPaperFormat | null;
  maximumScaleDenominator: number;
  paperDimensionTolerancePercent: number;
}

export interface ScaleCalibrationMeasurement {
  realDistanceM: number;
  printedDistanceMm: number;
  measuredScaleDenominator: number;
  declaredScaleDeviationPercent: number;
}

export interface ExportPaperOption {
  key: ExportPaperFormat;
  label: string;
  disabled: boolean;
  description: string;
}

export const RECOMMENDED_SCALE_DENOMINATOR = 250;
export const STANDARD_MAX_SCALE_DENOMINATOR = 250;
export const A2_MAX_SCALE_DENOMINATOR = 350;
export const PAPER_DIMENSION_TOLERANCE_PERCENT = 5;
// Operational threshold for detecting a likely mismatch between a typed label
// and a manual two-point measurement. It is not presented as an NF tolerance.
export const DECLARED_SCALE_MATCH_TOLERANCE_PERCENT = 2;

const PAPER_RANK: Record<ExportPaperFormat, number> = { a4: 0, a3: 1, a2: 2 };
const MINIMUM_PAPER_BY_DOCUMENT_TYPE: Partial<Record<SheetDocumentTypeKey, ExportPaperFormat>> = {
  evacuation: "a3",
  intervention: "a3",
  room: "a4",
};

export const documentTypeLabel = (documentType: PlanDocumentType) => (
  documentType ? SHEET_DOCUMENT_TYPES[documentType].label : "Type de document non défini"
);

export const templateDocumentType = (template: SheetTemplateKey): SheetDocumentTypeKey => (
  SHEET_TEMPLATES[template].documentTypes[0]
);

export function minimumPaperForDocumentType(
  documentType: PlanDocumentType,
): ExportPaperFormat | null {
  return documentType ? MINIMUM_PAPER_BY_DOCUMENT_TYPE[documentType] ?? null : null;
}

export function recommendedPaperForTemplate(template: SheetTemplateKey): ExportPaperFormat {
  const config = SHEET_TEMPLATES[template];
  if ("paper" in config && config.paper) return config.paper as ExportPaperFormat;
  return minimumPaperForDocumentType(templateDocumentType(template)) ?? "a3";
}

export function paperOptionsForDocumentType(
  documentType: PlanDocumentType,
): ExportPaperOption[] {
  const minimum = minimumPaperForDocumentType(documentType);
  return (Object.keys(EXPORT_PAPER_SIZES) as ExportPaperFormat[]).map((key) => {
    const belowRecommendation = Boolean(minimum && PAPER_RANK[key] < PAPER_RANK[minimum]);
    return {
      key,
      label: EXPORT_PAPER_SIZES[key].label,
      // Compliance is advisory here: every supported paper format must remain
      // available so the operator can still produce the requested document.
      disabled: false,
      description: belowRecommendation && minimum
        ? `${documentTypeLabel(documentType)} : ${EXPORT_PAPER_SIZES[minimum].label} minimum recommandé ; ${EXPORT_PAPER_SIZES[key].label} reste exportable avec une remarque.`
        : key === "a2"
          ? "Grand format : échelle admise jusqu’à 1:350."
          : "Format de la série A.",
    };
  });
}

export function evaluateExportCompliance({
  documentType,
  paperFormat,
  scaleDenominator,
  calibrationPresent = false,
  measuredScaleDenominator = null,
}: {
  documentType: PlanDocumentType;
  paperFormat: ExportPaperFormat;
  scaleDenominator: number;
  calibrationPresent?: boolean;
  measuredScaleDenominator?: number | null;
}): ExportComplianceReport {
  const issues: ExportComplianceIssue[] = [];
  const minimumPaperFormat = minimumPaperForDocumentType(documentType);
  const maximumScaleDenominator = paperFormat === "a2"
    ? A2_MAX_SCALE_DENOMINATOR
    : STANDARD_MAX_SCALE_DENOMINATOR;

  if (!documentType) {
    issues.push({
      code: "document_type_missing",
      severity: "warning",
      message: "Choisissez un template pour identifier le type de document à auditer.",
    });
  } else if (
    minimumPaperFormat
    && PAPER_RANK[paperFormat] < PAPER_RANK[minimumPaperFormat]
  ) {
    issues.push({
      code: "paper_too_small",
      severity: "error",
      message: `${documentTypeLabel(documentType)} : ${EXPORT_PAPER_SIZES[minimumPaperFormat].label} minimum recommandé pour préserver la lisibilité. Le format ${EXPORT_PAPER_SIZES[paperFormat].label} reste exportable.`,
    });
  }

  if (documentType && !calibrationPresent) {
    issues.push({
      code: "scale_unverified",
      severity: "warning",
      message: "Échelle déclarée mais non vérifiée : calibrez deux points de distance connue.",
    });
  } else if (calibrationPresent && measuredScaleDenominator == null) {
    issues.push({
      code: "scale_measurement_pending",
      severity: "warning",
      message: "La calibration existe, mais sa mesure sur la feuille n’est pas encore disponible.",
    });
  } else if (
    measuredScaleDenominator != null
    && measuredScaleDenominator > maximumScaleDenominator
  ) {
    issues.push({
      code: "measured_scale_too_small",
      severity: "error",
      message: `L’échelle réellement mesurée 1:${measuredScaleDenominator.toFixed(1)} dépasse la recommandation 1:${maximumScaleDenominator} pour ce format ; vérifiez que le plan reste lisible.`,
    });
  } else if (
    measuredScaleDenominator != null
    && Math.abs(measuredScaleDenominator - scaleDenominator) / scaleDenominator * 100
      > DECLARED_SCALE_MATCH_TOLERANCE_PERCENT
  ) {
    issues.push({
      code: "declared_scale_mismatch",
      severity: "warning",
      message: `L’échelle déclarée 1:${scaleDenominator} ne correspond pas à la mesure 1:${measuredScaleDenominator.toFixed(1)} (seuil technique ${DECLARED_SCALE_MATCH_TOLERANCE_PERCENT} %).`,
    });
  }

  if (!Number.isFinite(scaleDenominator) || scaleDenominator < 1) {
    issues.push({
      code: "scale_invalid",
      severity: "error",
      message: "L’échelle déclarée doit être un nombre supérieur à zéro.",
    });
  } else if (scaleDenominator > maximumScaleDenominator) {
    issues.push({
      code: "scale_too_small",
      severity: "error",
      message: `L’échelle 1:${scaleDenominator} dépasse la recommandation 1:${maximumScaleDenominator} pour ce format ; l’export reste possible si le plan demeure lisible.`,
    });
  }

  return {
    status: issues.some((issue) => issue.severity === "error")
      ? "non_compliant"
      : issues.some((issue) => issue.severity === "warning")
        ? "attention"
        : "compliant",
    issues,
    minimumPaperFormat,
    maximumScaleDenominator,
    paperDimensionTolerancePercent: PAPER_DIMENSION_TOLERANCE_PERCENT,
  };
}

export const NF_X08_070_ICON_TOOLTIP =
  "Norme NF X08-070 : Les pictogrammes de sécurité doivent mesurer au minimum 7 mm à l'échelle d'impression (seuil critique toléré à 5 mm). Les symboles de la légende doivent avoir exactement la même taille que sur le plan.";

export interface IconComplianceResult {
  case: 1 | 2 | 3 | 4;
  status: "compliant" | "warning" | "non_compliant";
  badgeEmoji: string;
  badgeLabel: string;
  description: string;
  borderColor: string;
  bgColor: string;
  textColor: string;
  badgeText: string;
}

export function evaluateIconCompliance({
  sizeMm,
  isYouAreHere = false,
}: {
  sizeMm: number;
  isYouAreHere?: boolean;
}): IconComplianceResult {
  // Cas 4 : Cas particulier "Vous êtes ici" (Si < 8 mm)
  if (isYouAreHere) {
    if (sizeMm < 8) {
      return {
        case: 4,
        status: "warning",
        badgeEmoji: "⚠️",
        badgeLabel: "⚠️ Repère \"Vous êtes ici\" trop petit",
        description:
          "La norme exige une mise en évidence immédiate (taille recommandée : 8 mm à 10 mm).",
        borderColor: "border-amber-500/35",
        bgColor: "bg-amber-500/10",
        textColor: "text-amber-200",
        badgeText: "text-amber-300",
      };
    }
    return {
      case: 1,
      status: "compliant",
      badgeEmoji: "✅",
      badgeLabel: "✅ Conforme NF X08-070",
      description: "Taille optimale pour impression (recommandé : 8 mm à 10 mm).",
      borderColor: "border-emerald-500/35",
      bgColor: "bg-emerald-500/10",
      textColor: "text-emerald-200",
      badgeText: "text-emerald-300",
    };
  }

  // Cas 1 : Conforme (Taille >= 7 mm)
  if (sizeMm >= 7) {
    return {
      case: 1,
      status: "compliant",
      badgeEmoji: "✅",
      badgeLabel: "✅ Conforme NF X08-070",
      description: "Taille optimale pour impression (recommandé : ≥ 7 mm).",
      borderColor: "border-emerald-500/35",
      bgColor: "bg-emerald-500/10",
      textColor: "text-emerald-200",
      badgeText: "text-emerald-300",
    };
  }

  // Cas 2 : Toléré / Avertissement (Entre 5 mm et 6.9 mm)
  if (sizeMm >= 5) {
    return {
      case: 2,
      status: "warning",
      badgeEmoji: "⚠️",
      badgeLabel: "⚠️ Conformité minimale (5 mm - 6.9 mm)",
      description:
        "Taille autorisée uniquement sur formats réduits (A4). Privilégiez 7 mm pour une lisibilité optimale.",
      borderColor: "border-amber-500/35",
      bgColor: "bg-amber-500/10",
      textColor: "text-amber-200",
      badgeText: "text-amber-300",
    };
  }

  // Cas 3 : Non conforme (Taille < 5 mm)
  return {
    case: 3,
    status: "non_compliant",
    badgeEmoji: "❌",
    badgeLabel: "❌ Non conforme NF X08-070",
    description:
      "Taille inférieure au seuil légal (minimum absolu : 5 mm à l'impression). Risque de rejet lors du contrôle de sécurité.",
    borderColor: "border-red-500/35",
    bgColor: "bg-red-500/10",
    textColor: "text-red-200",
    badgeText: "text-red-300",
  };
}

