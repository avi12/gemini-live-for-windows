import { BYTES_PER_PCM16_SAMPLE } from "@/live/api/constants.ts";

const PCM16_POSITIVE_SCALE = 32_767;
const PCM16_NEGATIVE_SCALE = 32_768;
const PCM16_MIN = -32_768;
const PCM16_MAX = 32_767;
const IS_LITTLE_ENDIAN = true;

export function floatToPcm16(sample: number) {
  const scaled = Math.round(sample * PCM16_POSITIVE_SCALE);
  return Math.min(PCM16_MAX, Math.max(PCM16_MIN, scaled));
}

export function pcm16ToFloat(sample: number) {
  return sample / PCM16_NEGATIVE_SCALE;
}

export function floatsToPcm16({ samples, isMuted = false }: { samples: Float32Array; isMuted?: boolean }) {
  const pcm = new Int16Array(samples.length);
  if (isMuted) {
    return pcm;
  }

  for (const [iSample, sample] of samples.entries()) {
    pcm[iSample] = floatToPcm16(sample);
  }
  return pcm;
}

export function pcm16ToBytes(pcm: Int16Array) {
  const bytes = new Uint8Array(pcm.length * BYTES_PER_PCM16_SAMPLE);
  const view = new DataView(bytes.buffer);
  for (const [iSample, sample] of pcm.entries()) {
    view.setInt16(iSample * BYTES_PER_PCM16_SAMPLE, sample, IS_LITTLE_ENDIAN);
  }
  return bytes;
}

export function bytesToFloats(bytes: Uint8Array) {
  const count = Math.floor(bytes.length / BYTES_PER_PCM16_SAMPLE);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(count);
  for (let iSample = 0; iSample < count; iSample++) {
    samples[iSample] = pcm16ToFloat(view.getInt16(iSample * BYTES_PER_PCM16_SAMPLE, IS_LITTLE_ENDIAN));
  }
  return samples;
}

export function mixToMono({ interleaved, channels }: { interleaved: Float32Array; channels: number }) {
  const frames = Math.floor(interleaved.length / channels);
  const mono = new Float32Array(frames);
  for (let iFrame = 0; iFrame < frames; iFrame++) {
    let sum = 0;
    for (let iChannel = 0; iChannel < channels; iChannel++) {
      sum += interleaved[iFrame * channels + iChannel] ?? 0;
    }
    mono[iFrame] = sum / channels;
  }
  return mono;
}

export function spreadToChannels({ mono, channels }: { mono: Float32Array; channels: number }) {
  const interleaved = new Float32Array(mono.length * channels);
  for (const [iFrame, sample] of mono.entries()) {
    interleaved.fill(sample, iFrame * channels, (iFrame + 1) * channels);
  }
  return interleaved;
}

export function peakOf(samples: Float32Array) {
  let peak = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
  }
  return peak;
}
