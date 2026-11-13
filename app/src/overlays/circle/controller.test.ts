import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CIRCLE_SETTLE_MILLISECONDS, createCircleController } from "@/overlays/circle/controller.ts";
import type { CircleView, CircleWorld } from "@/overlays/circle/controller.ts";
import { CircleHint, GestureEventKind } from "@/overlays/circle/gesture/gesture.ts";
import type { OcrLine } from "@/overlays/ports.ts";
import { CircleAction } from "@/overlays/protocol.ts";
import type { CircleOutcome } from "@/overlays/protocol.ts";
import type { Point } from "@/overlays/shapes.ts";

const WINDOW = {
  width: 960,
  height: 540
};
const STILL = {
  width: 1920,
  height: 1080
};
const LOOP: readonly Point[] = [
  {
    x: 100,
    y: 100
  },
  {
    x: 200,
    y: 100
  },
  {
    x: 200,
    y: 160
  }
];
const START_MILLISECONDS = 1000;
const SECOND_LOOP_OFFSET = 300;
const HINT = "Circle anything";
const LINES: readonly OcrLine[] = [
  {
    words: [
      {
        text: "hello",
        bounds: {
          x: 200,
          y: 200,
          width: 100,
          height: 40
        }
      }
    ]
  }
];

function setup({
  isAskOnRelease = false,
  lines = LINES,
  isCopySuccessful = true,
  isReadFailing = false
}: {
  isReadFailing?: boolean;
  isAskOnRelease?: boolean;
  lines?: readonly OcrLine[];
  isCopySuccessful?: boolean;
} = {}) {
  let clock = START_MILLISECONDS;
  const outcomes: CircleOutcome[] = [];
  const copyKeys: boolean[] = [];
  const copied: string[] = [];
  const read: unknown[] = [];
  const logs: string[] = [];
  let view: CircleView | undefined;
  const world: CircleWorld = {
    async readText(region) {
      read.push(region);

      if (isReadFailing) {
        throw new Error("no OCR");
      }

      return lines;
    },
    async copyText(text) {
      copied.push(text);
      return isCopySuccessful;
    },
    holdCopyKey: isHeld => copyKeys.push(isHeld),
    close: outcome => outcomes.push(outcome),
    now: () => clock,
    log: {
      write: message => logs.push(message)
    }
  };
  const controller = createCircleController({
    window: WINDOW,
    still: STILL,
    isAskOnRelease,
    hintText: HINT,
    world,
    onView(next) {
      view = next;
    }
  });
  return {
    controller,
    outcomes,
    copyKeys,
    copied,
    read,
    logs,
    advance(milliseconds: number) {
      clock += milliseconds;
    },
    view: () => view
  };
}

function draw({ controller, offset = 0 }: { controller: ReturnType<typeof setup>["controller"]; offset?: number }) {
  const [first, ...rest] = LOOP.map(point => ({
    x: point.x + offset,
    y: point.y + offset
  }));
  const isEmpty = first === undefined;
  if (isEmpty) {
    return;
  }

  controller.dispatch({
    kind: GestureEventKind.POINTER_DOWN,
    point: first,
    clickCount: 1
  });
  for (const point of rest) {
    controller.dispatch({
      kind: GestureEventKind.POINTER_MOVE,
      point
    });
  }

  controller.dispatch({ kind: GestureEventKind.POINTER_UP });
}

async function settleAsync() {
  await new Promise(resolve => setImmediate(resolve));
}

