import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSpeakerQueue } from "./speaker-queue.ts";

const NUMBER_5 = 5;
const NUMBER_4 = 4;
const NUMBER_3 = 3;
const NUMBER_8 = 8;
const NUMBER_7 = 7;

describe("speaker queue", () => {
  it("hands samples back in order across pieces", () => {
    const queue = createSpeakerQueue({ maxSamples: 100 });
    queue.enqueue(Float32Array.of(1, 2, NUMBER_3));
    queue.enqueue(Float32Array.of(NUMBER_4, NUMBER_5));
    assert.deepEqual([...queue.take(2)], [1, 2]);
    assert.deepEqual([...queue.take(NUMBER_3)], [NUMBER_3, NUMBER_4, NUMBER_5]);
    assert.equal(queue.queuedSamples, 0);
  });

  it("pads with silence and counts an underrun when it runs dry", () => {
    const queue = createSpeakerQueue({ maxSamples: 100 });
    queue.enqueue(Float32Array.of(1, 2));
    assert.deepEqual([...queue.take(NUMBER_4)], [1, 2, 0, 0]);
    assert.equal(queue.underruns, 1);
  });

  it("gives silence, and an underrun, when empty", () => {
    const queue = createSpeakerQueue({ maxSamples: 100 });
    assert.deepEqual([...queue.take(NUMBER_3)], [0, 0, 0]);
    assert.equal(queue.underruns, 1);
  });

  it("does not count an underrun when the queue holds exactly enough", () => {
    const queue = createSpeakerQueue({ maxSamples: 100 });
    queue.enqueue(Float32Array.of(1, 2));
    queue.take(2);
    assert.equal(queue.underruns, 0);
  });

  it("refuses what would exceed the bound and counts it", () => {
    const queue = createSpeakerQueue({ maxSamples: 4 });
    assert.equal(queue.enqueue(Float32Array.of(1, 2, NUMBER_3)), true);
    assert.equal(queue.enqueue(Float32Array.of(NUMBER_4, NUMBER_5)), false);
    assert.equal(queue.droppedSamples, 2);
    assert.equal(queue.queuedSamples, NUMBER_3);
    assert.equal(queue.enqueue(Float32Array.of(NUMBER_4)), true);
  });

  it("accepts an empty piece", () => {
    const queue = createSpeakerQueue({ maxSamples: 1 });
    assert.equal(queue.enqueue(new Float32Array(0)), true);
    assert.equal(queue.queuedSamples, 0);
  });

  it("clears everything not yet heard, flush", () => {
    const queue = createSpeakerQueue({ maxSamples: 100 });
    queue.enqueue(Float32Array.of(1, 2, NUMBER_3, NUMBER_4));
    queue.take(1);
    queue.clear();
    assert.equal(queue.queuedSamples, 0);
    assert.deepEqual([...queue.take(2)], [0, 0]);
  });

  it("starts a piece from its beginning after a clear that left a partial read", () => {
    const queue = createSpeakerQueue({ maxSamples: 100 });
    queue.enqueue(Float32Array.of(1, 2, NUMBER_3));
    queue.take(2);
    queue.clear();
    queue.enqueue(Float32Array.of(NUMBER_7, NUMBER_8));
    assert.deepEqual([...queue.take(2)], [NUMBER_7, NUMBER_8]);
  });

  it("frees room as samples are taken", () => {
    const queue = createSpeakerQueue({ maxSamples: 3 });
    queue.enqueue(Float32Array.of(1, 2, NUMBER_3));
    queue.take(2);
    assert.equal(queue.enqueue(Float32Array.of(NUMBER_4, NUMBER_5)), true);
  });
});
