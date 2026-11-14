import { CircleAction, isSearchAction } from "@/overlays/protocol.ts";
import type { Point, Rect, Size } from "@/overlays/shapes.ts";
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

// Circle to Search's gesture state machine as a pure reducer (CircleOverlay.cs): what the pointer
// and the keys do to text mode, the buttons and the answer. The loop, the move and the resize are
// winui-svelte's selector, held in `selector`. It touches no window; whatever the outside world
// has to do comes back as effects.
export { CircleAction };
export const CircleHint = {
  readingText: "Reading text…",
  noText: "No text found",
  readFailed: "Couldn't read the text",
  selectText: "Drag across the text to select it  ·  Esc to go back",
  copied: "Copied",
  copyFailed: "Couldn't copy",
  openFailed: "Couldn't open it",
  searchFailed: "Couldn't open the image search  ·  Try again or pick another",
  circle: "Circle anything to search  ·  Esc to cancel",
  circleToAsk: "Circle what Gemini should look at  ·  Esc to cancel"
} as const;

export const CircleCursor = {
  ...SelectionCursor,
  text: "text",
  arrow: "default"
} as const;
export type CircleCursor = typeof CircleCursor[keyof typeof CircleCursor];

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
  pointerDown: "pointerDown",
  pointerMove: "pointerMove",
  pointerUp: "pointerUp",
  escape: "escape",
  cancel: "cancel",
  finish: "finish",
  selectText: "selectText",
  textRead: "textRead",
  textFailed: "textFailed",
  leaveText: "leaveText",
  copy: "copy",
  copyDone: "copyDone",
  searchText: "searchText",
  searchFailed: "searchFailed"
} as const;

export type GestureEvent =
  | {
    readonly kind: typeof GestureEventKind.pointerDown;
    readonly point: Point;
    readonly clickCount: number;
  }
  | {
    readonly kind: typeof GestureEventKind.pointerMove;
    readonly point: Point;
  }
  // The press ended or the pointer capture was lost, either way the gesture is over
  | { readonly kind: typeof GestureEventKind.pointerUp }
  // Esc and the right mouse button
  | { readonly kind: typeof GestureEventKind.escape }
  // Switching away: no stepping back out of text mode first
  | { readonly kind: typeof GestureEventKind.cancel }
  | {
    readonly kind: typeof GestureEventKind.finish;
    readonly action: CircleAction;
  }
  | { readonly kind: typeof GestureEventKind.selectText }
  | {
    readonly kind: typeof GestureEventKind.textRead;
    readonly words: readonly SelectableWord[];
  }
  // OCR failed: said apart from finding no text, as the user can do something about it
  | { readonly kind: typeof GestureEventKind.textFailed }
  | { readonly kind: typeof GestureEventKind.leaveText }
  | { readonly kind: typeof GestureEventKind.copy }
  // Searches the web for the words picked in text mode
  | { readonly kind: typeof GestureEventKind.searchText }
  | {
    readonly kind: typeof GestureEventKind.copyDone;
    readonly isCopied: boolean;
  }
  // The search page did not open: the overlay is usable again and says so
  | { readonly kind: typeof GestureEventKind.searchFailed };

export const GestureEffectKind = {
  cancel: "cancel",
  finish: "finish",
  readText: "readText",
  copyText: "copyText",
  searchText: "searchText",
  say: "say",
  hideHint: "hideHint",
  snapIn: "snapIn",
  setCopyKey: "setCopyKey"
} as const;

export type GestureEffect =
  | { readonly kind: typeof GestureEffectKind.cancel }
  | {
    readonly kind: typeof GestureEffectKind.finish;
    readonly action: CircleAction;
    readonly selection: Rect;
  }
  // OCR the still inside the selection, or all of it when there is none
  | {
    readonly kind: typeof GestureEffectKind.readText;
    readonly selection: Rect | undefined;
  }
  | {
    readonly kind: typeof GestureEffectKind.copyText;
    readonly text: string;
  }
  | {
    readonly kind: typeof GestureEffectKind.searchText;
    readonly text: string;
  }
  | {
    readonly kind: typeof GestureEffectKind.say;
    readonly message: string;
    readonly isLasting: boolean;
  }
  | { readonly kind: typeof GestureEffectKind.hideHint }
  // The new selection lands: the sheen and the brackets' settle
  | {
    readonly kind: typeof GestureEffectKind.snapIn;
    readonly area: Rect;
  }
  // Ctrl+C is held only while words are picked
  | {
    readonly kind: typeof GestureEffectKind.setCopyKey;
    readonly isRegistered: boolean;
  };

