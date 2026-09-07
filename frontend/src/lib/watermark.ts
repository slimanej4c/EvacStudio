import { DEFAULT_STUDIO_LOGO } from "@/lib/brandLogos";

export const DEFAULT_WATERMARK_TEXT = "BON À TIRER – POUR VALIDATION UNIQUEMENT";

export interface WatermarkConfig {
  enabled: boolean;
  text: string;
  client: string;
  reference: string;
  date: string;
  comment: string;
  /** Rasterized data URLs shown inside the approval block. */
  client_logo: string;
  creator_logo: string;
  show_bat_block: boolean;
  repeat: boolean;
  diagonal: boolean;
  /** Normalized position inside the visible plan/sheet surface. */
  block_x: number;
  block_y: number;
  block_locked: boolean;
  block_width?: number;
  block_height?: number;
}

export function createDefaultWatermarkConfig(date = ""): WatermarkConfig {
  return {
    enabled: false,
    text: DEFAULT_WATERMARK_TEXT,
    client: "",
    reference: "",
    date,
    comment: "",
    client_logo: "",
    creator_logo: DEFAULT_STUDIO_LOGO,
    show_bat_block: true,
    repeat: true,
    diagonal: true,
    block_x: 0.68,
    block_y: 0.62,
    block_locked: false,
    block_width: undefined,
    block_height: undefined,
  };
}

export function normalizeWatermarkConfig(
  value: Partial<WatermarkConfig> | null | undefined,
  fallbackDate = ""
): WatermarkConfig {
  const defaults = createDefaultWatermarkConfig(fallbackDate);
  const rawW = value?.block_width !== undefined && value?.block_width !== null ? Number(value.block_width) : undefined;
  const rawH = value?.block_height !== undefined && value?.block_height !== null ? Number(value.block_height) : undefined;
  return {
    ...defaults,
    ...(value || {}),
    block_x: Math.min(1, Math.max(0, Number(value?.block_x ?? defaults.block_x))),
    block_y: Math.min(1, Math.max(0, Number(value?.block_y ?? defaults.block_y))),
    block_width: rawW && Number.isFinite(rawW) ? Math.max(100, Math.round(rawW)) : undefined,
    block_height: rawH && Number.isFinite(rawH) ? Math.max(80, Math.round(rawH)) : undefined,
  };
}
