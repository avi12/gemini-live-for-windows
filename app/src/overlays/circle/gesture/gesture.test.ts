import type { TextWord } from "@/overlays/circle/gesture/geometry.ts";
import {
  CircleAction,
  CircleCursor,
  CircleHint,
  GestureEffectKind,
  GestureEventKind,
  GesturePhase,
  hoverCursor,
  initialGesture,
  LINE_CLICK_COUNT,
  reduceGesture
} from "@/overlays/circle/gesture/gesture.ts";
import type { GestureEffect, GestureEvent, GestureState } from "@/overlays/circle/gesture/gesture.ts";
import type { Point } from "@/overlays/shapes.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const SCREEN = {
  width: 1920,
  height: 1080
};

const WORDS: readonly TextWord[] = [
  {
    text: "alpha",
    bounds: {
      x: 100,
      y: 100,
      width: 50,
      height: 20
    },
    line: 0
  },
  {
    text: "beta",
    bounds: {
      x: 160,
      y: 100,
      width: 40,
      height: 20
    },
    line: 0
  },
  {
    text: "gamma",
    bounds: {
      x: 100,
      y: 140,
      width: 60,
      height: 20
    },
    line: 1
  }
];

const LOOP: readonly Point[] = [
  {
    x: 300,
    y: 300
  },
  {
    x: 500,
    y: 300
  },
  {
    x: 500,
    y: 450
  },
  {
    x: 300,
    y: 450
  }
];

const LOOP_SELECTION = {
  x: 284,
  y: 284,
  width: 232,
  height: 182
};

function start(isAskOnRelease = false) {
  return initialGesture({
    screen: SCREEN,
    isAskOnRelease
  });
}

function run({ state, events }: {
  state: GestureState;
  events: readonly GestureEvent[];
}) {
  let current = state;
  const effects: GestureEffect[] = [];
  for (const event of events) {
    const step = reduceGesture({
      state: current,
      event
    });
    current = step.state;
    effects.push(...step.effects);
  }

  return {
    state: current,
    effects
  };
}

function pressWith({ point, clickCount }: {
  point: Point;
  clickCount: number;
}) {
  return {
    kind: GestureEventKind.pointerDown,
    point,
    clickCount
  } satisfies GestureEvent;
}

function down(point: Point) {
  return pressWith({
    point,
    clickCount: 1
  });
}

function move(point: Point) {
  return {
    kind: GestureEventKind.pointerMove,
    point
  } satisfies GestureEvent;
}

const LAST_TWO = 2;
const RELEASE: GestureEvent = { kind: GestureEventKind.pointerUp };
const ESCAPE: GestureEvent = { kind: GestureEventKind.escape };

function drawLoop() {
  const [first, ...rest] = LOOP;
  const isEmpty = first === undefined;
  if (isEmpty) {
    return [];
  }

  return [down(first), ...rest.map(move), RELEASE];
}

function selected(isAskOnRelease = false) {
  return run({
    state: start(isAskOnRelease),
    events: drawLoop()
  }).state;
}

function inTextMode() {
  return run({
    state: selected(),
    events: [
      { kind: GestureEventKind.selectText },
      {
        kind: GestureEventKind.textRead,
        words: WORDS
      }
    ]
  }).state;
}

