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
    creator_logo: "",
    show_bat_block: true,
    repeat: true,
    diagonal: true,
    block_x: 0.68,
    block_y: 0.62,
    block_locked: false,
  };
}

export function normalizeWatermarkConfig(
  value: Partial<WatermarkConfig> | null | undefined,
  fallbackDate = ""
): WatermarkConfig {
  const defaults = createDefaultWatermarkConfig(fallbackDate);
  return {
    ...defaults,
    ...(value || {}),
    block_x: Math.min(1, Math.max(0, Number(value?.block_x ?? defaults.block_x))),
    block_y: Math.min(1, Math.max(0, Number(value?.block_y ?? defaults.block_y))),
  };
}
