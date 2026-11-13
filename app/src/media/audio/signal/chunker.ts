import { pcm16ToBytes } from "./pcm.ts";

// Cuts a stream of PCM16 samples into chunks of exactly `chunkSamples`, whatever size the pieces arrive in
export function createChunker({ chunkSamples }: { chunkSamples: number }) {
  let pending = new Int16Array(chunkSamples * 2);
  let filled = 0;

  function grow(needed: number) {
    const isNeededAtMostLength = needed <= pending.length;
    if (isNeededAtMostLength) {
      return;
    }

    const bigger = new Int16Array(Math.max(needed, pending.length * 2));
    bigger.set(pending.subarray(0, filled));
    pending = bigger;
  }

  function push(samples: Int16Array) {
    grow(filled + samples.length);
    pending.set(samples, filled);
    filled += samples.length;
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let consumed = 0;
    while (filled - consumed >= chunkSamples) {
      chunks.push(pcm16ToBytes(pending.subarray(consumed, consumed + chunkSamples)));
      consumed += chunkSamples;
    }
    pending.copyWithin(0, consumed, filled);
    filled -= consumed;
    return chunks;
  }

  return {
    push,
    get pendingSamples() {
      return filled;
    }
  };
}
