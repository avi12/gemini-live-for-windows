import {
  cubicBezier,
  emphasizedDecelerate,
  linearEase,
  springEase,
  standardEase
} from "@/overlays/motion/motion.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const CLOSE = 1e-4;

function assertClose({ actual, expected }: {
  actual: number;
  expected: number;
}) {
  assert.ok(Math.abs(actual - expected) < CLOSE, `${actual} is not close to ${expected}`);
}

const TENTH = 0.1;
const QUARTER = 0.25;
const HALF = 0.5;
const NINE_TENTHS = 0.9;
const SAMPLE_PROGRESS = [TENTH, QUARTER, HALF, NINE_TENTHS];
const DECELERATE_FLOOR = NINE_TENTHS;
const STANDARD_FLOOR = 0.7;
const STEPS = 100;
const MAX_OVERSHOOT = 1.1;

describe("cubicBezier", () => {
  it("starts at 0 and ends at 1", () => {
    for (const ease of [emphasizedDecelerate, standardEase, linearEase, springEase]) {
      assertClose({
        actual: ease(0),
        expected: 0
      });
      assertClose({
        actual: ease(1),
        expected: 1
      });
    }
  });

  it("clamps outside the range", () => {
    assert.equal(standardEase(-1), 0);
    assert.equal(standardEase(2), 1);
  });

  it("is the identity for the linear curve", () => {
    for (const progress of SAMPLE_PROGRESS) {
      assertClose({
        actual: linearEase(progress),
        expected: progress
      });
    }
  });

  it("matches the CSS ease-in-out curve at its midpoint", () => {
    const easeInOut = cubicBezier({
      firstControlX: 0.42,
      firstControlY: 0,
      secondControlX: 0.58,
      secondControlY: 1
    });
    assertClose({
      actual: easeInOut(HALF),
      expected: 0.5
    });
  });

  it("matches the CSS ease curve at a known point", () => {
    const ease = cubicBezier({
      firstControlX: 0.25,
      firstControlY: 0.1,
      secondControlX: 0.25,
      secondControlY: 1
    });
    assertClose({
      actual: ease(HALF),
      expected: 0.8024
    });
  });

  it("decelerates: far along already at half the time", () => {
    assert.ok(emphasizedDecelerate(HALF) > DECELERATE_FLOOR);
    assert.ok(standardEase(HALF) > STANDARD_FLOOR);
  });

  it("never goes backward for a decelerating curve", () => {
    let previous = 0;
    for (let step = 1; step <= STEPS; step += 1) {
      const value = emphasizedDecelerate(step / STEPS);
      assert.ok(value >= previous);
      previous = value;
    }
  });
});

describe("springEase", () => {
  it("overshoots past 1 and settles", () => {
    const peak = Math.max(...Array.from({ length: STEPS }, (_, step) => springEase(step / STEPS)));
    assert.ok(peak > 1);
    assert.ok(peak < MAX_OVERSHOOT);
  });
});
