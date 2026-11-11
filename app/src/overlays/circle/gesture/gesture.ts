import {
  joinWords,
  wordAt,
  wordsBetween,
  wordsIn,
  wordsOnLine
} from "@/overlays/circle/gesture/geometry.ts";
import type { TextWord } from "@/overlays/circle/gesture/geometry.ts";
import { CircleAction } from "@/overlays/protocol.ts";
import type { Point, Rect, Size } from "@/overlays/shapes.ts";
import {
  createSelector,
  rectangleFromPoints,
  reduceSelector,
  SelectionCursor,
  SelectionPhase,
  hoverCursor as selectorCursor,
  SelectorEventKind
} from "winui-svelte/selection";
import type { SelectorState } from "winui-svelte/selection";

// Circle to Search's gesture state machine as a pure reducer (CircleOverlay.cs): what the pointer
// and the keys do to text mode, the buttons and the answer. The loop, the move and the resize are
// winui-svelte's selector, held in `selector`. It touches no window; whatever the outside world
// has to do comes back as effects.
export { CircleAction };
export const CircleHint = {
  readingText: "Reading text…",
  noText: "No text found",
  selectText: "Drag across the text to select it  ·  Esc to go back",
  copied: "Copied",
  copyFailed: "Couldn't copy",
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
const NO_WORD = -1;

export interface GestureState {
  // The loop, the selection and its move and resize
  readonly selector: SelectorState;
  // Gemini Live is already running: no buttons, the first loop is the answer
  readonly isAskOnRelease: boolean;
  readonly isFinished: boolean;
  readonly isReading: boolean;
  readonly isTextMode: boolean;
  // A press in text mode is down: a word drag or a rubber band
  readonly isSelectingText: boolean;
  readonly words: readonly TextWord[];
  readonly picked: readonly number[];
  readonly textOrigin: Point | undefined;
  // The word a text drag began on, or -1 for empty space (the drag is then a rubber band)
  readonly textAnchor: number;
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
  leaveText: "leaveText",
  copy: "copy",
  copyDone: "copyDone"
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
    readonly words: readonly TextWord[];
  }
  | { readonly kind: typeof GestureEventKind.leaveText }
  | { readonly kind: typeof GestureEventKind.copy }
  | {
    readonly kind: typeof GestureEventKind.copyDone;
    readonly isCopied: boolean;
  };

export const GestureEffectKind = {
  cancel: "cancel",
  finish: "finish",
  readText: "readText",
  copyText: "copyText",
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
    isReading: false,
    isTextMode: false,
    isSelectingText: false,
    words: [],
    picked: [],
    textOrigin: undefined,
    textAnchor: NO_WORD,
    band: undefined
  };
}

function stay(state: GestureState) {
  return {
    state,
    effects: []
  };
}

function pick({ state, picked }: {
  state: GestureState;
  picked: readonly number[];
}) {
  return {
    state: {
      ...state,
      picked
    },
    effects: [{
      kind: GestureEffectKind.setCopyKey,
      isRegistered: picked.length > 0
    }]
  };
}

function beginTextSelect({ state, point, clickCount }: {
  state: GestureState;
  point: Point;
  clickCount: number;
}) {
  const textAnchor = wordAt({
    words: state.words,
    point
  });
  const begun = {
    ...state,
    isSelectingText: true,
    textOrigin: point,
    textAnchor
  };
  const isEmptySpace = textAnchor === NO_WORD;
  if (isEmptySpace) {
    return pick({
      state: begun,
      picked: []
    });
  }

  const isLine = clickCount >= LINE_CLICK_COUNT;
  if (isLine) {
    return pick({
      state: begun,
      picked: wordsOnLine({
        words: state.words,
        index: textAnchor
      })
    });
  }

  return pick({
    state: begun,
    picked: wordsBetween({
      first: textAnchor,
      second: textAnchor
    })
  });
}

function extendTextSelect({ state, point }: {
  state: GestureState;
  point: Point;
}) {
  const isBand = state.textAnchor === NO_WORD;
  const isBandDrag = isBand && state.textOrigin !== undefined;
  if (isBandDrag) {
    const band = rectangleFromPoints({
      first: state.textOrigin,
      second: point
    });
    return pick({
      state: {
        ...state,
        band
      },
      picked: wordsIn({
        words: state.words,
        area: band
      })
    });
  }

  const current = wordAt({
    words: state.words,
    point
  });
  const isOverNoWord = current === NO_WORD;
  if (isOverNoWord) {
    return stay(state);
  }

  return pick({
    state,
    picked: wordsBetween({
      first: state.textAnchor,
      second: current
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
      isSelectingText: false,
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
      isFinished: true
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

  const cleared = pick({
    state: {
      ...state,
      isTextMode: false,
      words: [],
      band: undefined
    },
    picked: []
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

  const hasPicked = state.picked.length > 0;
  if (hasPicked) {
    return pick({
      state,
      picked: []
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

function textWasRead({ state, words }: {
  state: GestureState;
  words: readonly TextWord[];
}) {
  const reading = {
    ...state,
    isReading: false
  };
  if (state.isFinished) {
    return stay(reading);
  }

  const isEmpty = words.length === 0;
  if (isEmpty) {
    return {
      state: reading,
      effects: [
        { kind: GestureEffectKind.hideHint },
        {
          kind: GestureEffectKind.say,
          message: CircleHint.noText,
          isLasting: false
        }
      ]
    };
  }

  return {
    state: {
      ...reading,
      isTextMode: true,
      words,
      picked: []
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

function copyPicked(state: GestureState) {
  const isNothingToCopy = !state.isTextMode || state.picked.length === 0;
  if (isNothingToCopy) {
    return stay(state);
  }

  return {
    state,
    effects: [{
      kind: GestureEffectKind.copyText,
      text: joinWords({
        words: state.words,
        picked: state.picked
      })
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
    case GestureEventKind.leaveText:
      return leaveText(state);
    case GestureEventKind.copy:
      return copyPicked(state);
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
      words: state.words,
      point
    }) !== NO_WORD;
    return isOnWord ? CircleCursor.text : CircleCursor.arrow;
  }

  return selectorCursor({
    state: state.selector,
    point
  });
}
