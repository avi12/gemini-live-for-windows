import { movePoints, pointerPoint } from "@/overlays/circle/gesture/pointer-points.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const FIRST = {
  x: 10,
  y: 11
};
const SECOND = {
  x: 20,
  y: 21
};
const THIRD = {
  x: 30,
  y: 31
};

function report({ x, y }: {
  x: number;
  y: number;
}) {
  return {
    clientX: x,
    clientY: y
  };
}

describe("pointerPoint", () => {
  it("is the client position", () => {
    assert.deepEqual(pointerPoint(report(FIRST)), FIRST);
  });
});

describe("movePoints", () => {
  it("gives every coalesced position, oldest first, in client coordinates", () => {
    const event = {
      ...report(THIRD),
      getCoalescedEvents: () => [report(FIRST), report(SECOND), report(THIRD)]
    };
    assert.deepEqual(movePoints(event), [FIRST, SECOND, THIRD]);
  });

  it("falls back to the event itself when nothing was coalesced", () => {
    const event = {
      ...report(SECOND),
      getCoalescedEvents: () => []
    };
    assert.deepEqual(movePoints(event), [SECOND]);
  });
});