describe("a loop", () => {
  it("starts a stroke and hides the hint on press", () => {
    const { state, effects } = run({
      state: start(),
      events: [down({
        x: 10,
        y: 10
      })]
    });
    assert.equal(state.phase, GesturePhase.stroke);
    assert.deepEqual(state.stroke, [{
      x: 10,
      y: 10
    }]);
    assert.deepEqual(effects, [{ kind: GestureEffectKind.hideHint }]);
  });

  it("adds points once the pointer moved far enough", () => {
    const { state } = run({
      state: start(),
      events: [down({
        x: 0,
        y: 0
      }), move({
        x: 1,
        y: 1
      }), move({
        x: 3,
        y: 0
      })]
    });
    assert.deepEqual(state.stroke, [{
      x: 0,
      y: 0
    }, {
      x: 3,
      y: 0
    }]);
  });

  it("keeps a move of exactly the minimum step", () => {
    const { state } = run({
      state: start(),
      events: [down({
        x: 0,
        y: 0
      }), move({
        x: 1.5,
        y: 0
      })]
    });
    assert.equal(state.stroke.length, 2);
  });

  it("becomes a padded, landed selection on release", () => {
    const { state, effects } = run({
      state: start(),
      events: drawLoop()
    });
    assert.equal(state.phase, GesturePhase.idle);
    assert.deepEqual(state.selection, LOOP_SELECTION);
    assert.deepEqual(effects, [
      { kind: GestureEffectKind.hideHint },
      {
        kind: GestureEffectKind.snapIn,
        area: LOOP_SELECTION
      }
    ]);
  });

  it("keeps the drawn points to fade out after release", () => {
    assert.equal(selected().stroke.length, LOOP.length);
  });

  it("ignores a click that is too small to be a circle", () => {
    const { state, effects } = run({
      state: start(),
      events: [down({
        x: 50,
        y: 50
      }), RELEASE]
    });
    assert.equal(state.selection, undefined);
    assert.equal(state.phase, GesturePhase.idle);
    assert.deepEqual(effects, [{ kind: GestureEffectKind.hideHint }]);
  });

  it("asks Gemini at once when the loop itself is the request", () => {
    const { state, effects } = run({
      state: start(true),
      events: drawLoop()
    });
    assert.equal(state.isFinished, true);
    assert.deepEqual(effects.at(-1), {
      kind: GestureEffectKind.finish,
      action: CircleAction.askGemini,
      selection: LOOP_SELECTION
    });
    assert.equal(effects.some(effect => effect.kind === GestureEffectKind.snapIn), false);
  });

  it("drops the earlier selection when a new loop starts", () => {
    const { state } = run({
      state: selected(),
      events: [down({
        x: 900,
        y: 900
      })]
    });
    assert.equal(state.selection, undefined);
    assert.equal(state.phase, GesturePhase.stroke);
  });

  it("ends the loop when the pointer is lost without a release", () => {
    const { state } = run({
      state: start(),
      events: [...drawLoop().slice(0, -1), RELEASE]
    });
    assert.deepEqual(state.selection, LOOP_SELECTION);
  });

  it("moving with nothing held changes nothing", () => {
    const step = reduceGesture({
      state: start(),
      event: move({
        x: 5,
        y: 5
      })
    });
    assert.deepEqual(step.state, start());
    assert.deepEqual(step.effects, []);
  });

  it("ignores a release with nothing held", () => {
    const step = reduceGesture({
      state: start(),
      event: RELEASE
    });
    assert.deepEqual(step.state, start());
  });
});

describe("resizing", () => {
  it("grabs a corner and follows the pointer", () => {
    const { state } = run({
      state: selected(),
      events: [down({
        x: 516,
        y: 466
      }), move({
        x: 700,
        y: 600
      })]
    });
    assert.equal(state.phase, GesturePhase.resize);
    assert.deepEqual(state.selection, {
      x: 284,
      y: 284,
      width: 416,
      height: 316
    });
  });

  it("stops at the minimum size", () => {
    const { state } = run({
      state: selected(),
      events: [down({
        x: 516,
        y: 466
      }), move({
        x: 0,
        y: 0
      })]
    });
    assert.deepEqual(state.selection, {
      x: 284,
      y: 284,
      width: 20,
      height: 20
    });
  });

  it("releases the grip when the press ends", () => {
    const { state } = run({
      state: selected(),
      events: [down({
        x: 516,
        y: 466
      }), move({
        x: 700,
        y: 600
      }), RELEASE]
    });
    assert.equal(state.phase, GesturePhase.idle);
    assert.equal(state.resizeGrip, undefined);
    assert.deepEqual(state.selection, {
      x: 284,
      y: 284,
      width: 416,
      height: 316
    });
  });

  it("emits no landing effect for a resize", () => {
    const { effects } = run({
      state: selected(),
      events: [down({
        x: 516,
        y: 466
      }), move({
        x: 700,
        y: 600
      }), RELEASE]
    });
    assert.deepEqual(effects, []);
  });
});

