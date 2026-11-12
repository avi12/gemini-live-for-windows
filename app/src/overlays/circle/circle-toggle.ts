// Where Circle to Search stands, derived from the two facts that decide it: whether the overlay is
// open (the session owns that) and whether Gemini is restricted to a circled region (the engine's
// region owns that)
export const CirclePhase = {
  overlayOpen: "overlayOpen",
  regionFocused: "regionFocused",
  idle: "idle"
} as const;
export type CirclePhase = typeof CirclePhase[keyof typeof CirclePhase];

// What Win+Alt+C (and the pill's button) does in each phase
export const CircleToggleAction = {
  cancelOverlay: "cancelOverlay",
  focusWholeDisplay: "focusWholeDisplay",
  startCircle: "startCircle"
} as const;

export function circlePhase({ isOverlayOpen, isRegionFocused }: {
  isOverlayOpen: boolean;
  isRegionFocused: boolean;
}) {
  if (isOverlayOpen) {
    return CirclePhase.overlayOpen;
  }

  if (isRegionFocused) {
    return CirclePhase.regionFocused;
  }

  return CirclePhase.idle;
}

export function circleToggle(phase: CirclePhase) {
  switch (phase) {
    case CirclePhase.overlayOpen:
      return CircleToggleAction.cancelOverlay;
    case CirclePhase.regionFocused:
      return CircleToggleAction.focusWholeDisplay;
    case CirclePhase.idle:
      return CircleToggleAction.startCircle;
  }
}
