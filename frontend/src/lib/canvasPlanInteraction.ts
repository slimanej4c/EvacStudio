export interface MainPlanPointerContext {
  areaSelectionMode: boolean;
  sheetActive: boolean;
  mainPlanLocked: boolean;
}

/**
 * The plan itself stays hit-testable on a sheet so its draggable placement
 * group can receive reframe gestures. Outside a sheet, a locked plan lets
 * pointer events pass through to the marquee selection instead.
 */
export function shouldMainPlanReceivePointerEvents({
  areaSelectionMode,
  sheetActive,
  mainPlanLocked,
}: MainPlanPointerContext): boolean {
  return !areaSelectionMode && (sheetActive || !mainPlanLocked);
}
