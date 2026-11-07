import { createAudioDuplex } from "./audio-duplex.ts";
import type { AudioWorkerLink } from "./audio-duplex.ts";
import { AudioCommandKind, AudioEventKind } from "./audio-protocol.ts";
import type { AudioCommand } from "./audio-protocol.ts";
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

const NUMBER_1000 = 1000;
const NUMBER_4 = 4;
const NUMBER_3 = 3;
const NUMBER_0_POINT_6 = 0.6;
const NUMBER_0_POINT_3 = 0.3;

function ignoreMessage() {
  return undefined;
}

function createFakeLink() {
  const posted: Array<{
    command: AudioCommand;
    transfer: readonly ArrayBuffer[];
  }> = [];
  let listener: (message: unknown) => void = ignoreMessage;
  let terminations = 0;
  const link: AudioWorkerLink = {
    post: (command, transfer = []) => posted.push({
      command,
      transfer
    }),
    onMessage(next) {
      listener = next;
    },
    terminate() {
      terminations += 1;
      return Promise.resolve();
    }
  };
  return {
    link,
    posted,
    emit: (message: unknown) => listener(message),
    get terminations() {
      return terminations;
    }
  };
}

function setup({ microphoneId = null }: { microphoneId?: string | null } = {}) {
  const fake = createFakeLink();
  const duplex = createAudioDuplex({
    link: fake.link,
    microphoneId: () => microphoneId
  });
  return {
    fake,
    duplex
  };
}

describe("audio duplex", () => {
  it("start posts the microphone id and resolves on started", async () => {
    const { fake, duplex } = setup({ microphoneId: "mic-7" });
    const started = duplex.start();
    assert.deepEqual(fake.posted[0]?.command, {
      kind: AudioCommandKind.start,
      deviceId: "mic-7",
      isLoopback: false
    });
    fake.emit({ kind: AudioEventKind.started });
    await started;
  });

  it("start asks for the default microphone with null", () => {
    const { fake, duplex } = setup();
    void duplex.start();
    assert.equal(fake.posted[0]?.command.kind === AudioCommandKind.start && fake.posted[0].command.deviceId, null);
  });

  it("start rejects with the failure message", async () => {
    const { fake, duplex } = setup();
    const started = duplex.start();
    fake.emit({
      kind: AudioEventKind.failed,
      message: "Microphone access is off"
    });
    await assert.rejects(started, /Microphone access is off/);
  });

  it("a failure after start goes to onFailure instead", async () => {
    const { fake, duplex } = setup();
    const failures: string[] = [];
    duplex.onFailure(message => failures.push(message));
    const started = duplex.start();
    fake.emit({ kind: AudioEventKind.started });
    await started;
    fake.emit({
      kind: AudioEventKind.failed,
      message: "device removed"
    });
    assert.deepEqual(failures, ["device removed"]);
  });

  it("fans mic chunks and both levels out to their listeners, until unsubscribed", () => {
    const { fake, duplex } = setup();
    const chunks: Uint8Array[] = [];
    const micLevels: number[] = [];
    const speakerLevels: number[] = [];
    const stopChunks = duplex.onMicChunk(chunk => chunks.push(chunk));
    duplex.onMicLevel(level => micLevels.push(level));
    duplex.onSpeakerLevel(level => speakerLevels.push(level));
    fake.emit({
      kind: AudioEventKind.micChunk,
      pcm16: Uint8Array.of(1, 2)
    });
    fake.emit({
      kind: AudioEventKind.micLevel,
      peak: 0.3
    });
    fake.emit({
      kind: AudioEventKind.speakerLevel,
      peak: 0.6
    });
    stopChunks();
    fake.emit({
      kind: AudioEventKind.micChunk,
      pcm16: Uint8Array.of(NUMBER_3)
    });
    assert.deepEqual(chunks, [Uint8Array.of(1, 2)]);
    assert.deepEqual(micLevels, [NUMBER_0_POINT_3]);
    assert.deepEqual(speakerLevels, [NUMBER_0_POINT_6]);
  });

  it("play hands over a copy, so the caller can reuse its buffer", () => {
    const { fake, duplex } = setup();
    const speech = Uint8Array.of(1, 2, NUMBER_3, NUMBER_4);
    duplex.play(speech);
    const posted = fake.posted[0];
    assert.equal(posted?.command.kind, AudioCommandKind.play);
    assert.equal(posted?.transfer.length, 1);
    assert.equal(speech.buffer.byteLength > 0 && speech.length, NUMBER_4);
    assert.notEqual(posted?.transfer[0], speech.buffer);
  });

  it("flush and mute are forwarded, and mute reads back", () => {
    const { fake, duplex } = setup();
    duplex.flush();
    duplex.isMuted = true;
    assert.equal(duplex.isMuted, true);
    assert.deepEqual(fake.posted.map(entry => entry.command), [
      { kind: AudioCommandKind.flush },
      {
        kind: AudioCommandKind.mute,
        isMuted: true
      }
    ]);
  });

  it("dispose posts once, ignores later plays, and terminates after the worker acknowledges", () => {
    const { fake, duplex } = setup();
    duplex.dispose();
    duplex.dispose();
    duplex.play(Uint8Array.of(1));
    assert.equal(fake.posted.length, 1);
    assert.equal(fake.posted[0]?.command.kind, AudioCommandKind.dispose);
    fake.emit({ kind: AudioEventKind.disposed });
    assert.equal(fake.terminations, 1);
  });

  it("terminates anyway when the worker never acknowledges", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const { fake, duplex } = setup();
      duplex.dispose();
      mock.timers.tick(NUMBER_1000);
      assert.equal(fake.terminations, 1);
    } finally {
      mock.timers.reset();
    }
  });

  it("treats an unreadable event as a failure", async () => {
    const { fake, duplex } = setup();
    const started = duplex.start();
    fake.emit({ kind: "nonsense" });
    await assert.rejects(started, /Unreadable audio event/);
  });
});
