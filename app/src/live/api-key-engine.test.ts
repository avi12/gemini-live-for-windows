import { EngineKind, type LiveEvent, LiveEventKind, LiveStatus } from "@/contracts/live-engine.ts";
import { createApiKeyEngine } from "@/live/api-key-engine.ts";
import { FRAME_INTERVAL_MS } from "@/live/api/constants.ts";
import {
  createFakeAudio,
  createFakeNetwork,
  createFakeScreen,
  flush,
  FRAME_BYTES,
  PCM_BASE64,
  PCM_BYTES,
  TEST_KEY,
  TEST_MONITOR
} from "@/live/fakes.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

const MIC_PEAK = 0.5;
const LOUD_PEAK = 0.9;
const SPEAKER_PEAK = 0.3;
const IDLE_TICKS = 3;

function setup() {
  const network = createFakeNetwork();
  const audio = createFakeAudio();
  const screen = createFakeScreen([new Uint8Array([1]), new Uint8Array([2])]);
  const engine = createApiKeyEngine({
    config: {
      apiKey: () => TEST_KEY,
      model: "m",
      voice: "Kore"
    },
    monitor: TEST_MONITOR,
    audio: audio.audio,
    screen: screen.source,
    log: () => undefined,
    connect: network.connect
  });
  const events: LiveEvent[] = [];
  engine.onEvent(event => void events.push(event));
  return {
    engine,
    network,
    audio,
    screen,
    events
  };
}

async function started() {
  mock.timers.enable({ apis: ["setInterval"] });
  const fixture = setup();
  await fixture.engine.start();
  const socket = fixture.network.sockets[0];
  assert.ok(socket);
  return {
    ...fixture,
    socket
  };
}

describe("api key engine", () => {
  afterEach(() => mock.timers.reset());

  it("is the API-key engine and reports levels", () => {
    const { engine } = setup();
    assert.equal(engine.kind, EngineKind.apiKey);
    assert.equal(engine.reportsLevels, true);
  });

  it("starts the connection, then audio, then frames", async () => {
    const { engine, audio, socket } = await started();
    await flush();
    assert.deepEqual(audio.calls, ["start"]);
    assert.equal(socket.sent.length, 2);
    await engine.dispose();
  });

  it("sends mic chunks upstream", async () => {
    const { engine, audio, socket } = await started();
    audio.emitChunk(FRAME_BYTES);
    assert.ok(socket.sent.some(message => "realtimeInput" in message && message.realtimeInput.audio));
    await engine.dispose();
  });

  it("plays model audio and flushes on interrupted", async () => {
    const { engine, audio, socket } = await started();
    socket.serverSend({
      serverContent: {
        interrupted: true,
        modelTurn: {
          parts: [{
            inlineData: {
              mimeType: "audio/pcm;rate=24000",
              data: PCM_BASE64
            }
          }]
        }
      }
    });
    assert.deepEqual(audio.played, [PCM_BYTES]);
    assert.ok(audio.calls.includes("flush"));
    await engine.dispose();
  });

  it("emits whole utterances and starts a new one when the speaker changes", async () => {
    const { engine, socket, events } = await started();
    socket.serverSend({
      serverContent: {
        inputTranscription: {
          text: " What is"
        }
      }
    });
    socket.serverSend({
      serverContent: {
        inputTranscription: {
          text: " this? "
        }
      }
    });
    socket.serverSend({
      serverContent: {
        outputTranscription: {
          text: "A cat."
        }
      }
    });
    const transcripts = events.filter(event => event.kind === LiveEventKind.transcript);
    assert.deepEqual(transcripts, [
      {
        kind: LiveEventKind.transcript,
        text: "What is",
        isUser: true
      },
      {
        kind: LiveEventKind.transcript,
        text: "What is this?",
        isUser: true
      },
      {
        kind: LiveEventKind.transcript,
        text: "A cat.",
        isUser: false
      }
    ]);
    await engine.dispose();
  });

  it("reports levels per speaker and zeroes a muted mic", async () => {
    const { engine, audio, events } = await started();
    audio.emitMicLevel(MIC_PEAK);
    engine.isMuted = true;
    audio.emitMicLevel(LOUD_PEAK);
    audio.emitSpeakerLevel(SPEAKER_PEAK);
    const levels = events.filter(event => event.kind === LiveEventKind.level);
    assert.deepEqual(levels, [
      {
        kind: LiveEventKind.level,
        peak: MIC_PEAK,
        isUser: true
      },
      {
        kind: LiveEventKind.level,
        peak: 0,
        isUser: true
      },
      {
        kind: LiveEventKind.level,
        peak: SPEAKER_PEAK,
        isUser: false
      }
    ]);
    assert.equal(audio.audio.isMuted, true);
    await engine.dispose();
  });

  it("forwards session status and the end of the conversation", async () => {
    const { engine, socket, events } = await started();
    socket.serverSend({
      goAway: {}
    });
    await flush();
    assert.deepEqual(events.map(event => event.kind), [LiveEventKind.status, LiveEventKind.status]);
    const second = events[1];
    assert.ok(second?.kind === LiveEventKind.status && second.status === LiveStatus.listening);
    await engine.dispose();
  });

  it("ends when the server closes", async () => {
    const { engine, socket, events } = await started();
    socket.serverClose({
      code: 1011,
      reason: "Quota exceeded"
    });
    assert.deepEqual(events, [{
      kind: LiveEventKind.ended,
      reason: "Quota exceeded"
    }]);
    await engine.dispose();
  });

  it("sends a still every interval and drops the region when another display is shared", async () => {
    const { engine, screen, socket } = await started();
    await flush();
    mock.timers.tick(FRAME_INTERVAL_MS);
    await flush();
    assert.equal(screen.targets.length, 2);
    engine.region = {
      x: 1,
      y: 1,
      width: 5,
      height: 5
    };
    engine.share({
      ...TEST_MONITOR,
      deviceName: "DISPLAY2",
      index: 2
    });
    assert.equal(engine.region, undefined);
    assert.equal(engine.monitor.index, 2);
    mock.timers.tick(FRAME_INTERVAL_MS);
    await flush();
    assert.equal(screen.targets.at(-1)?.monitor.index, 2);
    assert.ok(socket.sent.some(message => "realtimeInput" in message && message.realtimeInput.video));
    await engine.dispose();
  });

  it("disposes the screen loop and audio before closing the socket", async () => {
    const { engine, audio, screen, socket } = await started();
    await flush();
    await engine.dispose();
    const captured = screen.targets.length;
    mock.timers.tick(FRAME_INTERVAL_MS * IDLE_TICKS);
    await flush();
    assert.equal(screen.targets.length, captured);
    assert.ok(audio.calls.includes("dispose"));
    assert.deepEqual(socket.closes, [{
      code: 1000,
      reason: "bye"
    }]);
  });
});
