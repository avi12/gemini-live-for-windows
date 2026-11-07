import { LiveStatus } from "@/contracts/live-engine.ts";
import { SYSTEM_PROMPT } from "@/live/api/constants.ts";
import { createLiveSession } from "@/live/api/live-session.ts";
import {
  createFakeNetwork,
  flush,
  FRAME_BASE64,
  FRAME_BYTES,
  PCM_BASE64,
  PCM_BYTES,
  setupOf,
  TEST_KEY
} from "@/live/fakes.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function setup(network = createFakeNetwork()) {
  const events: string[] = [];
  const logs: string[] = [];
  const audio: Uint8Array[] = [];
  const session = createLiveSession({
    config: {
      apiKey: () => TEST_KEY,
      model: "gemini-live-test",
      voice: "Kore"
    },
    connect: network.connect,
    log: message => void logs.push(message),
    listeners: {
      onAudio: pcm16 => void audio.push(pcm16),
      onInterrupted: () => void events.push("interrupted"),
      onUserText: text => void events.push(`user:${text}`),
      onModelText: text => void events.push(`model:${text}`),
      onStatus: status => void events.push(`status:${status}`),
      onClosed: reason => void events.push(`closed:${reason}`)
    }
  });
  return {
    session,
    network,
    events,
    logs,
    audio
  };
}

async function opened(network = createFakeNetwork()) {
  const fixture = setup(network);
  await fixture.session.open();
  const first = fixture.network.sockets[0];
  assert.ok(first);
  return {
    ...fixture,
    first
  };
}

describe("live session setup", () => {
  it("sends the setup message with the model, voice, tools and resumption", async () => {
    const { first } = await opened();
    const [setupMessage] = first.sent;
    assert.deepEqual(setupMessage, {
      setup: {
        model: "models/gemini-live-test",
        generationConfig: {
          responseModalities: ["AUDIO"],
          mediaResolution: "MEDIA_RESOLUTION_MEDIUM",
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Kore"
              }
            }
          }
        },
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        },
        tools: [{
          googleSearch: {}
        }],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        contextWindowCompression: {
          slidingWindow: {}
        },
        sessionResumption: {}
      }
    });
  });

  it("puts the key in the url", async () => {
    const { network } = await opened();
    assert.ok(network.urls[0]?.endsWith(`?key=${TEST_KEY}`));
  });

  it("rejects when the server closes during setup, with its reason", async () => {
    const network = createFakeNetwork({ isSetupAnswered: false });
    const { session } = setup(network);
    const pending = session.open();
    await flush();
    network.sockets[0]?.serverClose({
      code: 1007,
      reason: "API key not valid"
    });
    await assert.rejects(pending, /Setup rejected: API key not valid/);
  });

  it("rejects when the first answer is not setupComplete", async () => {
    const network = createFakeNetwork({ isSetupAnswered: false });
    const { session } = setup(network);
    const pending = session.open();
    await flush();
    network.sockets[0]?.serverSendRaw("{\"goAway\":{}}");
    await assert.rejects(pending, /Setup rejected: /);
  });

  it("rejects without leaking the key when the socket cannot be created", async () => {
    const network = createFakeNetwork();
    network.failConnect();
    const { session } = setup(network);
    await assert.rejects(session.open(), error => error instanceof Error && !error.message.includes(TEST_KEY));
  });
});

describe("live session upstream", () => {
  it("sends mic audio and frames as base64 realtime input", async () => {
    const { session, first } = await opened();
    session.sendAudio(PCM_BYTES);
    session.sendFrame(FRAME_BYTES);
    assert.deepEqual(first.sent.slice(1), [
      {
        realtimeInput: {
          audio: {
            mimeType: "audio/pcm;rate=16000",
            data: PCM_BASE64
          }
        }
      },
      {
        realtimeInput: {
          video: {
            mimeType: "image/jpeg",
            data: FRAME_BASE64
          }
        }
      }
    ]);
  });
});

