import { createSpeakerPump } from "./speaker-pump.ts";
import type { SpeakerSink } from "./speaker-pump.ts";
import { pcm16BytesOf, rootMeanSquare, sine } from "@/media/audio/signal/test-signals.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const NUMBER_100 = 100;
const NUMBER_0_POINT_1 = 0.1;
const NUMBER_2400 = 2400;
const NUMBER_24_000 = 24_000;
const NUMBER_0_POINT_5 = 0.5;
const NUMBER_0_POINT_49 = 0.49;
const NUMBER_5 = 5;
const NUMBER_0_POINT_02 = 0.02;
const NUMBER_50 = 50;
const NUMBER_40 = 40;
const NUMBER_500 = 500;
const NUMBER_960 = 960;
const NUMBER_30 = 30;

const GRAPH_RATE = 48_000;
const QUANTUM = 480;
const CHANNELS = 2;
const LEAD_MILLISECONDS = 80;
const LEAD_SAMPLES = 3840;

function createFakeSink() {
  const written: Float32Array[] = [];
  let queued = 0;
  let discards = 0;
  const sink: SpeakerSink = {
    get queuedSamples() {
      return queued;
    },
    write(interleaved) {
      written.push(interleaved);
      queued += interleaved.length / CHANNELS;
    },
    discard() {
      discards += 1;
      queued = 0;
    }
  };
  return {
    sink,
    written,
    get discards() {
      return discards;
    },
    play(samples: number) {
      queued = Math.max(0, queued - samples);
    }
  };
}

function setup({ maxQueuedSeconds = NUMBER_30 }: { maxQueuedSeconds?: number } = {}) {
  const fake = createFakeSink();
  const levels: number[] = [];
  const pump = createSpeakerPump({
    sink: fake.sink,
    graphRate: GRAPH_RATE,
    channels: CHANNELS,
    quantumSamples: QUANTUM,
    leadMilliseconds: LEAD_MILLISECONDS,
    maxQueuedSeconds,
    onLevel: peak => levels.push(peak)
  });
  return {
    fake,
    levels,
    pump
  };
}

describe("speaker pump", () => {
  it("tops the graph up to the lead and no further", () => {
    const { fake, pump } = setup();
    pump.tick();
    assert.equal(fake.sink.queuedSamples, LEAD_SAMPLES);
    pump.tick();
    assert.equal(fake.written.length, LEAD_SAMPLES / QUANTUM);
  });

  it("feeds silence while nothing was written, one quantum per frame, on every channel", () => {
    const { fake, pump, levels } = setup();
    pump.tick();
    for (const frame of fake.written) {
      assert.equal(frame.length, QUANTUM * CHANNELS);
      assert.ok(frame.every(sample => sample === 0));
    }
    assert.deepEqual(levels, [0]);
  });

  it("refills as the speakers consume", () => {
    const { fake, pump } = setup();
    pump.tick();
    fake.play(NUMBER_960);
    pump.tick();
    assert.equal(fake.written.length, LEAD_SAMPLES / QUANTUM + 2);
  });

  it("resamples 24 kHz speech to the graph rate and plays it all", () => {
    const { fake, pump } = setup();
    const speech = sine({
      frequency: 440,
      sampleRate: 24_000,
      seconds: 0.5
    });
    assert.equal(pump.write(pcm16BytesOf(speech)), true);
    assert.ok(Math.abs(pump.queuedMilliseconds - NUMBER_500) < 2);
    for (let iTick = 0; iTick < NUMBER_40; iTick++) {
      pump.tick();
      fake.play(QUANTUM * 2);
    }
    const heard = fake.written.slice(0, NUMBER_50).flatMap(frame => [...frame]);
    const mono = Float32Array.from(heard.filter((_, iSample) => iSample % CHANNELS === 0));
    const voiced = mono.subarray(0, NUMBER_24_000);
    assert.ok(Math.abs(rootMeanSquare(voiced) - rootMeanSquare(speech)) < NUMBER_0_POINT_02);
    assert.ok(pump.queuedMilliseconds < NUMBER_5);
  });

  it("reports the peak of the frames it just fed", () => {
    const { pump, levels } = setup();
    pump.write(pcm16BytesOf(new Float32Array(NUMBER_2400).fill(NUMBER_0_POINT_5)));
    pump.tick();
    assert.ok((levels[0] ?? 0) > NUMBER_0_POINT_49);
  });

  it("flush drops what is queued and what the graph holds, so nothing more is heard", () => {
    const { fake, pump } = setup();
    pump.write(pcm16BytesOf(new Float32Array(NUMBER_24_000).fill(NUMBER_0_POINT_5)));
    pump.tick();
    pump.flush();
    assert.equal(fake.discards, 1);
    assert.equal(pump.queuedMilliseconds, 0);
    const before = fake.written.length;
    pump.tick();
    for (const frame of fake.written.slice(before)) {
      assert.ok(frame.every(sample => sample === 0));
    }
  });

  it("refuses speech beyond the queue bound", () => {
    const { pump } = setup({ maxQueuedSeconds: 1 });
    assert.equal(pump.write(pcm16BytesOf(new Float32Array(NUMBER_24_000))), true);
    assert.equal(pump.write(pcm16BytesOf(new Float32Array(NUMBER_2400))), false);
    assert.ok(pump.droppedSamples > 0);
  });

  it("counts an underrun when speech runs out mid-quantum", () => {
    const { pump } = setup();
    pump.write(pcm16BytesOf(new Float32Array(NUMBER_100).fill(NUMBER_0_POINT_1)));
    pump.tick();
    assert.ok(pump.underruns >= 1);
  });

  it("never feeds more than its per-tick cap when the graph reports nothing queued", () => {
    const fake = createFakeSink();
    const pump = createSpeakerPump({
      sink: {
        queuedSamples: 0,
        write: interleaved => fake.sink.write(interleaved),
        discard: () => fake.sink.discard()
      },
      graphRate: GRAPH_RATE,
      channels: CHANNELS,
      quantumSamples: QUANTUM,
      leadMilliseconds: LEAD_MILLISECONDS,
      maxQueuedSeconds: 1,
      onLevel: () => undefined
    });
    pump.tick();
    assert.equal(fake.written.length, NUMBER_100);
  });
});