export function initialGesture({ screen, isAskOnRelease }: {
  screen: Size;
  isAskOnRelease: boolean;
}) {
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

function retext({ state, text }: {
  state: GestureState;
  text: TextSelectorState;
}) {
  return {
    state: {
      ...state,
      text
    },
    effects: [{
      kind: GestureEffectKind.setCopyKey,
      isRegistered: textSelection(text) !== undefined
    }]
  };
}

// Words are in reading order, so a line's words sit side by side
function lineRange({ words, index }: {
  words: readonly SelectableWord[];
  index: number;
}) {
  const line = words[index]?.line;
  return {
    first: words.findIndex(word => word.line === line),
    last: words.findLastIndex(word => word.line === line)
  };
}

function beginTextSelect({ state, point, clickCount }: {
  state: GestureState;
  point: Point;
  clickCount: number;
}) {
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

function extendTextSelect({ state, point }: {
  state: GestureState;
  point: Point;
}) {
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

function pressDown({ state, point, clickCount }: {
  state: GestureState;
  point: Point;
  clickCount: number;
}) {
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
    effects: isStartingLoop ? [{ kind: GestureEffectKind.hideHint }] : []
  };
}

function pointerMoved({ state, point }: {
  state: GestureState;
  point: Point;
}) {
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
    effects: [{
      kind: GestureEffectKind.snapIn,
      area: drawn
    }]
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

function finish({ state, action }: {
  state: GestureState;
  action: CircleAction;
}) {
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
    effects: [{
      kind: GestureEffectKind.finish,
      action,
      selection
    }]
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
    effects: [...cleared.effects, { kind: GestureEffectKind.hideHint }]
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
    effects: [{ kind: GestureEffectKind.cancel }]
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
        kind: GestureEffectKind.say,
        message: CircleHint.readingText,
        isLasting: true
      },
      {
        kind: GestureEffectKind.readText,
        selection: state.selector.selection
      }
    ]
  };
}

function textWasNotShown({ state, message }: {
  state: GestureState;
  message: string;
}) {
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
      { kind: GestureEffectKind.hideHint },
      {
        kind: GestureEffectKind.say,
        message,
        isLasting: false
      }
    ]
  };
}

function textWasRead({ state, words }: {
  state: GestureState;
  words: readonly SelectableWord[];
}) {
  const isEmpty = words.length === 0;
  if (isEmpty) {
    return textWasNotShown({
      state,
      message: CircleHint.noText
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
      { kind: GestureEffectKind.hideHint },
      {
        kind: GestureEffectKind.say,
        message: CircleHint.selectText,
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
    effects: [{
      kind: GestureEffectKind.say,
      message: CircleHint.searchFailed,
      isLasting: false
    }]
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
    effects: [{
      kind: GestureEffectKind.copyText,
      text: chosen.text
    }]
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
    effects: [{
      kind: GestureEffectKind.searchText,
      text: chosen.text
    }]
  };
}

export function reduceGesture({ state, event }: {
  state: GestureState;
  event: GestureEvent;
}) {
  switch (event.kind) {
    case GestureEventKind.pointerDown:
      return pressDown({
        state,
        point: event.point,
        clickCount: event.clickCount
      });
    case GestureEventKind.pointerMove:
      return pointerMoved({
        state,
        point: event.point
      });
    case GestureEventKind.pointerUp:
      return pressEnded(state);
    case GestureEventKind.escape:
      return escape(state);
    case GestureEventKind.cancel:
      return cancel(state);
    case GestureEventKind.finish:
      return finish({
        state,
        action: event.action
      });
    case GestureEventKind.selectText:
      return requestText(state);
    case GestureEventKind.textRead:
      return textWasRead({
        state,
        words: event.words
      });
    case GestureEventKind.textFailed:
      return textWasNotShown({
        state,
        message: CircleHint.readFailed
      });
    case GestureEventKind.leaveText:
      return leaveText(state);
    case GestureEventKind.copy:
      return copyPicked(state);
    case GestureEventKind.searchText:
      return searchPicked(state);
    case GestureEventKind.searchFailed:
      return searchWasNotOpened(state);
    case GestureEventKind.copyDone:
      return {
        state,
        effects: [{
          kind: GestureEffectKind.say,
          message: event.isCopied ? CircleHint.copied : CircleHint.copyFailed,
          isLasting: false
        }]
      };
  }
}

// A diagonal resize arrow over a corner, the four-way move arrow over the rest of the selection,
// the drawing cross everywhere else; in text mode an I-beam over a word
export function hoverCursor({ state, point }: {
  state: GestureState;
  point: Point;
}) {
  if (state.isTextMode) {
    const isOnWord = wordAt({
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
