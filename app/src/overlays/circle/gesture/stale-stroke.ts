import { SelectionPhase } from "winui-svelte/selection";
import type { SelectorState } from "winui-svelte/selection";

// The loop belongs to the drawing: only a loop being drawn, or one still fading after release,
// may show. A selection that moves or resizes, or whose loop has faded, keeps no stroke
export function withoutStaleStroke({ state, isStrokeFaded }: {
  state: SelectorState;
  isStrokeFaded: boolean;
}) {
  const isDrawing = state.phase === SelectionPhase.draw;
  const isFading = state.phase === SelectionPhase.idle && !isStrokeFaded;
  const isShown = isDrawing || isFading;
  if (isShown) {
    return state;
  }

  return {
    ...state,
    stroke: []
  };
}
