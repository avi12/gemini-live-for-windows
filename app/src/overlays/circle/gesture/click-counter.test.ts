import {
  createClickCounter,
  MULTI_CLICK_DISTANCE,
  MULTI_CLICK_MILLISECONDS
} from "@/overlays/circle/gesture/click-counter.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const TRIPLE_CLICK = 3;

const HERE = {
  x: 100,
  y: 100
};

describe("createClickCounter", () => {
  it("counts a lone press as one", () => {
    assert.equal(
      createClickCounter().press({
        point: HERE,
        time: 0
      }), 1
    );
  });

  it("counts quick presses in the same place up to three", () => {
    const counter = createClickCounter();
    assert.equal(
      counter.press({
        point: HERE,
        time: 0
      }), 1
    );
    assert.equal(
      counter.press({
        point: HERE,
        time: 200
      }), 2
    );
    assert.equal(
      counter.press({
        point: HERE,
        time: 400
      }), TRIPLE_CLICK
    );
  });

  it("starts over after the interval", () => {
    const counter = createClickCounter();
    counter.press({
      point: HERE,
      time: 0
    });
    assert.equal(
      counter.press({
        point: HERE,
        time: MULTI_CLICK_MILLISECONDS + 1
      }), 1
    );
  });

  it("keeps counting at exactly the interval", () => {
    const counter = createClickCounter();
    counter.press({
      point: HERE,
      time: 0
    });
    assert.equal(
      counter.press({
        point: HERE,
        time: MULTI_CLICK_MILLISECONDS
      }), 2
    );
  });

  it("starts over when the pointer moved too far", () => {
    const counter = createClickCounter();
    counter.press({
      point: HERE,
      time: 0
    });
    const far = {
      x: HERE.x + MULTI_CLICK_DISTANCE + 1,
      y: HERE.y
    };
    assert.equal(
      counter.press({
        point: far,
        time: 100
      }), 1
    );
  });

  it("keeps counting within the distance", () => {
    const counter = createClickCounter();
    counter.press({
      point: HERE,
      time: 0
    });
    const near = {
      x: HERE.x + MULTI_CLICK_DISTANCE,
      y: HERE.y
    };
    assert.equal(
      counter.press({
        point: near,
        time: 100
      }), 2
    );
  });
});
