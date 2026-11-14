import {
  createSelector,
  createTextSelector,
  rectangleFromPoints,
  reduceSelector,
  reduceTextSelector,
  SelectionCursor,
  SelectionPhase,
  hoverCursor as selectorCursor,
  SelectorEventKind,
  textSelection,
  wordAt,
  wordsInRegion
} from "winui-svelte/selection";
import type { SelectableWord, SelectorState, TextSelectorState } from "winui-svelte/selection";

import { CircleAction, isSearchAction } from "@/overlays/protocol.ts";
import type { Point, Rect, Size } from "@/overlays/shapes.ts";

// Circle to Search's gesture state machine as a pure reducer (CircleOverlay.cs): what the pointer
// and the keys do to text mode, the buttons and the answer. The loop, the move and the resize are
// winui-svelte's selector, held in `selector`. It touches no window; whatever the outside world
// has to do comes back as effects.
export { CircleAction };
export const CircleHint = {
  READING_TEXT: "Reading text…",
  NO_TEXT: "No text found",
  READ_FAILED: "Couldn't read the text",
  SELECT_TEXT: "Drag across the text to select it  ·  Esc to go back",
  COPIED: "Copied",
  COPY_FAILED: "Couldn't copy",
  OPEN_FAILED: "Couldn't open it",
  SEARCH_FAILED: "Couldn't open the image search  ·  Try again or pick another",
  CIRCLE: "Circle anything to search  ·  Esc to cancel",
  CIRCLE_TO_ASK: "Circle what Gemini should look at  ·  Esc to cancel"
} as const;

export const CircleCursor = {
  ...SelectionCursor,
  text: "text",
  arrow: "default"
} as const;
export type CircleCursor = (typeof CircleCursor)[keyof typeof CircleCursor];

// Three presses in a row select a whole line
export const LINE_CLICK_COUNT = 3;

export interface GestureState {
  // The loop, the selection and its move and resize
  readonly selector: SelectorState;
  // Gemini Live is already running: no buttons, the first loop is the answer
  readonly isAskOnRelease: boolean;
  readonly isFinished: boolean;
  // An answer that searches the web was sent and has not come back: finished, but it can still fail
  readonly isSearching: boolean;
  readonly isReading: boolean;
  readonly isTextMode: boolean;
  // A press in text mode is down: a word drag or a rubber band
  readonly isSelectingText: boolean;
  // The OCR words and the run the user picked among them (winui-svelte's text selector)
  readonly text: TextSelectorState;
  // Where a press in empty space began: the drag is then a rubber band
  readonly textOrigin: Point | undefined;
  readonly band: Rect | undefined;
}

export const GestureEventKind = {
  POINTER_DOWN: "pointerDown",
  POINTER_MOVE: "pointerMove",
  POINTER_UP: "pointerUp",
  ESCAPE: "escape",
  CANCEL: "cancel",
  FINISH: "finish",
  SELECT_TEXT: "selectText",
  TEXT_READ: "textRead",
  TEXT_FAILED: "textFailed",
  LEAVE_TEXT: "leaveText",
  COPY: "copy",
  COPY_DONE: "copyDone",
  SEARCH_TEXT: "searchText",
  SEARCH_FAILED: "searchFailed"
} as const;

export type GestureEvent =
  | {
      readonly kind: typeof GestureEventKind.POINTER_DOWN;
      readonly point: Point;
      readonly clickCount: number;
    }
  | {
      readonly kind: typeof GestureEventKind.POINTER_MOVE;
      readonly point: Point;
    }
  // The press ended or the pointer capture was lost, either way the gesture is over
  | { readonly kind: typeof GestureEventKind.POINTER_UP }
  // Esc and the right mouse button
  | { readonly kind: typeof GestureEventKind.ESCAPE }
  // Switching away: no stepping back out of text mode first
  | { readonly kind: typeof GestureEventKind.CANCEL }
  | {
      readonly kind: typeof GestureEventKind.FINISH;
      readonly action: CircleAction;
    }
  | { readonly kind: typeof GestureEventKind.SELECT_TEXT }
  | {
      readonly kind: typeof GestureEventKind.TEXT_READ;
      readonly words: readonly SelectableWord[];
    }
  // OCR failed: said apart from finding no text, as the user can do something about it
  | { readonly kind: typeof GestureEventKind.TEXT_FAILED }
  | { readonly kind: typeof GestureEventKind.LEAVE_TEXT }
  | { readonly kind: typeof GestureEventKind.COPY }
  // Searches the web for the words picked in text mode
  | { readonly kind: typeof GestureEventKind.SEARCH_TEXT }
  | {
      readonly kind: typeof GestureEventKind.COPY_DONE;
      readonly isCopied: boolean;
    }
  // The search page did not open: the overlay is usable again and says so
  | { readonly kind: typeof GestureEventKind.SEARCH_FAILED };

