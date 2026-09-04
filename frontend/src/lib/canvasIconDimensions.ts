export const MIN_CANVAS_ICON_DIMENSION = 15;
export const MAX_CANVAS_ICON_DIMENSION = 1000;
export const MIN_CANVAS_LEADER_WIDTH = 0.5;
export const MAX_CANVAS_LEADER_WIDTH = 12;
export const DEFAULT_CANVAS_LEADER_WIDTH = 2;

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

/**
 * Fit a pictogram box to its artwork ratio while keeping the dragged size.
 * The longest requested side drives the result, then both minimum and maximum
 * limits are applied together so clamping can never deform the artwork.
 */
export function normalizeCanvasIconSizeToAspectRatio(
  width: unknown,
  height: unknown,
  aspectRatio: unknown,
  fallback: { width: number; height: number } = {
    width: MIN_CANVAS_ICON_DIMENSION,
    height: MIN_CANVAS_ICON_DIMENSION,
  }
): { width: number; height: number } {
  const fallbackWidth = normalizeCanvasIconDimension(fallback.width);
  const fallbackHeight = normalizeCanvasIconDimension(fallback.height);
  const numericRatio = Number(aspectRatio);
  const fallbackRatio = fallbackWidth / Math.max(1, fallbackHeight);
  const safeRatio = Number.isFinite(numericRatio) && numericRatio > 0
    ? Math.min(
        MAX_CANVAS_ICON_DIMENSION / MIN_CANVAS_ICON_DIMENSION,
        Math.max(
          MIN_CANVAS_ICON_DIMENSION / MAX_CANVAS_ICON_DIMENSION,
          numericRatio,
        ),
      )
    : fallbackRatio;
  const numericWidth = Number(width);
  const numericHeight = Number(height);
  const requestedLongSide = Math.max(
    Number.isFinite(numericWidth) ? Math.abs(numericWidth) : fallbackWidth,
    Number.isFinite(numericHeight) ? Math.abs(numericHeight) : fallbackHeight,
  );
  const minimumLongSide = safeRatio >= 1
    ? MIN_CANVAS_ICON_DIMENSION * safeRatio
    : MIN_CANVAS_ICON_DIMENSION / safeRatio;
  const longSide = Math.min(
    MAX_CANVAS_ICON_DIMENSION,
    Math.max(minimumLongSide, requestedLongSide),
  );

  if (safeRatio >= 1) {
    return {
      width: Math.round(longSide),
      height: Math.round(longSide / safeRatio),
    };
  }
  return {
    width: Math.round(longSide * safeRatio),
    height: Math.round(longSide),
  };
}

export function normalizeCanvasLeaderWidth(
  value: unknown,
  fallback: number = DEFAULT_CANVAS_LEADER_WIDTH
): number {
  const numericValue = Number(value);
  const numericFallback = Number(fallback);
  const safeFallback = Number.isFinite(numericFallback)
    ? Math.min(MAX_CANVAS_LEADER_WIDTH, Math.max(MIN_CANVAS_LEADER_WIDTH, numericFallback))
    : DEFAULT_CANVAS_LEADER_WIDTH;

  if (!Number.isFinite(numericValue)) return safeFallback;

  return Math.min(
    MAX_CANVAS_LEADER_WIDTH,
    Math.max(MIN_CANVAS_LEADER_WIDTH, Math.round(numericValue * 2) / 2)
  );
}