describe("moving", () => {
  it("drags the whole selection by its interior", () => {
    const { state } = run({
      state: selected(),
      events: [down({
        x: 400,
        y: 380
      }), move({
        x: 450,
        y: 400
      })]
    });
    assert.equal(state.phase, GesturePhase.move);
    assert.deepEqual(state.selection, {
      x: 334,
      y: 304,
      width: 232,
      height: 182
    });
  });

  it("does not throw away the selection on a stray click inside it", () => {
    const { state } = run({
      state: selected(),
      events: [down({
        x: 400,
        y: 380
      }), RELEASE]
    });
    assert.deepEqual(state.selection, LOOP_SELECTION);
  });

  it("stops at the screen edge", () => {
    const { state } = run({
      state: selected(),
      events: [down({
        x: 400,
        y: 380
      }), move({
        x: -500,
        y: -500
      })]
    });
    assert.deepEqual(state.selection, {
      x: 0,
      y: 0,
      width: 232,
      height: 182
    });
  });
});

describe("finishing", () => {
  it("answers with the chosen action and the selection", () => {
    const { state, effects } = run({
      state: selected(),
      events: [{
        kind: GestureEventKind.finish,
        action: CircleAction.lens
      }]
    });
    assert.equal(state.isFinished, true);
    assert.deepEqual(effects, [{
      kind: GestureEffectKind.finish,
      action: CircleAction.lens,
      selection: LOOP_SELECTION
    }]);
  });

  it("does nothing without a selection", () => {
    const step = reduceGesture({
      state: start(),
      event: {
        kind: GestureEventKind.finish,
        action: CircleAction.askGemini
      }
    });
    assert.deepEqual(step.effects, []);
    assert.equal(step.state.isFinished, false);
  });

  it("answers only once", () => {
    const { effects } = run({
      state: selected(),
      events: [
        {
          kind: GestureEventKind.finish,
          action: CircleAction.lens
        },
        {
          kind: GestureEventKind.finish,
          action: CircleAction.askGemini
        }
      ]
    });
    assert.equal(effects.length, 1);
  });

  it("ignores presses once finished", () => {
    const finished = run({
      state: selected(),
      events: [{
        kind: GestureEventKind.finish,
        action: CircleAction.lens
      }]
    }).state;
    const step = reduceGesture({
      state: finished,
      event: down({
        x: 900,
        y: 900
      })
    });
    assert.deepEqual(step.state, finished);
  });
});

describe("escape", () => {
  it("cancels", () => {
    const { state, effects } = run({
      state: selected(),
      events: [ESCAPE]
    });
    assert.equal(state.isFinished, true);
    assert.deepEqual(effects, [{ kind: GestureEffectKind.cancel }]);
  });

  it("cancels only once", () => {
    const { effects } = run({
      state: start(),
      events: [ESCAPE, ESCAPE]
    });
    assert.equal(effects.length, 1);
  });

  it("cancels outright, even from text mode, when switching away", () => {
    const { state, effects } = run({
      state: inTextMode(),
      events: [{ kind: GestureEventKind.cancel }, { kind: GestureEventKind.cancel }]
    });
    assert.equal(state.isFinished, true);
    assert.deepEqual(effects, [{ kind: GestureEffectKind.cancel }]);
  });

  it("does not cancel after an answer", () => {
    const { effects } = run({
      state: selected(),
      events: [{
        kind: GestureEventKind.finish,
        action: CircleAction.lens
      }, ESCAPE]
    });
    assert.equal(effects.some(effect => effect.kind === GestureEffectKind.cancel), false);
  });
});