describe("live session downstream", () => {
  it("plays audio, interrupts and forwards transcripts", async () => {
    const { first, events, audio } = await opened();
    first.serverSend({
      serverContent: {
        interrupted: true,
        modelTurn: {
          parts: [{
            inlineData: {
              mimeType: "audio/pcm;rate=24000",
              data: PCM_BASE64
            }
          }]
        },
        inputTranscription: {
          text: "hi"
        },
        outputTranscription: {
          text: "hello"
        }
      }
    });
    assert.deepEqual(events, ["interrupted", "user:hi", "model:hello"]);
    assert.deepEqual(audio, [PCM_BYTES]);
  });

  it("ignores empty transcriptions", async () => {
    const { first, events } = await opened();
    first.serverSend({
      serverContent: {
        inputTranscription: {},
        outputTranscription: {
          text: ""
        }
      }
    });
    assert.deepEqual(events, []);
  });

  it("logs each unhandled field once", async () => {
    const { first, logs } = await opened();
    first.serverSend({
      usageMetadata: {}
    });
    first.serverSend({
      usageMetadata: {}
    });
    assert.deepEqual(logs, ["live api: ignoring \"usageMetadata\""]);
  });

  it("closes with the server's reason, or a default", async () => {
    const withReason = await opened();
    withReason.first.serverClose({
      code: 1011,
      reason: "Quota exceeded"
    });
    assert.deepEqual(withReason.events, ["closed:Quota exceeded"]);
    const withoutReason = await opened();
    withoutReason.first.serverClose({
      code: 1006,
      reason: ""
    });
    assert.deepEqual(withoutReason.events, ["closed:Session ended"]);
  });

  it("ends the session on a message it cannot read", async () => {
    const { first, events } = await opened();
    first.serverSendRaw("not json");
    assert.equal(events.length, 1);
    assert.match(events[0] ?? "", /^closed:/);
  });
});

describe("live session reconnect", () => {
  it("resumes into the same conversation after goAway", async () => {
    const { session, network, first, events } = await opened();
    first.serverSend({
      sessionResumptionUpdate: {
        resumable: true,
        newHandle: "handle-1"
      }
    });
    first.serverSend({
      goAway: {
        timeLeft: "10s"
      }
    });
    await flush();
    const second = network.sockets[1];
    assert.ok(second);
    assert.deepEqual(events, [`status:${LiveStatus.reconnecting}`, `status:${LiveStatus.listening}`]);
    assert.equal(first.closes.length, 1);
    assert.deepEqual(
      setupOf(second.sent[0])?.sessionResumption,
      { handle: "handle-1" }
    );
    session.sendAudio(new Uint8Array([1]));
    assert.equal(second.sent.length, 2);
    assert.equal(first.sent.length, 1);
  });

  it("does not report the retired socket closing", async () => {
    const { first, events } = await opened();
    first.serverSend({
      goAway: {}
    });
    await flush();
    assert.ok(!events.some(event => event.startsWith("closed:")));
  });

  it("ignores a resumption update that is not resumable", async () => {
    const { network, first } = await opened();
    first.serverSend({
      sessionResumptionUpdate: {
        newHandle: "ignored"
      }
    });
    first.serverSend({
      goAway: {}
    });
    await flush();
    assert.deepEqual(
      setupOf(network.sockets[1]?.sent[0])?.sessionResumption,
      {}
    );
  });

  it("reports a failed reconnect", async () => {
    const { network, first, events } = await opened();
    network.failConnect();
    first.serverSend({
      goAway: {}
    });
    await flush();
    assert.deepEqual(events, [
      `status:${LiveStatus.reconnecting}`,
      "closed:Reconnect failed: Could not reach the Live API"
    ]);
  });
});

describe("live session dispose", () => {
  it("closes politely and stays silent afterwards", async () => {
    const { session, first, events } = await opened();
    await session.dispose();
    assert.deepEqual(first.closes, [{
      code: 1000,
      reason: "bye"
    }]);
    assert.deepEqual(events, []);
    session.sendAudio(new Uint8Array([1]));
    assert.equal(first.sent.length, 1);
  });
});
