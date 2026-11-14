// Where Circle to Search stands, derived from the two facts that decide it: whether the overlay is
// open (the session owns that) and whether Gemini is restricted to a circled region (the engine's
// region owns that)
export const CirclePhase = {
  OVERLAY_OPEN: "overlayOpen",
  REGION_FOCUSED: "regionFocused",
  IDLE: "idle"
} as const;
export type CirclePhase = (typeof CirclePhase)[keyof typeof CirclePhase];

// What Win+Alt+C (and the pill's button) does in each phase
export const CircleToggleAction = {
  CANCEL_OVERLAY: "cancelOverlay",
  FOCUS_WHOLE_DISPLAY: "focusWholeDisplay",
  START_CIRCLE: "startCircle"
} as const;

export function circlePhase({ isOverlayOpen, isRegionFocused }: { isOverlayOpen: boolean; isRegionFocused: boolean }) {
  if (isOverlayOpen) {
    return CirclePhase.OVERLAY_OPEN;
  }

  if (isRegionFocused) {
    return CirclePhase.REGION_FOCUSED;
  }

  return CirclePhase.IDLE;
}

export function circleToggle(phase: CirclePhase) {
  switch (phase) {
    case CirclePhase.OVERLAY_OPEN:
      return CircleToggleAction.CANCEL_OVERLAY;
    case CirclePhase.REGION_FOCUSED:
      return CircleToggleAction.FOCUS_WHOLE_DISPLAY;
    case CirclePhase.IDLE:
      return CircleToggleAction.START_CIRCLE;
  }
}
