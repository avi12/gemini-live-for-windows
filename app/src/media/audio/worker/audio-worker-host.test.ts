import { serveAudio } from "./audio-worker-host.ts";
import type { OpenGraphRequest } from "./audio-worker-host.ts";
import { AudioCommandKind, AudioEventKind } from "@/media/audio/audio-protocol.ts";
import type { AudioEvent } from "@/media/audio/audio-protocol.ts";
import type { SessionGraph } from "@/media/audio/session/audio-session.ts";
import { pcm16BytesOf } from "@/media/audio/signal/test-signals.ts";
import type { Clock } from "@/media/clock.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { MessageChannel } from "node:worker_threads";
import type { MessagePort } from "node:worker_threads";

const NUMBER_4 = 4;
const NUMBER_0_POINT_5 = 0.5;
const NUMBER_24_000 = 24_000;
const NUMBER_0_POINT_8 = 0.8;
const NUMBER_1280 = 1280;
const NUMBER_8 = 8;
const NUMBER_0_POINT_2 = 0.2;
const NUMBER_10 = 10;

const SETTLE_MILLISECONDS = 15;
const QUANTUM = 480;
const CHANNELS = 2;

const openPorts: MessagePort[] = [];

afterEach(() => {
  for (const port of openPorts.splice(0)) {
    port.close();
  }
});

function createGraph() {
  const state = {
    queued: 0,
    started: false,
    closed: false,
    micFrames: new Array<Float32Array>()
  };
  const graph: SessionGraph = {
    sampleRate: 48_000,
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

function setup({ isOpenFailing = false }: { isOpenFailing?: boolean } = {}) {
  const channel = new MessageChannel();
  openPorts.push(channel.port1, channel.port2);
  const ticks: Array<() => void> = [];
  let time = 0;
  const clock: Clock = {
    now: () => time,
    setInterval(tick) {
      ticks.push(tick);
      return () => ticks.splice(ticks.indexOf(tick), 1);
    }
  };
  const { graph, state } = createGraph();
  const requests: OpenGraphRequest[] = [];
  serveAudio({
    port: channel.port1,
    clock,
    openGraph(request) {
      requests.push(request);
      return isOpenFailing ? Promise.reject(new Error("Microphone access is off")) : Promise.resolve(graph);
    }
  });
  const events: AudioEvent[] = [];
  channel.port2.on("message", event => events.push(event));

  async function send(command: unknown) {
    channel.port2.postMessage(command);
    await sleep(SETTLE_MILLISECONDS);
  }

  return {
    events,
    requests,
    state,
    send,
    get ticks() {
      return ticks.length;
    },
    async runTicks(count: number) {
      for (let iTick = 0; iTick < count; iTick++) {
        time += NUMBER_10;
        for (const tick of ticks) {
          tick();
        }
      }
      await sleep(SETTLE_MILLISECONDS);
    }
  };
}

const START = {
  kind: AudioCommandKind.start,
  deviceId: "device-1",
  isLoopback: false
} as const;

describe("audio worker host", () => {
  it("opens the graph for the device it was asked for, starts it and says so", async () => {
    const host = setup();
    await host.send(START);
    assert.deepEqual(host.requests, [{
      deviceId: "device-1",
      isLoopback: false
    }]);
    assert.equal(host.state.started, true);
    assert.ok(host.events.some(event => event.kind === AudioEventKind.started));
  });

  it("reports a graph that will not open as a failure with its message", async () => {
    const host = setup({ isOpenFailing: true });
    await host.send(START);
    assert.deepEqual(host.events, [{
      kind: AudioEventKind.failed,
      message: "Microphone access is off"
    }]);
  });

  it("streams mic chunks and levels out of the polling timer", async () => {
    const host = setup();
    await host.send(START);
    for (let iTick = 0; iTick < NUMBER_8; iTick++) {
      host.state.micFrames.push(new Float32Array(QUANTUM * CHANNELS).fill(NUMBER_0_POINT_2));
    }
    await host.runTicks(NUMBER_8);
    const chunks = host.events.filter(event => event.kind === AudioEventKind.micChunk);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0]?.pcm16.length, NUMBER_1280);
    assert.ok(host.events.some(event => event.kind === AudioEventKind.micLevel));
  });

  it("applies a mute sent before the graph was ready", async () => {
    const host = setup();
    await host.send({
      kind: AudioCommandKind.mute,
      isMuted: true
    });
    await host.send(START);
    for (let iTick = 0; iTick < NUMBER_4; iTick++) {
      host.state.micFrames.push(new Float32Array(QUANTUM * CHANNELS).fill(NUMBER_0_POINT_8));
    }
    await host.runTicks(NUMBER_4);
    const chunk = host.events.find(event => event.kind === AudioEventKind.micChunk);
    assert.ok(chunk?.pcm16.every(byte => byte === 0));
  });

  it("queues played speech and drops it on flush", async () => {
    const host = setup();
    await host.send(START);
    await host.send({
      kind: AudioCommandKind.play,
      pcm16: pcm16BytesOf(new Float32Array(NUMBER_24_000).fill(NUMBER_0_POINT_5))
    });
    await host.send({ kind: AudioCommandKind.flush });
    assert.equal(host.state.queued, 0);
  });

  it("ignores play and flush before start without failing", async () => {
    const host = setup();
    await host.send({
      kind: AudioCommandKind.play,
      pcm16: new Uint8Array(NUMBER_4)
    });
    await host.send({ kind: AudioCommandKind.flush });
    assert.deepEqual(host.events, []);
  });

  it("disposes: stops the timer, closes the graph, acknowledges", async () => {
    const host = setup();
    await host.send(START);
    await host.send({ kind: AudioCommandKind.dispose });
    assert.equal(host.state.closed, true);
    assert.equal(host.ticks, 0);
    assert.deepEqual(host.events.at(-1), { kind: AudioEventKind.disposed });
  });

  it("answers a command it cannot read with a failure, and keeps serving", async () => {
    const host = setup();
    await host.send({
      kind: "explode",
      deviceId: 3
    });
    assert.equal(host.events[0]?.kind, AudioEventKind.failed);
    await host.send(START);
    assert.equal(host.events.at(-1)?.kind, AudioEventKind.started);
  });
});