export const GestureEffectKind = {
  CANCEL: "cancel",
  FINISH: "finish",
  READ_TEXT: "readText",
  COPY_TEXT: "copyText",
  SEARCH_TEXT: "searchText",
  SAY: "say",
  HIDE_HINT: "hideHint",
  SNAP_IN: "snapIn",
  SET_COPY_KEY: "setCopyKey"
} as const;

export type GestureEffect =
  | { readonly kind: typeof GestureEffectKind.CANCEL }
  | {
      readonly kind: typeof GestureEffectKind.FINISH;
      readonly action: CircleAction;
      readonly selection: Rect;
    }
  // OCR the still inside the selection, or all of it when there is none
  | {
      readonly kind: typeof GestureEffectKind.READ_TEXT;
      readonly selection: Rect | undefined;
    }
  | {
      readonly kind: typeof GestureEffectKind.COPY_TEXT;
      readonly text: string;
    }
  | {
      readonly kind: typeof GestureEffectKind.SEARCH_TEXT;
      readonly text: string;
    }
  | {
      readonly kind: typeof GestureEffectKind.SAY;
      readonly message: string;
      readonly isLasting: boolean;
    }
  | { readonly kind: typeof GestureEffectKind.HIDE_HINT }
  // The new selection lands: the sheen and the brackets' settle
  | {
      readonly kind: typeof GestureEffectKind.SNAP_IN;
      readonly area: Rect;
    }
  // Ctrl+C is held only while words are picked
  | {
      readonly kind: typeof GestureEffectKind.SET_COPY_KEY;
      readonly isRegistered: boolean;
    };

export function initialGesture({ screen, isAskOnRelease }: { screen: Size; isAskOnRelease: boolean }) {
  return {
    selector: createSelector({ bounds: screen }),
    isAskOnRelease,
    isFinished: false,
    isSearching: false,
    isReading: false,
    isTextMode: false,
    isSelectingText: false,
    text: createTextSelector([]),
    textOrigin: undefined,
    band: undefined
  };
}

function stay(state: GestureState) {
  return {
    state,
    effects: []
  };
}

// The words the user picked, in reading order
export function pickedWords(state: GestureState) {
  const chosen = textSelection(state.text);
  const isNothing = chosen === undefined;
  if (isNothing) {
    return [];
  }

  return state.text.words.slice(chosen.range.start, chosen.range.end + 1);
}

function retext({ state, text }: { state: GestureState; text: TextSelectorState }) {
  return {
    state: {
      ...state,
      text
    },
    effects: [
      {
        kind: GestureEffectKind.SET_COPY_KEY,
        isRegistered: textSelection(text) !== undefined
      }
    ]
  };
}

// Words are in reading order, so a line's words sit side by side
function lineRange({ words, index }: { words: readonly SelectableWord[]; index: number }) {
  const line = words[index]?.line;
  return {
    first: words.findIndex(word => word.line === line),
    last: words.findLastIndex(word => word.line === line)
  };
}

function beginTextSelect({ state, point, clickCount }: { state: GestureState; point: Point; clickCount: number }) {
  const pressed = reduceTextSelector({
    state: state.text,
    event: {
      kind: SelectorEventKind.pointerDown,
      point
    }
  });
  const isEmptySpace = pressed.anchor === undefined;
  const begun = {
    ...state,
    isSelectingText: true,
    textOrigin: isEmptySpace ? point : undefined
  };
  const isLine = !isEmptySpace && clickCount >= LINE_CLICK_COUNT;
  if (isLine) {
    const { first, last } = lineRange({
      words: pressed.words,
      index: pressed.anchor
    });
    return retext({
      state: begun,
      text: {
        ...pressed,
        anchor: first,
        focus: last,
        isDragging: false
      }
    });
  }

  return retext({
    state: begun,
    text: pressed
  });
}

