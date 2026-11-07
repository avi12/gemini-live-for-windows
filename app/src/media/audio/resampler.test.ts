import { createResampler } from "./resampler.ts";
import { concatenate, risingZeroCrossings, rootMeanSquare, sine } from "./test-signals.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const NUMBER_160 = 160;
const NUMBER_480 = 480;
const NUMBER_479 = 479;
const NUMBER_100 = 100;
const NUMBER_7 = 7;
const NUMBER_0_POINT_5 = 0.5;
const NUMBER_6 = 6;
const NUMBER_3 = 3;
const NUMBER_9 = 9;

const TONE = 440;
const RATE_DOWN_FROM = 48_000;
const RATE_DOWN_TO = 16_000;
const RATE_UP_FROM = 24_000;
const RATE_UP_TO = 48_000;
const AMPLITUDE_TOLERANCE = 0.01;
const SEAM_TOLERANCE = 1e-5;
const STEP_HEADROOM = 1.1;
const SINE_AMPLITUDE = 0.5;

function runInChunks({ input, chunkSize, from, to }: {
  input: Float32Array;
  chunkSize: number;
  from: number;
  to: number;
}) {
  const resampler = createResampler({
    from,
    to
  });
  const pieces: Float32Array[] = [];
  for (let start = 0; start < input.length; start += chunkSize) {
    pieces.push(resampler.process(input.subarray(start, start + chunkSize)));
  }
  return concatenate(pieces);
}

describe("resampler", () => {
  it("returns the input itself when the rates match", () => {
    const input = Float32Array.of(1, 2, NUMBER_3);
    const resampler = createResampler({
      from: 16_000,
      to: 16_000
    });
    assert.equal(resampler.process(input), input);
  });

  it("returns nothing for nothing", () => {
    const resampler = createResampler({
      from: RATE_DOWN_FROM,
      to: RATE_DOWN_TO
    });
    assert.equal(resampler.process(new Float32Array(0)).length, 0);
  });

  it("averages each window of three when shrinking 48 kHz to 16 kHz", () => {
    const resampler = createResampler({
      from: RATE_DOWN_FROM,
      to: RATE_DOWN_TO
    });
    const averaged = resampler.process(Float32Array.of(NUMBER_3, NUMBER_6, NUMBER_9, 0, 0, NUMBER_3));
    assert.deepEqual([...averaged], [NUMBER_6, 1]);
  });

  it("interpolates halfway when growing 24 kHz to 48 kHz", () => {
    const resampler = createResampler({
      from: RATE_UP_FROM,
      to: RATE_UP_TO
    });
    assert.deepEqual([...resampler.process(Float32Array.of(0, 1, 0))], [0, NUMBER_0_POINT_5, 1, NUMBER_0_POINT_5]);
  });

  it("keeps the amplitude and the pitch of a tone going down", () => {
    const input = sine({
      frequency: TONE,
      sampleRate: RATE_DOWN_FROM,
      seconds: 1
    });
    const output = runInChunks({
      input,
      chunkSize: 480,
      from: RATE_DOWN_FROM,
      to: RATE_DOWN_TO
    });
    assert.ok(Math.abs(output.length - RATE_DOWN_TO) <= 1);
    assert.ok(Math.abs(risingZeroCrossings(output) - TONE) <= 1);
    assert.ok(Math.abs(rootMeanSquare(output) - rootMeanSquare(input)) < AMPLITUDE_TOLERANCE);
  });

  it("keeps the amplitude and the pitch of a tone going up", () => {
    const input = sine({
      frequency: TONE,
      sampleRate: RATE_UP_FROM,
      seconds: 1
    });
    const output = runInChunks({
      input,
      chunkSize: 480,
      from: RATE_UP_FROM,
      to: RATE_UP_TO
    });
    assert.ok(Math.abs(output.length - RATE_UP_TO) <= 2);
    assert.ok(Math.abs(risingZeroCrossings(output) - TONE) <= 1);
    assert.ok(Math.abs(rootMeanSquare(output) - rootMeanSquare(input)) < AMPLITUDE_TOLERANCE);
  });

  it("has no click at the seams: chunked equals one-shot going up", () => {
    const input = sine({
      frequency: TONE,
      sampleRate: RATE_UP_FROM,
      seconds: 0.5
    });
    const whole = runInChunks({
      input,
      chunkSize: input.length,
      from: RATE_UP_FROM,
      to: RATE_UP_TO
    });
    for (const chunkSize of [1, NUMBER_7, NUMBER_100, NUMBER_479]) {
      const chunked = runInChunks({
        input,
        chunkSize,
        from: RATE_UP_FROM,
        to: RATE_UP_TO
      });
      assert.equal(chunked.length, whole.length, `length at ${chunkSize}`);
      for (const [iSample, sample] of whole.entries()) {
        assert.ok(Math.abs((chunked[iSample] ?? 0) - sample) < SEAM_TOLERANCE, `sample ${iSample} at ${chunkSize}`);
      }
    }
  });

  it("has no click at the seams: chunked equals one-shot going down by three", () => {
    const input = sine({
      frequency: TONE,
      sampleRate: RATE_DOWN_FROM,
      seconds: 0.5
    });
    const whole = runInChunks({
      input,
      chunkSize: input.length,
      from: RATE_DOWN_FROM,
      to: RATE_DOWN_TO
    });
    const chunked = runInChunks({
      input,
      chunkSize: 480,
      from: RATE_DOWN_FROM,
      to: RATE_DOWN_TO
    });
    assert.equal(chunked.length, whole.length);
    for (const [iSample, sample] of whole.entries()) {
      assert.ok(Math.abs((chunked[iSample] ?? 0) - sample) < SEAM_TOLERANCE, `sample ${iSample}`);
    }
  });

  it("never jumps more than a sine of that pitch can between neighbours", () => {
    const output = runInChunks({
      input: sine({
        frequency: TONE,
        sampleRate: RATE_DOWN_FROM,
        seconds: 0.5
      }),
      chunkSize: 123,
      from: RATE_DOWN_FROM,
      to: RATE_DOWN_TO
    });
    const maxStep = 2 * Math.PI * TONE / RATE_DOWN_TO * SINE_AMPLITUDE * STEP_HEADROOM;
    for (let iSample = 1; iSample < output.length; iSample++) {
      assert.ok(Math.abs((output[iSample] ?? 0) - (output[iSample - 1] ?? 0)) <= maxStep, `step ${iSample}`);
    }
  });

  it("handles a rate that is not a whole ratio, 44.1 kHz to 16 kHz", () => {
    const output = runInChunks({
      input: sine({
        frequency: TONE,
        sampleRate: 44_100,
        seconds: 1
      }),
      chunkSize: 441,
      from: 44_100,
      to: RATE_DOWN_TO
    });
    assert.ok(Math.abs(output.length - RATE_DOWN_TO) <= 2);
    assert.ok(Math.abs(risingZeroCrossings(output) - TONE) <= 2);
  });

  it("produces exactly 160 samples for each 10 ms quantum at 48 kHz", () => {
    const resampler = createResampler({
      from: RATE_DOWN_FROM,
      to: RATE_DOWN_TO
    });
    assert.equal(resampler.process(new Float32Array(NUMBER_480)).length, NUMBER_160);
    assert.equal(resampler.process(new Float32Array(NUMBER_480)).length, NUMBER_160);
  });
});
