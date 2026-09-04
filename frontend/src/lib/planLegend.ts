import type { SheetBlock } from "@/lib/sheetTemplates";

export interface PlanLegendLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
}

export type PlanLegendLayouts = Record<string, PlanLegendLayout>;

const layoutFromBlock = (block: SheetBlock): PlanLegendLayout => ({
  x: block.x,
  y: block.y,
  width: block.width,
  height: block.height,
  rotation: block.rotation,
  visible: block.visible,
});

export function getPlanLegendLayout(blocks: SheetBlock[]) {
  const legend = blocks.find((block) => block.kind === "legend");
  return legend ? layoutFromBlock(legend) : null;
}

/**
 * Apply the current plan's legend geometry while retaining the template's
 * original geometry in memory. The retained copy is stripped before any
 * reusable template draft is written.
 */
export function applyPlanLegendLayout(
  blocks: SheetBlock[],
  storedLayout?: PlanLegendLayout | null,
) {
  let applied = false;
  return blocks.map((block) => {
    if (block.kind !== "legend" || applied) return block;
    applied = true;
    const baseLayout = block.planLegendBaseLayout ?? {
      ...layoutFromBlock(block),
      locked: block.locked,
    };
    const geometry = block.planLegendBaseLayout
      ? layoutFromBlock(block)
      : storedLayout ?? layoutFromBlock(block);
    return {
      ...block,
      ...geometry,
      locked: false,
      planLegendBaseLayout: baseLayout,
    };
  });
}

/** Restore reusable-template geometry before saving a template version. */
export function stripPlanLegendLayoutOverrides(blocks: SheetBlock[]) {
  return blocks.map((block) => {
    if (block.kind !== "legend" || !block.planLegendBaseLayout) return block;
    const { planLegendBaseLayout, ...reusableBlock } = block;
    return {
      ...reusableBlock,
      ...planLegendBaseLayout,
    };
  });
}
