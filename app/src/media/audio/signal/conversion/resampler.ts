interface ResampleRun {
  input: Float32Array;
  position: number;
  step: number;
  last: number;
}

function sampleAt({ input, index, last }: { input: Float32Array; index: number; last: number }) {
  return index < 0 ? last : (input[index] ?? 0);
}

function shrink({ input, position, step, last }: ResampleRun) {
  const output: number[] = [];
  while (position + step <= input.length) {
    const start = Math.max(0, Math.trunc(position));
    const end = Math.trunc(position + step);
    let sum = 0;
    for (let iSample = start; iSample < end; iSample++) {
      sum += input[iSample] ?? 0;
    }
    const isWindowEmpty = end <= start;
    output.push(
      isWindowEmpty
        ? sampleAt({
            input,
            index: start - 1,
            last
          })
        : sum / (end - start)
    );
    position += step;
  }
  return {
    output,
    position
  };
}

function grow({ input, position, step, last }: ResampleRun) {
  const output: number[] = [];
  while (position < input.length - 1) {
    const index = Math.floor(position);
    const fraction = position - index;
    const current = sampleAt({
      input,
      index,
      last
    });
    output.push(
      current +
        (sampleAt({
          input,
          index: index + 1,
          last
        }) -
          current) *
          fraction
    );
    position += step;
  }
  return {
    output,
    position
  };
}

// Streaming linear resampler, a port of AudioEngine.Resampler: shrinking the rate averages the input
// window per output sample (a cheap anti-alias, plenty for speech), growing it interpolates. State
// carries across chunks so the seams are continuous.
export function createResampler({ from, to }: { from: number; to: number }) {
  const step = from / to;
  const isPassThrough = from === to;
  const isShrinking = step > 1;
  let position = 0;
  let last = 0;

  function process(input: Float32Array) {
    const isIsPassThroughOrInputEmpty = isPassThrough || input.length === 0;
    if (isIsPassThroughOrInputEmpty) {
      return input;
    }

    const run = {
      input,
      position,
      step,
      last
    };
    const result = isShrinking ? shrink(run) : grow(run);
    position = result.position - input.length;
    last = input[input.length - 1] ?? 0;
    return Float32Array.from(result.output);
  }

  return { process };
}
