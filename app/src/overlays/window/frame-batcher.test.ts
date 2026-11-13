import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createFrameBatcher } from "@/overlays/window/frame-batcher.ts";

const LATEST = 3;

describe("createFrameBatcher", () => {
  function setup() {
    const frames: (() => void)[] = [];
    const applied: number[] = [];
    const batcher = createFrameBatcher<number>({
      requestFrame: callback => frames.push(callback),
      apply: value => applied.push(value)
    });
    return {
      frames,
      applied,
      batcher
    };
  }

  it("applies nothing until the frame", () => {
    const { frames, applied, batcher } = setup();
    batcher.push(1);
    assert.deepEqual(applied, []);
    frames.shift()?.();
    assert.deepEqual(applied, [1]);
  });

  it("folds many pushes in a frame into the latest one", () => {
    const { frames, applied, batcher } = setup();
    batcher.push(1);
    batcher.push(2);
    batcher.push(LATEST);
    assert.equal(frames.length, 1);
    frames.shift()?.();
    assert.deepEqual(applied, [LATEST]);
  });

  it("asks for a new frame after one ran", () => {
    const { frames, applied, batcher } = setup();
    batcher.push(1);
    frames.shift()?.();
    batcher.push(2);
    assert.equal(frames.length, 1);
    frames.shift()?.();
    assert.deepEqual(applied, [1, 2]);
  });

  it("applies a value zero is not special", () => {
    const { frames, applied, batcher } = setup();
    batcher.push(0);
    frames.shift()?.();
    assert.deepEqual(applied, [0]);
  });
});
