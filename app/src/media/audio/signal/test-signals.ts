import { floatToPcm16, pcm16ToBytes } from "./pcm.ts";

const DEFAULT_AMPLITUDE = 0.5;

export function sine({ frequency, sampleRate, seconds, amplitude = DEFAULT_AMPLITUDE }: {
  frequency: number;
  sampleRate: number;
  seconds: number;
  amplitude?: number;
}) {
  const samples = new Float32Array(Math.round(sampleRate * seconds));
  for (let iSample = 0; iSample < samples.length; iSample++) {
    samples[iSample] = amplitude * Math.sin((2 * Math.PI * frequency * iSample) / sampleRate);
  }
  return samples;
}

export function rootMeanSquare(samples: Float32Array) {
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}

export function risingZeroCrossings(samples: Float32Array) {
  let count = 0;
  for (let iSample = 1; iSample < samples.length; iSample++) {
    const isRising = (samples[iSample - 1] ?? 0) < 0 && (samples[iSample] ?? 0) >= 0;
    if (isRising) {
      count += 1;
    }
  }
  return count;
}

export function concatenate(pieces: readonly Float32Array[]) {
  let length = 0;
  for (const piece of pieces) {
    length += piece.length;
  }
  const joined = new Float32Array(length);
  let offset = 0;
  for (const piece of pieces) {
    joined.set(piece, offset);
    offset += piece.length;
  }
  return joined;
}

export function pcm16BytesOf(samples: Float32Array) {
  return pcm16ToBytes(Int16Array.from(samples, floatToPcm16));
}
