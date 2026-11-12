import { createGestureDiagnostics } from "@/overlays/circle/gesture/gesture-diagnostics.ts";
import { GestureEventKind } from "@/overlays/circle/gesture/gesture.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function setup(size: {
  width: number;
  height: number;
} | undefined) {
  const lines: string[] = [];
  const observe = createGestureDiagnostics({
    log: {
      write: message => lines.push(message)
    },
    size: () => size
  });
  return {
    lines,
    observe
  };
}

test("a gesture logs its press and its first stroke point once", () => {
  const { lines, observe } = setup({
    width: 1920,
    height: 1080
  });

  observe({
    kind: GestureEventKind.pointerDown,
    point: {
      x: 5,
      y: 6
    },
    clickCount: 1
  });
  observe({
    kind: GestureEventKind.pointerMove,
    point: {
      x: 7,
      y: 8
    }
  });
  observe({
    kind: GestureEventKind.pointerMove,
    point: {
      x: 9,
      y: 10
    }
  });

  assert.deepEqual(lines, [
    "circle: pointer down at 5,6, window 1920x1080",
    "circle: first stroke point 7,8"
  ]);
});

test("a press before the window has a size says so, and a move without a press logs nothing", () => {
  const { lines, observe } = setup(undefined);

  observe({
    kind: GestureEventKind.pointerMove,
    point: {
      x: 1,
      y: 1
    }
  });
  observe({
    kind: GestureEventKind.pointerDown,
    point: {
      x: 2,
      y: 3
    },
    clickCount: 1
  });

  assert.deepEqual(lines, ["circle: pointer down at 2,3, window not measured"]);
});