describe("reading text", () => {
  it("starts reading the selection and says so", () => {
    const { state, effects } = run({
      state: selected(),
      events: [{ kind: GestureEventKind.selectText }]
    });
    assert.equal(state.isReading, true);
    assert.deepEqual(effects, [
      {
        kind: GestureEffectKind.say,
        message: CircleHint.readingText,
        isLasting: true
      },
      {
        kind: GestureEffectKind.readText,
        selection: LOOP_SELECTION
      }
    ]);
  });

  it("reads the whole screen when there is no selection", () => {
    const { effects } = run({
      state: start(),
      events: [{ kind: GestureEventKind.selectText }]
    });
    assert.deepEqual(effects.at(-1), {
      kind: GestureEffectKind.readText,
      selection: undefined
    });
  });

  it("is ignored where there are no buttons", () => {
    const { effects } = run({
      state: selected(true),
      events: [{ kind: GestureEventKind.selectText }]
    });
    assert.deepEqual(effects, []);
  });

  it("is ignored while already reading", () => {
    const { effects } = run({
      state: start(),
      events: [{ kind: GestureEventKind.selectText }, { kind: GestureEventKind.selectText }]
    });
    assert.equal(effects.filter(effect => effect.kind === GestureEffectKind.readText).length, 1);
  });

  it("is ignored once in text mode", () => {
    const step = reduceGesture({
      state: inTextMode(),
      event: {
        kind: GestureEventKind.selectText
      }
    });
    assert.deepEqual(step.effects, []);
  });

  it("ignores presses while reading", () => {
    const reading = run({
      state: start(),
      events: [{ kind: GestureEventKind.selectText }]
    }).state;
    const step = reduceGesture({
      state: reading,
      event: down({
        x: 5,
        y: 5
      })
    });
    assert.equal(step.state.phase, GesturePhase.idle);
  });

  it("enters text mode when words were found", () => {
    const { state, effects } = run({
      state: start(),
      events: [
        { kind: GestureEventKind.selectText },
        {
          kind: GestureEventKind.textRead,
          words: WORDS
        }
      ]
    });
    assert.equal(state.isReading, false);
    assert.equal(state.isTextMode, true);
    assert.deepEqual(state.words, WORDS);
    assert.deepEqual(effects.slice(-LAST_TWO), [
      { kind: GestureEffectKind.hideHint },
      {
        kind: GestureEffectKind.say,
        message: CircleHint.selectText,
        isLasting: false
      }
    ]);
  });

  it("says so when no text was found", () => {
    const { state, effects } = run({
      state: start(),
      events: [
        { kind: GestureEventKind.selectText },
        {
          kind: GestureEventKind.textRead,
          words: []
        }
      ]
    });
    assert.equal(state.isTextMode, false);
    assert.deepEqual(effects.slice(-LAST_TWO), [
      { kind: GestureEffectKind.hideHint },
      {
        kind: GestureEffectKind.say,
        message: CircleHint.noText,
        isLasting: false
      }
    ]);
  });

  it("drops a late read after the overlay finished", () => {
    const { state } = run({
      state: start(),
      events: [
        { kind: GestureEventKind.selectText },
        ESCAPE,
        {
          kind: GestureEventKind.textRead,
          words: WORDS
        }
      ]
    });
    assert.equal(state.isTextMode, false);
    assert.equal(state.isReading, false);
  });
});

