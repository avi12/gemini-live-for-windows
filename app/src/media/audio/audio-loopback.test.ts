import { createAudioDuplex } from "./audio-duplex.ts";
import { createAudioWorkerLink } from "./audio-worker-link.ts";
import { bytesToFloats } from "./pcm.ts";
import { concatenate, pcm16BytesOf, risingZeroCrossings, sine } from "./test-signals.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

const NUMBER_0_POINT_4 = 0.4;
const NUMBER_12 = 12;
const NUMBER_16_000 = 16_000;
const NUMBER_0_POINT_2 = 0.2;
const NUMBER_0_POINT_01 = 0.01;
const NUMBER_1000 = 1000;

const IS_WINDOWS = process.platform === "win32";
const TONE = 440;
const SPEECH_RATE = 24_000;
const PLAY_SECONDS = 2;
const SETTLE_MILLISECONDS = 800;
const MIC_BYTES_PER_CHUNK = 1280;

// The real worker thread over the device-free fixture graph: speech played in comes back out of the
// mic tap. The render device is opened at gain 0 (to clock the graph), so nothing is audible and no
// microphone is touched. Skips where there is no render device.
describe("audio loopback through the real worker", { skip: !IS_WINDOWS }, () => {
  it("plays a tone through the speaker pump and hears it, intact, at the mic", async t => {
    const duplex = createAudioDuplex({
      link: createAudioWorkerLink({ workerUrl: new URL("./audio-worker.ts", import.meta.url) }),
      microphoneId: () => null,
      isLoopback: true
    });
    const chunks: Uint8Array[] = [];
    const levels: number[] = [];
    duplex.onMicChunk(chunk => chunks.push(chunk));
    duplex.onMicLevel(level => levels.push(level));
    try {
      await duplex.start();
    } catch (error) {
      duplex.dispose();
      t.skip(`no render device: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    duplex.play(
      pcm16BytesOf(
        sine({
          frequency: TONE,
          sampleRate: SPEECH_RATE,
          seconds: PLAY_SECONDS
        })
      )
    );
    await sleep(PLAY_SECONDS * NUMBER_1000 + SETTLE_MILLISECONDS);
    duplex.dispose();

    assert.ok(chunks.length > 0);
    for (const chunk of chunks) {
      assert.equal(chunk.length, MIC_BYTES_PER_CHUNK);
    }
    const heard = concatenate(chunks.map(chunk => bytesToFloats(chunk)));
    const loud = heard.filter(sample => Math.abs(sample) > NUMBER_0_POINT_01);
    assert.ok(loud.length > SPEECH_RATE * (PLAY_SECONDS - NUMBER_0_POINT_2) * (NUMBER_16_000 / SPEECH_RATE));
    const crossings = risingZeroCrossings(heard);
    assert.ok(Math.abs(crossings - TONE * PLAY_SECONDS) <= NUMBER_12, String(crossings));
    assert.ok(Math.max(...levels) > NUMBER_0_POINT_4);
  });
});
