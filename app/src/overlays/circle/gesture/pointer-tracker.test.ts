import { createPointerTracker, PressVerdict } from "@/overlays/circle/gesture/pointer-tracker.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const MOUSE = {
  pointerId: 1,
  pointerType: "mouse",
  button: 0
};
const FINGER = {
  pointerId: 7,
  pointerType: "touch",
  button: 0
};
const SECOND_FINGER = {
  pointerId: 8,
  pointerType: "touch",
  button: 0
};
const BARREL = {
  pointerId: 5,
  pointerType: "pen",
  button: 2
};
const ERASER = {
  pointerId: 5,
  pointerType: "pen",
  button: 5
};

describe("the pointer tracker", () => {
  it("starts on the first primary press", () => {
    const tracker = createPointerTracker();
    assert.equal(tracker.press(FINGER), PressVerdict.start);
    assert.equal(tracker.isActive, true);
  });

  it("ignores a second finger while the first is down", () => {
    const tracker = createPointerTracker();
    tracker.press(FINGER);
    assert.equal(tracker.press(SECOND_FINGER), PressVerdict.ignore);
    assert.equal(tracker.isFollowed(SECOND_FINGER.pointerId), false);
    assert.equal(tracker.release(SECOND_FINGER.pointerId), false);
    assert.equal(tracker.isActive, true);
  });

  it("follows the first finger until it lifts, then accepts a new gesture", () => {
    const tracker = createPointerTracker();
    tracker.press(FINGER);
    assert.equal(tracker.isFollowed(FINGER.pointerId), true);
    assert.equal(tracker.release(FINGER.pointerId), true);
    assert.equal(tracker.press(SECOND_FINGER), PressVerdict.start);
  });

  it("follows hover when nothing is down", () => {
    assert.equal(createPointerTracker().isFollowed(MOUSE.pointerId), true);
  });

  it("cancels on the mouse's right button only", () => {
    const tracker = createPointerTracker();
    assert.equal(
      tracker.press({
        ...MOUSE,
        button: 2
      }),
      PressVerdict.cancel
    );
    assert.equal(tracker.isActive, false);
  });

  it("does not cancel or start on a pen's barrel button or eraser", () => {
    const tracker = createPointerTracker();
    assert.equal(tracker.press(BARREL), PressVerdict.ignore);
    assert.equal(tracker.press(ERASER), PressVerdict.ignore);
    assert.equal(tracker.isActive, false);
  });

  it("ignores the middle button", () => {
    const tracker = createPointerTracker();
    assert.equal(
      tracker.press({
        ...MOUSE,
        button: 1
      }),
      PressVerdict.ignore
    );
  });
});