describe("selecting words", () => {
  it("selects the word pressed", () => {
    const { state, effects } = run({
      state: inTextMode(),
      events: [down({
        x: 120,
        y: 110
      })]
    });
    assert.equal(state.phase, GesturePhase.textSelect);
    assert.deepEqual(state.picked, [0]);
    assert.deepEqual(effects.at(-1), {
      kind: GestureEffectKind.setCopyKey,
      isRegistered: true
    });
  });

  it("extends from the word to the one under the drag", () => {
    const { state } = run({
      state: inTextMode(),
      events: [down({
        x: 120,
        y: 110
      }), move({
        x: 120,
        y: 150
      })]
    });
    assert.deepEqual(state.picked, [0, 1, 2]);
  });

  it("extends backward in reading order", () => {
    const { state } = run({
      state: inTextMode(),
      events: [down({
        x: 120,
        y: 150
      }), move({
        x: 120,
        y: 110
      })]
    });
    assert.deepEqual(state.picked, [0, 1, 2]);
  });

  it("keeps the picked words while the drag is over empty space", () => {
    const { state } = run({
      state: inTextMode(),
      events: [down({
        x: 120,
        y: 110
      }), move({
        x: 800,
        y: 800
      })]
    });
    assert.deepEqual(state.picked, [0]);
  });

  it("selects the whole line on a triple click", () => {
    const { state } = run({
      state: inTextMode(),
      events: [pressWith({
        point: {
          x: 120,
          y: 110
        },
        clickCount: LINE_CLICK_COUNT
      })]
    });
    assert.deepEqual(state.picked, [0, 1]);
  });

  it("selects one word on a double click", () => {
    const { state } = run({
      state: inTextMode(),
      events: [pressWith({
        point: {
          x: 120,
          y: 110
        },
        clickCount: 2
      })]
    });
    assert.deepEqual(state.picked, [0]);
  });

  it("draws a rubber band from empty space", () => {
    const { state } = run({
      state: inTextMode(),
      events: [down({
        x: 90,
        y: 90
      }), move({
        x: 205,
        y: 125
      })]
    });
    assert.deepEqual(state.band, {
      x: 90,
      y: 90,
      width: 115,
      height: 35
    });
    assert.deepEqual(state.picked, [0, 1]);
  });

  it("puts the rubber band away on release", () => {
    const { state } = run({
      state: inTextMode(),
      events: [down({
        x: 90,
        y: 90
      }), move({
        x: 205,
        y: 125
      }), RELEASE]
    });
    assert.equal(state.band, undefined);
    assert.deepEqual(state.picked, [0, 1]);
  });

  it("clears the picked words on a press in empty space", () => {
    const { state, effects } = run({
      state: inTextMode(),
      events: [down({
        x: 120,
        y: 110
      }), RELEASE, down({
        x: 1000,
        y: 1000
      })]
    });
    assert.deepEqual(state.picked, []);
    assert.deepEqual(effects.at(-1), {
      kind: GestureEffectKind.setCopyKey,
      isRegistered: false
    });
  });
});

describe("copying", () => {
  it("copies the picked words as text", () => {
    const { effects } = run({
      state: inTextMode(),
      events: [down({
        x: 120,
        y: 110
      }), move({
        x: 120,
        y: 150
      }), RELEASE, { kind: GestureEventKind.copy }]
    });
    assert.deepEqual(effects.at(-1), {
      kind: GestureEffectKind.copyText,
      text: "alpha beta\ngamma"
    });
  });

  it("does nothing with no picked words", () => {
    const step = reduceGesture({
      state: inTextMode(),
      event: {
        kind: GestureEventKind.copy
      }
    });
    assert.deepEqual(step.effects, []);
  });

  it("does nothing outside text mode", () => {
    const step = reduceGesture({
      state: selected(),
      event: {
        kind: GestureEventKind.copy
      }
    });
    assert.deepEqual(step.effects, []);
  });

  it("says copied or that it could not", () => {
    const copied = reduceGesture({
      state: inTextMode(),
      event: {
        kind: GestureEventKind.copyDone,
        isCopied: true
      }
    });
    const failed = reduceGesture({
      state: inTextMode(),
      event: {
        kind: GestureEventKind.copyDone,
        isCopied: false
      }
    });
    assert.deepEqual(copied.effects, [{
      kind: GestureEffectKind.say,
      message: CircleHint.copied,
      isLasting: false
    }]);
    assert.deepEqual(failed.effects, [{
      kind: GestureEffectKind.say,
      message: CircleHint.copyFailed,
      isLasting: false
    }]);
  });
});

