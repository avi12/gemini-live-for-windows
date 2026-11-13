import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pcm16BytesOf } from "@/media/audio/signal/test-signals.ts";
import type { Clock } from "@/media/clock.ts";

import { createAudioSession, POLL_MILLISECONDS } from "./audio-session.ts";
import type { SessionGraph } from "./audio-session.ts";

const NUMBER_0_POINT_9 = 0.9;
const NUMBER_8 = 8;
const NUMBER_0_POINT_4 = 0.4;
const NUMBER_4 = 4;
const NUMBER_0_POINT_5 = 0.5;
const NUMBER_2400 = 2400;
const NUMBER_34 = 34;
const NUMBER_24 = 24;
const NUMBER_0_POINT_3 = 0.3;
const NUMBER_100 = 100;
const NUMBER_0_POINT_1 = 0.1;

const GRAPH_RATE = 48_000;
const CHANNELS = 2;
const QUANTUM = 480;

function isSilent(chunk: Uint8Array) {
  return chunk.every(byte => byte === 0);
}

function createFakeClock() {
  let time = 0;
  const timers = new Map<
    number,
    {
      tick: () => void;
      milliseconds: number;
    }
  >();
  let nextId = 0;
  const clock: Clock = {
    now: () => time,
    setInterval(tick, milliseconds) {
      const id = nextId++;
      timers.set(id, {
        tick,
        milliseconds
      });
      return () => timers.delete(id);
    }
  };
  return {
    clock,
    get activeTimers() {
      return timers.size;
    },
    advance(milliseconds: number) {
      time += milliseconds;
      for (const timer of timers.values()) {
        timer.tick();
      }
    }
  };
}

function createFakeGraph() {
  const state = {
    started: false,
    closed: false,
    queued: 0,
    micFrames: new Array<Float32Array | undefined>(),
    discards: 0
  };
  const graph: SessionGraph = {
    sampleRate: GRAPH_RATE,
    channels: CHANNELS,
    quantumSamples: QUANTUM,
    micSource: {
      read: () => state.micFrames.shift()
    },
    speakerSink: {
      get queuedSamples() {
        return state.queued;
      },
      write(interleaved) {
        state.queued += interleaved.length / CHANNELS;
      },
      discard() {
        state.discards += 1;
        state.queued = 0;
      }
    },
    start() {
      state.started = true;
    },
    close() {
      state.closed = true;
    }
  };
  return {
    graph,
    state
  };
}

function setup() {
  const fakeClock = createFakeClock();
  const { graph, state } = createFakeGraph();
  const chunks: Uint8Array[] = [];
  const micLevels: number[] = [];
  const speakerLevels: number[] = [];
  const failures: string[] = [];
  const session = createAudioSession({
    graph,
    clock: fakeClock.clock,
    onMicChunk: chunk => chunks.push(chunk),
    onMicLevel: peak => micLevels.push(peak),
    onSpeakerLevel: peak => speakerLevels.push(peak),
    onFailure: message => failures.push(message)
  });
  return {
    fakeClock,
    state,
    session,
    chunks,
    micLevels,
    speakerLevels,
    failures
  };
}

describe("audio session", () => {
  it("starts the graph and one timer, and primes the speaker feed", () => {
    const { fakeClock, state, session } = setup();
    session.start();
    assert.equal(state.started, true);
    assert.equal(fakeClock.activeTimers, 1);
    assert.ok(state.queued > 0);
  });

  it("polls the mic on the timer and emits chunks", () => {
    const { fakeClock, state, session, chunks } = setup();
    session.start();
    for (let iTick = 0; iTick < NUMBER_8; iTick++) {
      state.micFrames.push(new Float32Array(QUANTUM * CHANNELS).fill(NUMBER_0_POINT_1));
      fakeClock.advance(POLL_MILLISECONDS);
    }
    assert.equal(chunks.length, 2);
  });

  it("keeps the speaker fed as it plays", () => {
    const { fakeClock, state, session } = setup();
    session.start();
    state.queued = 0;
    fakeClock.advance(POLL_MILLISECONDS);
    assert.ok(state.queued > 0);
  });

  it("throttles levels to about thirty a second", () => {
    const { fakeClock, state, session, micLevels } = setup();
    session.start();
    for (let iTick = 0; iTick < NUMBER_100; iTick++) {
      state.micFrames.push(new Float32Array(QUANTUM * CHANNELS).fill(NUMBER_0_POINT_3));
      fakeClock.advance(POLL_MILLISECONDS);
    }
    assert.ok(micLevels.length >= NUMBER_24 && micLevels.length <= NUMBER_34, String(micLevels.length));
  });

  it("reports the speaker level of what it plays", () => {
    const { fakeClock, state, session, speakerLevels } = setup();
    session.start();
    session.play(pcm16BytesOf(new Float32Array(NUMBER_2400).fill(NUMBER_0_POINT_5)));
    for (let iTick = 0; iTick < NUMBER_4; iTick++) {
      state.queued = 0;
      fakeClock.advance(POLL_MILLISECONDS);
    }
    assert.ok(speakerLevels.some(level => level > NUMBER_0_POINT_4));
  });

  it("muted, sends silence and a zero level", () => {
    const { fakeClock, state, session, chunks, micLevels } = setup();
    session.start();
    session.setMuted(true);
    for (let iTick = 0; iTick < NUMBER_8; iTick++) {
      state.micFrames.push(new Float32Array(QUANTUM * CHANNELS).fill(NUMBER_0_POINT_9));
      fakeClock.advance(POLL_MILLISECONDS);
    }
    assert.ok(chunks.length >= 1);
    assert.ok(chunks.every(isSilent));
    assert.ok(micLevels.every(level => level === 0));
  });

  it("flush discards what the graph holds", () => {
    const { session, state } = setup();
    session.start();
    session.flush();
    assert.equal(state.discards, 1);
  });

  it("disposal stops the timer and closes the graph, and is safe twice", () => {
    const { fakeClock, state, session } = setup();
    session.start();
    session.dispose();
    session.dispose();
    assert.equal(fakeClock.activeTimers, 0);
    assert.equal(state.closed, true);
  });

  it("a graph that throws stops the timer and is reported once", () => {
    const fakeClock = createFakeClock();
    const failures: string[] = [];
    const { graph } = createFakeGraph();
    const session = createAudioSession({
      graph: {
        ...graph,
        micSource: {
          read() {
            throw new Error("device removed");
          }
        }
      },
      clock: fakeClock.clock,
      onMicChunk: () => undefined,
      onMicLevel: () => undefined,
      onSpeakerLevel: () => undefined,
      onFailure: message => failures.push(message)
    });
    session.start();
    fakeClock.advance(POLL_MILLISECONDS);
    fakeClock.advance(POLL_MILLISECONDS);
    assert.deepEqual(failures, ["device removed"]);
    assert.equal(fakeClock.activeTimers, 0);
  });
});
