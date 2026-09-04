import {
  SHEET_TEMPLATES,
  type SheetBlock,
  type SheetTemplateKey,
} from "@/lib/sheetTemplates";

export const PLAN_INFORMATION_FIELDS = [
  { key: "establishment_name", label: "Nom de l’établissement", shortLabel: "Établissement", type: "text" },
  { key: "building_name", label: "Bâtiment / zone", shortLabel: "Bâtiment / zone", type: "text" },
  { key: "floor_name", label: "Étage", shortLabel: "Étage", type: "text" },
  { key: "plan_number", label: "Numéro du plan", shortLabel: "N° du plan", type: "text" },
  { key: "design_date", label: "Date de conception", shortLabel: "Conception", type: "date" },
  { key: "designer", label: "Concepteur", shortLabel: "Concepteur", type: "text" },
  { key: "revision_index", label: "Indice de révision", shortLabel: "Révision", type: "text" },
  { key: "last_verification_date", label: "Date de dernière vérification", shortLabel: "Dernière vérification", type: "date" },
  { key: "next_verification_date", label: "Prochaine vérification prévue", shortLabel: "Prochaine vérification", type: "date" },
] as const;

export type PlanInformationFieldKey = (typeof PLAN_INFORMATION_FIELDS)[number]["key"];
export type PlanInformationValues = Record<PlanInformationFieldKey, string>;
export type PlanInformationVisibility = Record<PlanInformationFieldKey, boolean>;
export type StoredPlanInformationVisibility = Partial<PlanInformationVisibility>;
export interface PlanInformationBlockLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}
export type PlanInformationLayouts = Record<string, PlanInformationBlockLayout>;

export const PLAN_INFORMATION_BLOCK_ID = "dynamic-plan-required-information";
const OPTIONAL_PLAN_INFORMATION_FIELDS = new Set<PlanInformationFieldKey>([
  "last_verification_date",
  "next_verification_date",
]);

export const EMPTY_PLAN_INFORMATION: PlanInformationValues = Object.fromEntries(
  PLAN_INFORMATION_FIELDS.map(({ key }) => [key, ""]),
) as PlanInformationValues;

export const DEFAULT_PLAN_INFORMATION_VISIBILITY: PlanInformationVisibility = Object.fromEntries(
  PLAN_INFORMATION_FIELDS.map(({ key }) => [key, true]),
) as PlanInformationVisibility;

export function readPlanInformation(
  source?: Partial<Record<PlanInformationFieldKey, string | null>> | null,
): PlanInformationValues {
  const values = Object.fromEntries(
    PLAN_INFORMATION_FIELDS.map(({ key }) => [key, source?.[key] || ""]),
  ) as PlanInformationValues;
  if (!values.next_verification_date && values.design_date) {
    values.next_verification_date = nextVerificationDateFromDesignDate(values.design_date);
  }
  return values;
}

export function normalizePlanInformationVisibility(
  source?: StoredPlanInformationVisibility | null,
): PlanInformationVisibility {
  return Object.fromEntries(
    PLAN_INFORMATION_FIELDS.map(({ key }) => [key, source?.[key] !== false]),
  ) as PlanInformationVisibility;
}

export function missingPlanInformationFields(values: PlanInformationValues) {
  return PLAN_INFORMATION_FIELDS.filter(
    ({ key }) => !OPTIONAL_PLAN_INFORMATION_FIELDS.has(key) && !values[key].trim(),
  );
}

export function isPlanInformationFieldRequired(key: PlanInformationFieldKey) {
  return !OPTIONAL_PLAN_INFORMATION_FIELDS.has(key);
}

export function formatPlanReference(planNumber: string, revisionIndex: string) {
  const number = planNumber.trim();
  const revision = revisionIndex.trim();
  if (!number) return "";
  return revision ? `${number} · Indice ${revision}` : number;
}

export function nextVerificationDateFromDesignDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "";
  const year = Number(match[1]) + 1;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${Math.min(day, lastDayOfMonth).toString().padStart(2, "0")}`;
}

const formatFrenchDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
};

export function stripPlanInformationBlock(blocks: SheetBlock[]) {
  return blocks.filter((block) => block.id !== PLAN_INFORMATION_BLOCK_ID);
}

export function getPlanInformationBlockLayout(
  blocks: SheetBlock[],
): PlanInformationBlockLayout | null {
  const block = blocks.find((item) => item.id === PLAN_INFORMATION_BLOCK_ID);
  if (!block) return null;
  return {
    x: block.x,
    y: block.y,
    width: block.width,
    height: block.height,
    rotation: block.rotation,
  };
}

/**
 * Adds the plan-specific traceability block to a reusable template without
 * writing those client values into the template definition or its drafts.
 */
export function upsertPlanInformationBlock(
  template: SheetTemplateKey,
  blocks: SheetBlock[],
  values: PlanInformationValues,
  visibility: PlanInformationVisibility,
  storedLayout?: PlanInformationBlockLayout | null,
): SheetBlock[] {
  const existingIds = new Set(blocks.map((block) => block.id));
  const siteBlockIds = new Set(["nf-site", "evac-green-site", "intervention-site"]);
  const levelBlockIds = new Set(["room-level", "evac-green-level", "intervention-right-level"]);
  const hasSiteBlock = [...siteBlockIds].some((id) => existingIds.has(id));
  const hasLevelBlock = [...levelBlockIds].some((id) => existingIds.has(id));
  const siteLines = [
    visibility.establishment_name ? values.establishment_name.trim() : "",
    visibility.building_name ? values.building_name.trim() : "",
    !hasLevelBlock && visibility.floor_name ? values.floor_name.trim() : "",
  ].filter(Boolean);
  const reusableBlocks = stripPlanInformationBlock(blocks).map((block) => {
    if (siteBlockIds.has(block.id)) {
      return { ...block, text: siteLines.join("\n"), visible: siteLines.length > 0 };
    }
    if (levelBlockIds.has(block.id)) {
      return {
        ...block,
        text: values.floor_name.trim() || "—",
        visible: visibility.floor_name,
      };
    }
    if (block.id === "room-footer-creator") {
      return {
        ...block,
        text: `Concepteur : ${values.designer.trim() || "—"}`,
        visible: visibility.designer,
      };
    }
    if (block.id === "room-footer-reference") {
      return {
        ...block,
        text: `N° du plan : ${formatPlanReference(values.plan_number, values.revision_index) || "—"}`,
        visible: visibility.plan_number,
      };
    }
    if (block.id === "room-footer-date") {
      return {
        ...block,
        text: `Date : ${formatFrenchDate(values.design_date.trim()) || "—"}`,
        visible: visibility.design_date,
      };
    }
    return block;
  });

  const representedFields = new Set<PlanInformationFieldKey>();
  if (hasSiteBlock) {
    representedFields.add("establishment_name");
    representedFields.add("building_name");
    if (!hasLevelBlock) representedFields.add("floor_name");
  }
  if (hasLevelBlock) representedFields.add("floor_name");
  if (existingIds.has("room-footer-creator")) representedFields.add("designer");
  if (existingIds.has("room-footer-reference")) {
    representedFields.add("plan_number");
    representedFields.add("revision_index");
  }
  if (existingIds.has("room-footer-date")) representedFields.add("design_date");

  const visibleFields = PLAN_INFORMATION_FIELDS.filter(
    ({ key }) => (
      visibility[key]
      && !representedFields.has(key)
      && !(key === "revision_index" && visibility.plan_number)
      && (isPlanInformationFieldRequired(key) || Boolean(values[key].trim()))
    ),
  );
  if (!visibleFields.length) return reusableBlocks;

  const entries = visibleFields.map(({ key, shortLabel, type }) => {
    const rawValue = values[key].trim();
    const displayValue = key === "plan_number"
      ? formatPlanReference(rawValue, values.revision_index)
      : type === "date" ? formatFrenchDate(rawValue) : rawValue;
    return `${shortLabel} : ${displayValue || "—"}`;
  });
  const textRows = Array.from({ length: Math.ceil(entries.length / 2) }, (_, index) => (
    entries.slice(index * 2, index * 2 + 2).join("   •   ")
  ));
  const text = textRows.join("\n");

  const sheet = SHEET_TEMPLATES[template];
  const portrait = sheet.height > sheet.width;
  const previous = blocks.find((block) => block.id === PLAN_INFORMATION_BLOCK_ID);
  const width = portrait ? 455 : 520;
  const height = Math.min(
    portrait ? 138 : 126,
    Math.max(82, 43 + textRows.length * (portrait ? 16 : 14)),
  );
  const defaultGeometry = {
    x: sheet.width - width - 20,
    y: sheet.height - height - 18,
    width,
    height,
  };
  const geometry = previous
    ? {
        x: previous.x,
        y: previous.y,
        width: previous.width,
        height: previous.height,
      }
    : storedLayout ?? defaultGeometry;

  const block: SheetBlock = {
    id: PLAN_INFORMATION_BLOCK_ID,
    kind: "text",
    label: "Informations du plan",
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
    rotation: previous?.rotation ?? storedLayout?.rotation ?? 0,
    visible: true,
    locked: false,
    title: "INFORMATIONS DU PLAN",
    text,
    fill: "#ffffff",
    stroke: "#6b7280",
    strokeWidth: 1,
    color: "#1f2937",
    fontSize: portrait ? 9.5 : 9,
    fontStyle: "normal",
    align: "left",
    verticalAlign: "top",
    lineHeight: 1.15,
    padding: 7,
    titleFill: "#f3f4f6",
    titleColor: "#111827",
    titleFontSize: portrait ? 10 : 9.5,
    titleHeight: 22,
    titleAlign: "left",
    titleRule: true,
  };

  return [...reusableBlocks, block];
}