function extendTextSelect({ state, point }: { state: GestureState; point: Point }) {
  const isBandDrag = state.textOrigin !== undefined;
  if (isBandDrag) {
    const band = rectangleFromPoints({
      first: state.textOrigin,
      second: point
    });
    const inside = wordsInRegion({
      words: state.text.words,
      region: band
    });
    return retext({
      state: {
        ...state,
        band
      },
      text: {
        ...state.text,
        anchor: inside.at(0),
        focus: inside.at(-1)
      }
    });
  }

  return retext({
    state,
    text: reduceTextSelector({
      state: state.text,
      event: {
        kind: SelectorEventKind.pointerMove,
        point
      }
    })
  });
}

function pressDown({ state, point, clickCount }: { state: GestureState; point: Point; clickCount: number }) {
  const isIgnored = state.isFinished || state.isReading;
  if (isIgnored) {
    return stay(state);
  }

  if (state.isTextMode) {
    return beginTextSelect({
      state,
      point,
      clickCount
    });
  }

  const selector = reduceSelector({
    state: state.selector,
    event: {
      kind: SelectorEventKind.pointerDown,
      point
    }
  });
  const isStartingLoop = selector.phase === SelectionPhase.draw;
  return {
    state: {
      ...state,
      selector
    },
    effects: isStartingLoop ? [{ kind: GestureEffectKind.HIDE_HINT }] : []
  };
}

function pointerMoved({ state, point }: { state: GestureState; point: Point }) {
  if (state.isSelectingText) {
    return extendTextSelect({
      state,
      point
    });
  }

  return stay({
    ...state,
    selector: reduceSelector({
      state: state.selector,
      event: {
        kind: SelectorEventKind.pointerMove,
        point
      }
    })
  });
}

// The loop fades either way; one big enough becomes the selection, a smaller one is ignored and
// drawing simply carries on. With isAskOnRelease the loop itself is the request
function endStroke(state: GestureState) {
  const drawn = state.selector.selection;
  const isTooSmall = drawn === undefined;
  if (isTooSmall) {
    return stay(state);
  }

  if (state.isAskOnRelease) {
    return finish({
      state,
      action: CircleAction.askGemini
    });
  }

  return {
    state,
    effects: [
      {
        kind: GestureEffectKind.SNAP_IN,
        area: drawn
      }
    ]
  };
}

function pressEnded(state: GestureState) {
  if (state.isSelectingText) {
    return stay({
      ...state,
      text: reduceTextSelector({
        state: state.text,
        event: {
          kind: SelectorEventKind.pointerUp
        }
      }),
      isSelectingText: false,
      textOrigin: undefined,
      band: undefined
    });
  }

  const isEndingDraw = state.selector.phase === SelectionPhase.draw;
  const released = {
    ...state,
    selector: reduceSelector({
      state: state.selector,
      event: {
        kind: SelectorEventKind.pointerUp
      }
    })
  };
  if (isEndingDraw) {
    return endStroke(released);
  }

  return stay(released);
}

function finish({ state, action }: { state: GestureState; action: CircleAction }) {
  const { selection } = state.selector;
  const isUnanswerable = state.isFinished || selection === undefined;
  if (isUnanswerable) {
    return stay(state);
  }

  return {
    state: {
      ...state,
      isFinished: true,
      isSearching: isSearchAction(action)
    },
    effects: [
      {
        kind: GestureEffectKind.FINISH,
        action,
        selection
      }
    ]
  };
}

function leaveText(state: GestureState) {
  if (!state.isTextMode) {
    return stay(state);
  }

  const cleared = retext({
    state: {
      ...state,
      isTextMode: false,
      band: undefined
    },
    text: createTextSelector([])
  });
  return {
    state: cleared.state,
    effects: [...cleared.effects, { kind: GestureEffectKind.HIDE_HINT }]
  };
}

function cancel(state: GestureState) {
  if (state.isFinished) {
    return stay(state);
  }

  return {
    state: {
      ...state,
      isFinished: true
    },
    effects: [{ kind: GestureEffectKind.CANCEL }]
  };
}

// Esc, one step at a time: in text mode first clears the selected words, then leaves text mode;
// anywhere else it cancels
function escape(state: GestureState) {
  if (!state.isTextMode) {
    return cancel(state);
  }

  const hasPicked = textSelection(state.text) !== undefined;
  if (hasPicked) {
    return retext({
      state,
      text: createTextSelector(state.text.words)
    });
  }

  return leaveText(state);
}

function requestText(state: GestureState) {
  const isIgnored = state.isAskOnRelease || state.isFinished || state.isReading || state.isTextMode;
  if (isIgnored) {
    return stay(state);
  }

  return {
    state: {
      ...state,
      isReading: true
    },
    effects: [
      {
        kind: GestureEffectKind.SAY,
        message: CircleHint.READING_TEXT,
        isLasting: true
      },
      {
        kind: GestureEffectKind.READ_TEXT,
        selection: state.selector.selection
      }
    ]
  };
}

