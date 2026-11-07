import { createMicPump } from "./mic-pump.ts";
import { bytesToFloats } from "@/media/audio/signal/pcm.ts";
import { concatenate, risingZeroCrossings, sine } from "@/media/audio/signal/test-signals.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const NUMBER_25 = 25;
const NUMBER_4 = 4;
const NUMBER_5 = 5;
const NUMBER_20 = 20;
const NUMBER_0_POINT_25 = 0.25;
const NUMBER_100 = 100;

const GRAPH_RATE = 48_000;
const QUANTUM = 480;
const TONE = 440;
const CHUNK_BYTES = 1280;

function interleave({ mono, channels }: {
  mono: Float32Array;
  channels: number;
}) {
  const out = new Float32Array(mono.length * channels);
  for (const [iFrame, sample] of mono.entries()) {
    out.fill(sample, iFrame * channels, (iFrame + 1) * channels);
  }
  return out;
}

function setup({ channels = 2, isMuted = false }: {
  channels?: number;
  isMuted?: boolean;
} = {}) {
  const frames: Array<Float32Array | undefined> = [];
  const chunks: Uint8Array[] = [];
  const levels: number[] = [];
  const state = { isMuted };
  const pump = createMicPump({
    source: {
      read: () => frames.shift()
    },
    graphRate: GRAPH_RATE,
    channels,
    isMuted: () => state.isMuted,
    onChunk: chunk => chunks.push(chunk),
    onLevel: peak => levels.push(peak)
  });
  return {
    pump,
    frames,
    chunks,
    levels,
    state
  };
}

function toneFrames({ seconds, channels }: {
  seconds: number;
  channels: number;
}) {
  const mono = sine({
    frequency: TONE,
    sampleRate: GRAPH_RATE,
    seconds
  });
  const pieces: Float32Array[] = [];
  for (let start = 0; start < mono.length; start += QUANTUM) {
    pieces.push(
      interleave({
        mono: mono.subarray(start, start + QUANTUM),
        channels
      })
    );
  }
  return pieces;
}

describe("mic pump", () => {
  it("cuts exact 40 ms chunks of 1280 bytes out of 10 ms quanta", () => {
    const { pump, frames, chunks } = setup();
    frames.push(
      ...toneFrames({
        seconds: 1,
        channels: 2
      })
    );
    for (let iPoll = 0; iPoll < NUMBER_100; iPoll++) {
      pump.poll();
    }
    assert.equal(chunks.length, NUMBER_25);
    for (const chunk of chunks) {
      assert.equal(chunk.length, CHUNK_BYTES);
    }
  });

  it("delivers the tone at 16 kHz, pitch intact", () => {
    const { pump, frames, chunks } = setup({ channels: 6 });
    frames.push(
      ...toneFrames({
        seconds: 1,
        channels: 6
      })
    );
    for (let iPoll = 0; iPoll < NUMBER_100; iPoll++) {
      pump.poll();
    }
    const heard = concatenate(chunks.map(chunk => bytesToFloats(chunk)));
    assert.ok(Math.abs(risingZeroCrossings(heard) - TONE) <= 2);
  });

  it("reports the peak of the mono mix before it is cut into chunks", () => {
    const { pump, frames, levels } = setup();
    frames.push(
      interleave({
        mono: new Float32Array(QUANTUM).fill(NUMBER_0_POINT_25),
        channels: 2
      })
    );
    pump.poll();
    assert.deepEqual(levels, [NUMBER_0_POINT_25]);
  });

  it("muted: still sends chunks, all silence, and the level reads zero", () => {
    const { pump, frames, chunks, levels } = setup({ isMuted: true });
    frames.push(
      ...toneFrames({
        seconds: 0.2,
        channels: 2
      })
    );
    for (let iPoll = 0; iPoll < NUMBER_20; iPoll++) {
      pump.poll();
    }
    assert.equal(chunks.length, NUMBER_5);
    for (const chunk of chunks) {
      assert.ok(chunk.every(byte => byte === 0));
    }
    assert.ok(levels.every(level => level === 0));
  });

  it("follows a mute toggled between polls", () => {
    const { pump, frames, chunks, state } = setup();
    frames.push(
      ...toneFrames({
        seconds: 0.08,
        channels: 2
      })
    );
    for (let iPoll = 0; iPoll < NUMBER_4; iPoll++) {
      pump.poll();
    }
    state.isMuted = true;
    for (let iPoll = 0; iPoll < NUMBER_4; iPoll++) {
      pump.poll();
    }
    assert.equal(chunks.length, 2);
    assert.ok(chunks[0]?.some(byte => byte !== 0));
  });

  it("counts a poll with no frame, or half a frame, as empty and sends nothing", () => {
    const { pump, frames, chunks } = setup({ channels: 2 });
    frames.push(undefined, new Float32Array(1));
    pump.poll();
    pump.poll();
    assert.equal(pump.stats.polls, 2);
    assert.equal(pump.stats.emptyPolls, 2);
    assert.equal(chunks.length, 0);
  });

  it("keeps only the newest second when a poll returns an absurd backlog", () => {
    const { pump, frames, chunks } = setup({ channels: 1 });
    frames.push(new Float32Array(GRAPH_RATE * NUMBER_5));
    pump.poll();
    assert.equal(pump.stats.droppedFrames, GRAPH_RATE * NUMBER_4);
    assert.equal(chunks.length, NUMBER_25);
  });

  it("keeps the signal continuous when a poll is late and holds four quanta", () => {
    const { pump, frames, chunks } = setup({ channels: 1 });
    const [first, ...rest] = toneFrames({
      seconds: 0.05,
      channels: 1
    });
    frames.push(first ?? new Float32Array(0), concatenate(rest));
    pump.poll();
    pump.poll();
    assert.equal(pump.stats.droppedFrames, 0);
    assert.equal(chunks.length, 1);
  });
});
