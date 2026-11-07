import {
  followCorner,
  grabCorner,
  isFallingCorner,
  joinWords,
  loopSelection,
  moved,
  nearestCorner,
  wordAt,
  wordsBetween,
  wordsIn,
  wordsOnLine
} from "@/overlays/circle/gesture/geometry.ts";
import type { CornerGrip, TextWord } from "@/overlays/circle/gesture/geometry.ts";
import { CircleAction } from "@/overlays/protocol.ts";
import { distanceBetween, rectContains, rectFromPoints, subtractPoints } from "@/overlays/shapes.ts";
import type { Point, Rect, Size, Vector } from "@/overlays/shapes.ts";

// Circle to Search's gesture state machine as a pure reducer (CircleOverlay.cs): what the pointer
// and the keys do to the selection, the stroke and text mode. It touches no window; whatever the
// outside world has to do comes back as effects.

export { CircleAction };

export const GesturePhase = {
  idle: "idle",
  stroke: "stroke",
  resize: "resize",
  move: "move",
  textSelect: "textSelect"
} as const;
export type GesturePhase = typeof GesturePhase[keyof typeof GesturePhase];

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
  draw: "crosshair",
  move: "move",
  resizeFalling: "nwse-resize",
  resizeRising: "nesw-resize",
  text: "text",
  arrow: "default"
} as const;
export type CircleCursor = typeof CircleCursor[keyof typeof CircleCursor];

// Pointer moves shorter than this add no point, so a slow hand doesn't pile up thousands
const MIN_POINT_STEP = 1.5;
// Three presses in a row select a whole line
export const LINE_CLICK_COUNT = 3;
const NO_WORD = -1;

export interface GestureState {
  readonly phase: GesturePhase;
  readonly screen: Size;
  // Gemini Live is already running: no buttons, the first loop is the answer
  readonly isAskOnRelease: boolean;
  readonly isFinished: boolean;
  // The loop being drawn, or the one just drawn until the next press clears it
  readonly stroke: readonly Point[];
  readonly selection: Rect | undefined;
  readonly resizeGrip: CornerGrip | undefined;
  // Where in the selection a move grabbed it, so the selection doesn't jump to the pointer
  readonly moveGrip: Vector | undefined;
  readonly isReading: boolean;
  readonly isTextMode: boolean;
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
    phase: GesturePhase.idle,
    screen,
    isAskOnRelease,
    isFinished: false,
    stroke: [],
    selection: undefined,
    resizeGrip: undefined,
    moveGrip: undefined,
    isReading: false,
    isTextMode: false,
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
    phase: GesturePhase.textSelect,
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
    const band = rectFromPoints({
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

function grabSelection({ state, point }: {
  state: GestureState;
  point: Point;
}) {
  const corner = state.selection === undefined
    ? undefined
    : nearestCorner({
      selection: state.selection,
      point
    });
  const isOnCorner = state.selection !== undefined && corner !== undefined;
  if (isOnCorner) {
    return stay({
      ...state,
      phase: GesturePhase.resize,
      resizeGrip: grabCorner({
        selection: state.selection,
        corner
      })
    });
  }

  const selected = state.selection;
  const isOnSelection = selected !== undefined && rectContains({
    rect: selected,
    point
  });
  if (isOnSelection) {
    return stay({
      ...state,
      phase: GesturePhase.move,
      moveGrip: subtractPoints({
        first: point,
        second: selected
      })
    });
  }

  return undefined;
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

  const grabbed = grabSelection({
    state,
    point
  });
  const isGrabbed = grabbed !== undefined;
  if (isGrabbed) {
    return grabbed;
  }

  return {
    state: {
      ...state,
      phase: GesturePhase.stroke,
      selection: undefined,
      stroke: [point]
    },
    effects: [{ kind: GestureEffectKind.hideHint }]
  };
}

function extendStroke({ state, point }: {
  state: GestureState;
  point: Point;
}) {
  const last = state.stroke.at(-1);
  const isTooClose = last !== undefined && distanceBetween({
    first: point,
    second: last
  }) < MIN_POINT_STEP;
  if (isTooClose) {
    return stay(state);
  }

  return stay({
    ...state,
    stroke: [...state.stroke, point]
  });
}

function pointerMoved({ state, point }: {
  state: GestureState;
  point: Point;
}) {
  const isStroking = state.phase === GesturePhase.stroke;
  if (isStroking) {
    return extendStroke({
      state,
      point
    });
  }

  const isResizing = state.phase === GesturePhase.resize && state.resizeGrip !== undefined;
  if (isResizing) {
    return stay({
      ...state,
      selection: followCorner({
        grip: state.resizeGrip,
        pointer: point,
        screen: state.screen
      })
    });
  }

  const isMoving = state.phase === GesturePhase.move && state.selection !== undefined && state.moveGrip !== undefined;
  if (isMoving) {
    return stay({
      ...state,
      selection: moved({
        selection: state.selection,
        grip: state.moveGrip,
        pointer: point,
        screen: state.screen
      })
    });
  }

  const isSelectingText = state.phase === GesturePhase.textSelect;
  if (isSelectingText) {
    return extendTextSelect({
      state,
      point
    });
  }

  return stay(state);
}

// The loop fades either way; one big enough becomes the selection, a smaller one is ignored and
// drawing simply carries on. With isAskOnRelease the loop itself is the request
function endStroke(state: GestureState) {
  const drawn = loopSelection({
    loop: state.stroke,
    screen: state.screen
  });
  const isTooSmall = drawn === undefined;
  if (isTooSmall) {
    return stay(state);
  }

  if (state.isAskOnRelease) {
    return finish({
      state: {
        ...state,
        selection: drawn
      },
      action: CircleAction.askGemini
    });
  }

  return {
    state: {
      ...state,
      selection: drawn
    },
    effects: [{
      kind: GestureEffectKind.snapIn,
      area: drawn
    }]
  };
}

function pressEnded(state: GestureState) {
  const ended = state.phase;
  const idle = {
    ...state,
    phase: GesturePhase.idle,
    resizeGrip: undefined,
    moveGrip: undefined
  };
  const isEndingStroke = ended === GesturePhase.stroke;
  if (isEndingStroke) {
    return endStroke(idle);
  }

  const isEndingTextSelect = ended === GesturePhase.textSelect;
  if (isEndingTextSelect) {
    return stay({
      ...idle,
      band: undefined
    });
  }

  return stay(idle);
}

function finish({ state, action }: {
  state: GestureState;
  action: CircleAction;
}) {
  const isUnanswerable = state.isFinished || state.selection === undefined;
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
      selection: state.selection
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
        selection: state.selection
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

  const isUnselected = state.selection === undefined;
  if (isUnselected) {
    return CircleCursor.draw;
  }

  const corner = nearestCorner({
    selection: state.selection,
    point
  });
  const isAwayFromCorners = corner === undefined;
  if (isAwayFromCorners) {
    const isInside = rectContains({
      rect: state.selection,
      point
    });
    return isInside ? CircleCursor.move : CircleCursor.draw;
  }

  const isFalling = isFallingCorner({
    selection: state.selection,
    corner
  });
  return isFalling ? CircleCursor.resizeFalling : CircleCursor.resizeRising;
}
