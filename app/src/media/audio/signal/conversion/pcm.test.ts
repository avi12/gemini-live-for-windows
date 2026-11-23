import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bytesToFloats,
  floatsToPcm16,
  floatToPcm16,
  mixToMono,
  pcm16ToBytes,
  pcm16ToFloat,
  peakOf,
  spreadToChannels
} from "./pcm.ts";

const NUMBER_4 = 4;
const NUMBER_0_POINT_7 = 0.7;
const NUMBER_0_POINT_3 = 0.3;
const NEGATIVE_NUMBER_0_POINT_7 = -0.7;
const NUMBER_0_POINT_1 = 0.1;
const NUMBER_300 = 300;
const NEGATIVE_NUMBER_200 = -200;
const NUMBER_100 = 100;
const NUMBER_1000 = 1000;
const NEGATIVE_NUMBER_0_POINT_2 = -0.2;
const NUMBER_5 = 5;
const NUMBER_0_POINT_6 = 0.6;
const NEGATIVE_NUMBER_0_POINT_25 = -0.25;
const NUMBER_0_POINT_25 = 0.25;
const NUMBER_0_POINT_5 = 0.5;
const NEGATIVE_NUMBER_32_768 = -32_768;
const HEX_40 = 0x40;
const NUMBER_9 = 9;
const NUMBER_7 = 7;
const NUMBER_32_768 = 32_768;
const NUMBER_32_767 = 32_767;
const NEGATIVE_NUMBER_0_POINT_5 = -0.5;
const HEX_7F = 0x7f;
const HEX_FF = 0xff;
const HEX_C0 = 0xc0;
const HEX_12 = 0x12;
const HEX_34 = 0x34;
const HEX_FE = 0xfe;
const HEX_1234 = 0x1234;
const NEGATIVE_NUMBER_2 = -2;
const NEGATIVE_NUMBER_32_767 = -32_767;
const NUMBER_16_384 = 16_384;

const ROUND_TRIP_SAMPLES = 2001;
const ROUND_TRIP_HALF = 1000;
const TWO_STEPS = 2 / NUMBER_32_768;
const TOLERANCE = 1e-6;

describe("float to PCM16", () => {
  it("maps silence, full scale and half scale", () => {
    assert.equal(floatToPcm16(0), 0);
    assert.equal(floatToPcm16(1), NUMBER_32_767);
    assert.equal(floatToPcm16(-1), NEGATIVE_NUMBER_32_767);
    assert.equal(floatToPcm16(NUMBER_0_POINT_5), NUMBER_16_384);
  });

  it("clamps what overshoots", () => {
    assert.equal(floatToPcm16(2), NUMBER_32_767);
    assert.equal(floatToPcm16(NEGATIVE_NUMBER_2), NEGATIVE_NUMBER_32_768);
    assert.equal(floatToPcm16(Number.POSITIVE_INFINITY), NUMBER_32_767);
  });

  it("zeroes everything when muted, keeping the length", () => {
    const pcm = floatsToPcm16({
      samples: Float32Array.of(NUMBER_0_POINT_5, NEGATIVE_NUMBER_0_POINT_5, 1),
      isMuted: true
    });
    assert.deepEqual([...pcm], [0, 0, 0]);
  });

  it("converts a whole buffer", () => {
    const pcm = floatsToPcm16({ samples: Float32Array.of(0, 1, -1) });
    assert.deepEqual([...pcm], [0, NUMBER_32_767, NEGATIVE_NUMBER_32_767]);
  });
});

