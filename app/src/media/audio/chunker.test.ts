import { createChunker } from "./chunker.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const NUMBER_20 = 20;
const NUMBER_1280 = 1280;
const NUMBER_1300 = 1300;
const NUMBER_12 = 12;
const NUMBER_7 = 7;
const NUMBER_3 = 3;
const NUMBER_9 = 9;
const NUMBER_5 = 5;
const NUMBER_6 = 6;
const NUMBER_4 = 4;

const CHUNK = 4;

function ramp({ from, count }: {
  from: number;
  count: number;
}) {
  return Int16Array.from({ length: count }, (_, iSample) => from + iSample);
}

function samplesOf(chunk: Uint8Array) {
  return [...new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2)];
}

describe("chunker", () => {
  it("emits nothing until a whole chunk is there", () => {
    const chunker = createChunker({ chunkSamples: CHUNK });
    assert.deepEqual(
      chunker.push(
        ramp({
          from: 0,
          count: 3
        })
      ), []
    );
    assert.equal(chunker.pendingSamples, NUMBER_3);
  });

  it("emits a chunk of exactly the size, in bytes", () => {
    const chunker = createChunker({ chunkSamples: CHUNK });
    const [chunk, ...rest] = chunker.push(
      ramp({
        from: 0,
        count: 4
      })
    );
    assert.equal(chunk?.length, CHUNK * 2);
    assert.equal(rest.length, 0);
    assert.equal(chunker.pendingSamples, 0);
  });

  it("carries the remainder into the next push", () => {
    const chunker = createChunker({ chunkSamples: CHUNK });
    chunker.push(
      ramp({
        from: 0,
        count: 3
      })
    );
    const [chunk] = chunker.push(
      ramp({
        from: 3,
        count: 3
      })
    );
    assert.deepEqual(samplesOf(chunk ?? new Uint8Array(0)), [0, 1, 2, NUMBER_3]);
    assert.equal(chunker.pendingSamples, 2);
  });

  it("cuts several chunks out of one big push", () => {
    const chunker = createChunker({ chunkSamples: CHUNK });
    const chunks = chunker.push(
      ramp({
        from: 0,
        count: 10
      })
    );
    assert.equal(chunks.length, 2);
    assert.deepEqual(samplesOf(chunks[1] ?? new Uint8Array(0)), [NUMBER_4, NUMBER_5, NUMBER_6, NUMBER_7]);
    assert.equal(chunker.pendingSamples, 2);
  });

  it("never loses or reorders a sample whatever the push sizes", () => {
    const chunker = createChunker({ chunkSamples: CHUNK });
    const emitted: number[] = [];
    let next = 0;
    for (const size of [1, NUMBER_5, 2, NUMBER_9, NUMBER_3, 1, NUMBER_7, NUMBER_12]) {
      for (const chunk of chunker.push(
        ramp({
          from: next,
          count: size
        })
      )) {
        emitted.push(...samplesOf(chunk));
      }
      next += size;
    }
    assert.deepEqual(emitted, [...ramp({
      from: 0,
      count: emitted.length
    })]);
    assert.equal(emitted.length + chunker.pendingSamples, next);
  });

  it("gives each chunk its own memory", () => {
    const chunker = createChunker({ chunkSamples: CHUNK });
    const [first, second] = chunker.push(
      ramp({
        from: 0,
        count: 8
      })
    );
    assert.notEqual(first?.buffer, second?.buffer);
  });

  it("cuts 640 samples, 1280 bytes, for 40 ms at 16 kHz", () => {
    const chunker = createChunker({ chunkSamples: 640 });
    const chunks = chunker.push(new Int16Array(NUMBER_1300));
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0]?.length, NUMBER_1280);
    assert.equal(chunker.pendingSamples, NUMBER_20);
  });

  it("ignores an empty push", () => {
    const chunker = createChunker({ chunkSamples: CHUNK });
    assert.deepEqual(chunker.push(new Int16Array(0)), []);
  });
});
