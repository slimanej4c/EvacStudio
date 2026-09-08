import type { CanvasIcon, CanvasShape, CanvasText, CanvasPlanOverlay } from "@/components/PlanCanvas";
import type { SheetBlock } from "@/lib/sheetTemplates";

interface EditorSnapshotState {
  icons: CanvasIcon[];
  shapes: CanvasShape[];
  texts: CanvasText[];
  overlays: CanvasPlanOverlay[];
  sheetBlocks?: SheetBlock[];
  eraseStrokeCount?: number;
  eraseRevision?: number;
  [key: string]: unknown;
}

/** Shared by initial loading and saving so both compare the same persisted fields. */
export function createEditorSnapshot(state: EditorSnapshotState): string {
  const normalized = {
    ...state,
    icons: state.icons.map(({ icon_type, x, y, width, height, rotation, label, anchor_x, anchor_y, leader_points, leader_width, leader_dot_size, leader_color, framed, flip_x, flip_y, lock_aspect_ratio, locked, visible, z_index, group_id, object_group_id, color }) => ({
      icon_type, x, y, width, height, rotation, label, anchor_x, anchor_y, leader_points, leader_width,
      leader_dot_size: leader_dot_size ?? 1, leader_color: leader_color || "", framed, flip_x, flip_y,
      lock_aspect_ratio: lock_aspect_ratio ?? true, locked, visible, z_index, group_id, object_group_id, color,
    })),
    shapes: state.shapes.map(({ shape_type, x, y, width, height, rotation, stroke_width, color, fill_color, fill_opacity, tension, control_points, points, closed, straight_segments, locked, visible, z_index, group_id, object_group_id, is_scale_calibration, calibration_real_distance_m }) => ({
      shape_type, x, y, width, height, rotation, stroke_width, color, fill_color, fill_opacity, tension, control_points, points, closed, straight_segments, locked, visible, z_index, group_id, object_group_id, is_scale_calibration, calibration_real_distance_m,
    })),
    texts: state.texts.map(({ text, x, y, font_size, font_family, align, color, bold, italic, background_color, rotation, locked, visible, z_index, group_id, object_group_id }) => ({
      text, x, y, font_size, font_family, align, color, bold, italic, background_color, rotation, locked, visible, z_index, group_id, object_group_id,
    })),
    overlays: state.overlays.map(({ url, x, y, width, height, rotation, label, locked, visible, z_index, group_id }) => ({
      url, x, y, width, height, rotation, label, locked, visible, z_index, group_id,
    })),
    sheetBlocks: state.sheetBlocks ?? [],
    eraseStrokeCount: state.eraseStrokeCount ?? 0,
    eraseRevision: state.eraseRevision ?? 0,
  };
  return JSON.stringify(Object.fromEntries(Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b))));
}

/** Match acknowledgements to the submitted overlays, even if the user reordered them. */
export function reconcileSavedOverlays(
  current: CanvasPlanOverlay[],
  submitted: CanvasPlanOverlay[],
  saved: { overlay_ids?: number[]; overlays?: { id: number; is_original?: boolean; can_revert_original?: boolean }[] },
): CanvasPlanOverlay[] {
  const submittedById = new Map(submitted.map((overlay, index) => [overlay.tempId, { overlay, index }]));
  return current.map((overlay) => {
    const sent = submittedById.get(overlay.tempId);
    if (!sent) return overlay;
    const serverId = saved.overlay_ids?.[sent.index] ?? overlay.serverId;
    const savedOverlay = saved.overlays?.find((item) => item.id === serverId);
    const sameImage = overlay.url === sent.overlay.url;
    return {
      ...overlay,
      serverId,
      imageChanged: sameImage ? false : overlay.imageChanged,
      isOriginal: sameImage ? savedOverlay?.is_original ?? overlay.isOriginal : overlay.isOriginal,
      canRevertOriginal: savedOverlay?.can_revert_original ?? overlay.canRevertOriginal,
    };
  });
}