describe("escape in text mode", () => {
  const picked = run({
    state: inTextMode(),
    events: [down({
      x: 120,
      y: 110
    }), RELEASE]
  }).state;

  it("clears the picked words first and stays in text mode", () => {
    const { state, effects } = run({
      state: picked,
      events: [ESCAPE]
    });
    assert.deepEqual(state.picked, []);
    assert.equal(state.isTextMode, true);
    assert.deepEqual(effects, [{
      kind: GestureEffectKind.setCopyKey,
      isRegistered: false
    }]);
  });

  it("leaves text mode next", () => {
    const { state, effects } = run({
      state: picked,
      events: [ESCAPE, ESCAPE]
    });
    assert.equal(state.isTextMode, false);
    assert.deepEqual(state.words, []);
    assert.deepEqual(effects.at(-1), { kind: GestureEffectKind.hideHint });
  });

  it("cancels once out of text mode", () => {
    const { state, effects } = run({
      state: picked,
      events: [ESCAPE, ESCAPE, ESCAPE]
    });
    assert.equal(state.isFinished, true);
    assert.deepEqual(effects.at(-1), { kind: GestureEffectKind.cancel });
  });

  it("leaves text mode from the Done button", () => {
    const { state } = run({
      state: picked,
      events: [{ kind: GestureEventKind.leaveText }]
    });
    assert.equal(state.isTextMode, false);
    assert.deepEqual(state.picked, []);
  });

  it("ignores Done outside text mode", () => {
    const step = reduceGesture({
      state: selected(),
      event: {
        kind: GestureEventKind.leaveText
      }
    });
    assert.deepEqual(step.effects, []);
  });

  it("keeps the selection for the pill that returns", () => {
    const { state } = run({
      state: picked,
      events: [ESCAPE, ESCAPE]
    });
    assert.deepEqual(state.selection, LOOP_SELECTION);
  });
});

describe("hoverCursor", () => {
  it("is the drawing cross with no selection", () => {
    assert.equal(
      hoverCursor({
        state: start(),
        point: {
          x: 5,
          y: 5
        }
      }), CircleCursor.draw
    );
  });

  it("is a diagonal over each corner", () => {
    const state = selected();
    assert.equal(
      hoverCursor({
        state,
        point: {
          x: 284,
          y: 284
        }
      }), CircleCursor.resizeFalling
    );
    assert.equal(
      hoverCursor({
        state,
        point: {
          x: 516,
          y: 466
        }
      }), CircleCursor.resizeFalling
    );
    assert.equal(
      hoverCursor({
        state,
        point: {
          x: 516,
          y: 284
        }
      }), CircleCursor.resizeRising
    );
    assert.equal(
      hoverCursor({
        state,
        point: {
          x: 284,
          y: 466
        }
      }), CircleCursor.resizeRising
    );
  });

  it("is the move arrow inside the selection", () => {
    assert.equal(
      hoverCursor({
        state: selected(),
        point: {
          x: 400,
          y: 375
        }
      }), CircleCursor.move
    );
  });

  it("is the cross outside the selection", () => {
    assert.equal(
      hoverCursor({
        state: selected(),
        point: {
          x: 1000,
          y: 800
        }
      }), CircleCursor.draw
    );
  });

  it("is an I-beam over a word and an arrow elsewhere in text mode", () => {
    const state = inTextMode();
    assert.equal(
      hoverCursor({
        state,
        point: {
          x: 120,
          y: 110
        }
      }), CircleCursor.text
    );
    assert.equal(
      hoverCursor({
        state,
        point: {
          x: 1000,
          y: 800
        }
      }), CircleCursor.arrow
    );
  });
});