describe("PCM16 bytes", () => {
  it("writes little-endian", () => {
    const bytes = pcm16ToBytes(Int16Array.of(1, NEGATIVE_NUMBER_2, HEX_1234));
    assert.deepEqual([...bytes], [1, 0, HEX_FE, HEX_FF, HEX_34, HEX_12]);
  });

  it("reads little-endian back to floats", () => {
    const floats = bytesToFloats(Uint8Array.of(0, HEX_40, 0, HEX_C0, HEX_FF, HEX_7F));
    assert.deepEqual([...floats], [NUMBER_0_POINT_5, NEGATIVE_NUMBER_0_POINT_5, NUMBER_32_767 / NUMBER_32_768]);
  });

  it("drops a trailing odd byte", () => {
    assert.equal(bytesToFloats(Uint8Array.of(0, 0, NUMBER_7)).length, 1);
  });

  it("reads from a view that does not start at zero", () => {
    const backing = Uint8Array.of(NUMBER_9, NUMBER_9, 0, HEX_40);
    assert.deepEqual([...bytesToFloats(backing.subarray(2))], [NUMBER_0_POINT_5]);
  });

  it("is empty for empty input", () => {
    assert.equal(bytesToFloats(new Uint8Array(0)).length, 0);
    assert.equal(pcm16ToBytes(new Int16Array(0)).length, 0);
  });

  it("round trips every sample within two steps", () => {
    const original = Float32Array.from(
      { length: ROUND_TRIP_SAMPLES },
      (_, iSample) => (iSample - ROUND_TRIP_HALF) / ROUND_TRIP_HALF
    );
    const back = bytesToFloats(pcm16ToBytes(floatsToPcm16({ samples: original })));
    for (const [iSample, sample] of original.entries()) {
      assert.ok(Math.abs((back[iSample] ?? 0) - sample) <= TWO_STEPS, String(iSample));
    }
  });

  it("maps the extremes the way the speaker needs them", () => {
    assert.equal(pcm16ToFloat(NEGATIVE_NUMBER_32_768), -1);
    assert.equal(pcm16ToFloat(0), 0);
  });
});

describe("mono mix", () => {
  it("averages the channels of each frame", () => {
    const mono = mixToMono({
      interleaved: Float32Array.of(1, 0, NUMBER_0_POINT_5, NUMBER_0_POINT_5, -1, 1),
      channels: 2
    });
    assert.deepEqual([...mono], [NUMBER_0_POINT_5, NUMBER_0_POINT_5, 0]);
  });

  it("passes a mono signal through", () => {
    const mono = mixToMono({
      interleaved: Float32Array.of(NUMBER_0_POINT_25, NEGATIVE_NUMBER_0_POINT_25),
      channels: 1
    });
    assert.deepEqual([...mono], [NUMBER_0_POINT_25, NEGATIVE_NUMBER_0_POINT_25]);
  });

  it("mixes six channels", () => {
    const mono = mixToMono({
      interleaved: Float32Array.of(NUMBER_0_POINT_6, 0, 0, 0, 0, 0),
      channels: 6
    });
    assert.ok(Math.abs((mono[0] ?? 0) - NUMBER_0_POINT_1) < TOLERANCE);
  });

  it("ignores a trailing partial frame", () => {
    const mono = mixToMono({
      interleaved: new Float32Array(NUMBER_5),
      channels: 2
    });
    assert.equal(mono.length, 2);
  });
});

describe("spread to channels", () => {
  it("repeats each sample on every channel", () => {
    const interleaved = spreadToChannels({
      mono: Float32Array.of(1, 2),
      channels: 3
    });
    assert.deepEqual([...interleaved], [1, 1, 1, 2, 2, 2]);
  });

  it("is the inverse of the mono mix", () => {
    const interleaved = spreadToChannels({
      mono: Float32Array.of(NUMBER_0_POINT_1, NEGATIVE_NUMBER_0_POINT_2, NUMBER_0_POINT_3),
      channels: 6
    });
    const mono = mixToMono({
      interleaved,
      channels: 6
    });
    const thousandths = [...mono].map(sample => Math.round(sample * NUMBER_1000));
    assert.deepEqual(thousandths, [NUMBER_100, NEGATIVE_NUMBER_200, NUMBER_300]);
  });
});

describe("peak", () => {
  it("is the largest magnitude, either sign", () => {
    const samples = Float32Array.of(NUMBER_0_POINT_1, NEGATIVE_NUMBER_0_POINT_7, NUMBER_0_POINT_3);
    assert.equal(peakOf(samples), Math.fround(NUMBER_0_POINT_7));
  });

  it("is zero for silence and for nothing", () => {
    assert.equal(peakOf(new Float32Array(NUMBER_4)), 0);
    assert.equal(peakOf(new Float32Array(0)), 0);
  });
});
