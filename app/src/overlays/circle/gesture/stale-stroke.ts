import { SelectionPhase } from "winui-svelte/selection";
import type { SelectorState } from "winui-svelte/selection";

// The loop belongs to the drawing: only a loop being drawn may show. The moment it is released the
// selection takes its place, so the loop goes at once rather than lingering under the region. The
// overlay repaints a stroke it is handed but ignores an empty one, so what replaces the loop is one
// point beyond the screen
const OFF_SCREEN = -10_000;
export function withoutStaleStroke(state: SelectorState) {
  const isDrawing = state.phase === SelectionPhase.draw;
  if (isDrawing) {
    return state;
  }

  return {
    ...state,
    stroke: [
      {
        x: OFF_SCREEN,
        y: OFF_SCREEN
      }
    ]
  };
}
