function drainPieces({ pieces, count, startOffset }: { pieces: Float32Array[]; count: number; startOffset: number }) {
  const output = new Float32Array(count);
  let headOffset = startOffset;
  let written = 0;
  let isUnderrun = false;
  while (written < count) {
    const head = pieces[0];
    const isHeadMissing = head === undefined;
    if (isHeadMissing) {
      isUnderrun = true;
      break;
    }

    const amount = Math.min(head.length - headOffset, count - written);
    output.set(head.subarray(headOffset, headOffset + amount), written);
    written += amount;
    headOffset += amount;

    const isLength = headOffset === head.length;
    if (isLength) {
      pieces.shift();
      headOffset = 0;
    }
  }
  return {
    output,
    written,
    headOffset,
    isUnderrun
  };
}

// Mono float samples waiting to be heard, bounded so a stalled graph cannot grow memory without limit.
// Reading past what is queued yields silence and counts an underrun.
export function createSpeakerQueue({ maxSamples }: { maxSamples: number }) {
  const pieces: Float32Array[] = [];
  let headOffset = 0;
  let queued = 0;
  let underruns = 0;
  let droppedSamples = 0;

  function enqueue(samples: Float32Array) {
    const isSamplesEmpty = samples.length === 0;
    if (isSamplesEmpty) {
      return true;
    }

    const isRoomy = queued + samples.length <= maxSamples;
    if (!isRoomy) {
      droppedSamples += samples.length;
      return false;
    }

    pieces.push(samples);
    queued += samples.length;
    return true;
  }

  function take(count: number) {
    const drained = drainPieces({
      pieces,
      count,
      startOffset: headOffset
    });
    headOffset = drained.headOffset;
    queued -= drained.written;

    if (drained.isUnderrun) {
      underruns += 1;
    }

    return drained.output;
  }

  function clear() {
    pieces.length = 0;
    headOffset = 0;
    queued = 0;
  }

  return {
    enqueue,
    take,
    clear,
    get queuedSamples() {
      return queued;
    },
    get underruns() {
      return underruns;
    },
    get droppedSamples() {
      return droppedSamples;
    }
  };
}
