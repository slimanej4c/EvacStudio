/**
 * Konva can still paint a transparent fill into its hidden hit canvas. Treat
 * every visually empty paint as no fill so pointer events pass to layers below.
 */
export function hasVisibleShapeFill(
  fill: string | null | undefined,
  opacity: number | null | undefined = 1
): fill is string {
  if (!fill || (opacity ?? 1) <= 0) return false;

  const normalized = fill.trim().toLowerCase().replace(/\s+/g, "");
  if (!normalized || normalized === "none" || normalized === "transparent") return false;

  const rgba = normalized.match(/^rgba\([^,]+,[^,]+,[^,]+,([^)]+)\)$/);
  if (rgba && Number(rgba[1]) <= 0) return false;

  // CSS eight-digit hex: the final byte is alpha.
  if (/^#[0-9a-f]{8}$/.test(normalized) && normalized.endsWith("00")) return false;

  return true;
}

/** Keep a thin contour easy to grab without changing its visible thickness. */
export function shapeHitStrokeWidth(strokeWidth: number, interactionScale = 1): number {
  if (strokeWidth <= 0) return 0;
  return Math.max(24, strokeWidth + 18) / Math.max(interactionScale, 0.05);
}