function textWasNotShown({ state, message }: { state: GestureState; message: string }) {
  const reading = {
    ...state,
    isReading: false
  };
  if (state.isFinished) {
    return stay(reading);
  }

  return {
    state: reading,
    effects: [
      { kind: GestureEffectKind.HIDE_HINT },
      {
        kind: GestureEffectKind.SAY,
        message,
        isLasting: false
      }
    ]
  };
}

function textWasRead({ state, words }: { state: GestureState; words: readonly SelectableWord[] }) {
  const isEmpty = words.length === 0;
  if (isEmpty) {
    return textWasNotShown({
      state,
      message: CircleHint.NO_TEXT
    });
  }

  const reading = {
    ...state,
    isReading: false
  };
  if (state.isFinished) {
    return stay(reading);
  }

  return {
    state: {
      ...reading,
      isTextMode: true,
      text: createTextSelector(words)
    },
    effects: [
      { kind: GestureEffectKind.HIDE_HINT },
      {
        kind: GestureEffectKind.SAY,
        message: CircleHint.SELECT_TEXT,
        isLasting: false
      }
    ]
  };
}

function searchWasNotOpened(state: GestureState) {
  if (!state.isSearching) {
    return stay(state);
  }

  return {
    state: {
      ...state,
      isFinished: false,
      isSearching: false
    },
    effects: [
      {
        kind: GestureEffectKind.SAY,
        message: CircleHint.SEARCH_FAILED,
        isLasting: false
      }
    ]
  };
}

function copyPicked(state: GestureState) {
  const chosen = textSelection(state.text);
  const isNothingToCopy = !state.isTextMode || chosen === undefined;
  if (isNothingToCopy) {
    return stay(state);
  }

  return {
    state,
    effects: [
      {
        kind: GestureEffectKind.COPY_TEXT,
        text: chosen.text
      }
    ]
  };
}

function searchPicked(state: GestureState) {
  const chosen = textSelection(state.text);
  const isNothingToSearch = !state.isTextMode || chosen === undefined;
  if (isNothingToSearch) {
    return stay(state);
  }

  return {
    state,
    effects: [
      {
        kind: GestureEffectKind.SEARCH_TEXT,
        text: chosen.text
      }
    ]
  };
}

export function reduceGesture({ state, event }: { state: GestureState; event: GestureEvent }) {
  switch (event.kind) {
    case GestureEventKind.POINTER_DOWN:
      return pressDown({
        state,
        point: event.point,
        clickCount: event.clickCount
      });
    case GestureEventKind.POINTER_MOVE:
      return pointerMoved({
        state,
        point: event.point
      });
    case GestureEventKind.POINTER_UP:
      return pressEnded(state);
    case GestureEventKind.ESCAPE:
      return escape(state);
    case GestureEventKind.CANCEL:
      return cancel(state);
    case GestureEventKind.FINISH:
      return finish({
        state,
        action: event.action
      });
    case GestureEventKind.SELECT_TEXT:
      return requestText(state);
    case GestureEventKind.TEXT_READ:
      return textWasRead({
        state,
        words: event.words
      });
    case GestureEventKind.TEXT_FAILED:
      return textWasNotShown({
        state,
        message: CircleHint.READ_FAILED
      });
    case GestureEventKind.LEAVE_TEXT:
      return leaveText(state);
    case GestureEventKind.COPY:
      return copyPicked(state);
    case GestureEventKind.SEARCH_TEXT:
      return searchPicked(state);
    case GestureEventKind.SEARCH_FAILED:
      return searchWasNotOpened(state);
    case GestureEventKind.COPY_DONE:
      return {
        state,
        effects: [
          {
            kind: GestureEffectKind.SAY,
            message: event.isCopied ? CircleHint.COPIED : CircleHint.COPY_FAILED,
            isLasting: false
          }
        ]
      };
  }
}

// A diagonal resize arrow over a corner, the four-way move arrow over the rest of the selection,
// the drawing cross everywhere else; in text mode an I-beam over a word
export function hoverCursor({ state, point }: { state: GestureState; point: Point }) {
  if (state.isTextMode) {
    const isOnWord =
      wordAt({
        words: state.text.words,
        point
      }) !== undefined;
    return isOnWord ? CircleCursor.text : CircleCursor.arrow;
  }

  return selectorCursor({
    state: state.selector,
    point
  });
}