describe("createCircleController", () => {
  it("publishes the first view with the how-to showing", () => {
    const { view } = setup();
    assert.deepEqual(view()?.hint, {
      text: HINT,
      isVisible: true,
      isLasting: true,
      revision: 0
    });
    assert.equal(view()?.landing, undefined);
  });

  it("hides the how-to when drawing starts", () => {
    const { controller, view } = setup();
    draw({ controller });
    assert.equal(view()?.hint.isVisible, false);
  });

  it("records each landing with its own revision", () => {
    const { controller, view } = setup();
    draw({ controller });
    assert.equal(view()?.landing?.revision, 1);
    draw({
      controller,
      offset: SECOND_LOOP_OFFSET
    });
    assert.equal(view()?.landing?.revision, 2);
  });

  it("answers an action with the region in the still's pixels", () => {
    const { controller, outcomes } = setup();
    draw({ controller });
    controller.dispatch({
      kind: GestureEventKind.FINISH,
      action: CircleAction.LENS
    });
    assert.deepEqual(outcomes, [
      {
        isCancelled: false,
        action: CircleAction.LENS,
        region: {
          x: 168,
          y: 168,
          width: 264,
          height: 184
        }
      }
    ]);
  });

  it("asks Gemini the moment the loop is drawn when it is the request", () => {
    const { controller, outcomes } = setup({ isAskOnRelease: true });
    draw({ controller });
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0]?.isCancelled, false);
  });

  it("cancels on Esc", () => {
    const { controller, outcomes } = setup();
    controller.dispatch({ kind: GestureEventKind.ESCAPE });
    assert.deepEqual(outcomes, [{ isCancelled: true }]);
  });

  it("ignores a deactivation while Windows is still settling", () => {
    const { controller, outcomes, logs, advance } = setup();
    advance(CIRCLE_SETTLE_MILLISECONDS - 1);
    controller.deactivated();
    assert.deepEqual(outcomes, []);
    assert.deepEqual(logs, ["circle: ignored a deactivation while opening"]);
  });

  it("cancels on a deactivation after the settle time", () => {
    const { controller, outcomes, logs, advance } = setup();
    advance(CIRCLE_SETTLE_MILLISECONDS);
    controller.deactivated();
    assert.deepEqual(outcomes, [{ isCancelled: true }]);
    assert.deepEqual(logs, ["circle: cancelled by switching away"]);
  });

  it("cancels on a deactivation even from text mode", async () => {
    const { controller, outcomes, advance } = setup();
    controller.dispatch({ kind: GestureEventKind.SELECT_TEXT });
    await settleAsync();
    advance(CIRCLE_SETTLE_MILLISECONDS);
    controller.deactivated();
    assert.deepEqual(outcomes, [{ isCancelled: true }]);
  });

  it("reads the whole still for text when nothing is selected, and enters text mode", async () => {
    const { controller, read, view } = setup();
    controller.dispatch({ kind: GestureEventKind.SELECT_TEXT });
    assert.equal(view()?.hint.text, CircleHint.READING_TEXT);
    await settleAsync();
    assert.deepEqual(read, [null]);
    assert.equal(view()?.gesture.isTextMode, true);
    assert.deepEqual(
      view()?.gesture.words.map(word => word.text),
      ["hello"]
    );
    assert.deepEqual(view()?.gesture.words[0]?.bounds, {
      x: 100,
      y: 100,
      width: 50,
      height: 20
    });
    assert.equal(view()?.hint.text, CircleHint.SELECT_TEXT);
  });

  it("reads only the selection when there is one", async () => {
    const { controller, read } = setup();
    draw({ controller });
    controller.dispatch({ kind: GestureEventKind.SELECT_TEXT });
    await settleAsync();
    assert.deepEqual(read, [
      {
        x: 168,
        y: 168,
        width: 264,
        height: 184
      }
    ]);
  });

  it("says no text was found for an empty read", async () => {
    const { controller, view } = setup({ lines: [] });
    controller.dispatch({ kind: GestureEventKind.SELECT_TEXT });
    await settleAsync();
    assert.equal(view()?.gesture.isTextMode, false);
    assert.equal(view()?.hint.text, CircleHint.NO_TEXT);
  });

  it("treats a failed read as no text and logs it", async () => {
    const { controller, view, logs } = setup({ isReadFailing: true });
    controller.dispatch({ kind: GestureEventKind.SELECT_TEXT });
    await settleAsync();
    assert.deepEqual(logs, ["circle: reading text failed: no OCR"]);
    assert.equal(view()?.gesture.isTextMode, false);
    assert.equal(view()?.hint.text, CircleHint.NO_TEXT);
  });

  it("holds Ctrl+C only while words are picked", async () => {
    const { controller, copyKeys } = setup();
    controller.dispatch({ kind: GestureEventKind.SELECT_TEXT });
    await settleAsync();
    controller.dispatch({
      kind: GestureEventKind.POINTER_DOWN,
      point: {
        x: 120,
        y: 110
      },
      clickCount: 1
    });
    controller.dispatch({ kind: GestureEventKind.POINTER_UP });
    controller.dispatch({ kind: GestureEventKind.ESCAPE });
    assert.deepEqual(copyKeys, [true, false]);
  });

  it("copies the picked words and says so", async () => {
    const { controller, copied, view } = setup();
    controller.dispatch({ kind: GestureEventKind.SELECT_TEXT });
    await settleAsync();
    controller.dispatch({
      kind: GestureEventKind.POINTER_DOWN,
      point: {
        x: 120,
        y: 110
      },
      clickCount: 1
    });
    controller.dispatch({ kind: GestureEventKind.POINTER_UP });
    controller.dispatch({ kind: GestureEventKind.COPY });
    await settleAsync();
    assert.deepEqual(copied, ["hello"]);
    assert.equal(view()?.hint.text, CircleHint.COPIED);
  });

  it("says it could not copy when the clipboard is locked", async () => {
    const { controller, view } = setup({ isCopySuccessful: false });
    controller.dispatch({ kind: GestureEventKind.SELECT_TEXT });
    await settleAsync();
    controller.dispatch({
      kind: GestureEventKind.POINTER_DOWN,
      point: {
        x: 120,
        y: 110
      },
      clickCount: 1
    });
    controller.dispatch({ kind: GestureEventKind.POINTER_UP });
    controller.dispatch({ kind: GestureEventKind.COPY });
    await settleAsync();
    assert.equal(view()?.hint.text, CircleHint.COPY_FAILED);
  });

  it("marks a notice as passing and the how-to as lasting", async () => {
    const { controller, view } = setup({ lines: [] });
    assert.equal(view()?.hint.isLasting, true);
    controller.dispatch({ kind: GestureEventKind.SELECT_TEXT });
    await settleAsync();
    assert.equal(view()?.hint.isVisible, true);
    assert.equal(view()?.hint.isLasting, false);
  });

  it("gives each hint said its own revision", async () => {
    const { controller, view } = setup({ lines: [] });
    const first = view()?.hint.revision;
    controller.dispatch({ kind: GestureEventKind.SELECT_TEXT });
    const second = view()?.hint.revision;
    await settleAsync();
    const third = view()?.hint.revision;
    assert.notEqual(first, second);
    assert.notEqual(second, third);
  });
});
