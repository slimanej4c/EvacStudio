export const MIN_CANVAS_ICON_DIMENSION = 15;
export const MAX_CANVAS_ICON_DIMENSION = 1000;

/**
 * Keep pictogram dimensions usable even when a number input is cleared or a
 * Transformer briefly reports an invalid/very large scale.
 */
export function normalizeCanvasIconDimension(
  value: unknown,
  fallback: number = MIN_CANVAS_ICON_DIMENSION
): number {
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber)
    ? Math.min(
        MAX_CANVAS_ICON_DIMENSION,
        Math.max(MIN_CANVAS_ICON_DIMENSION, Math.round(fallbackNumber))
      )
    : MIN_CANVAS_ICON_DIMENSION;
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) return safeFallback;

  return Math.min(
    MAX_CANVAS_ICON_DIMENSION,
    Math.max(MIN_CANVAS_ICON_DIMENSION, Math.round(numericValue))
  );
}

/**
 * A wildly oversized Transformer value is generally a transient Konva scale
 * glitch. Preserve the last valid dimension instead of snapping to 1000 px.
 */
export function normalizeTransformedCanvasIconDimension(
  value: unknown,
  previousValue: number
): number {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue > MAX_CANVAS_ICON_DIMENSION) {
    return normalizeCanvasIconDimension(previousValue);
  }

  return normalizeCanvasIconDimension(numericValue, previousValue);
}
