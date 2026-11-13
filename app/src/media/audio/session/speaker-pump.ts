import { SPEAKER_RATE } from "@/live/api/constants.ts";
import { MILLISECONDS_PER_SECOND } from "@/media/audio/audio-format.ts";
import { bytesToFloats, peakOf, spreadToChannels } from "@/media/audio/signal/pcm.ts";
import { createResampler } from "@/media/audio/signal/resampler.ts";

import { createSpeakerQueue } from "./speaker-queue.ts";

const MAX_QUANTA_PER_TICK = 100;

// Where the pump feeds the graph's input node: samples are per channel, the frame is interleaved floats
export interface SpeakerSink {
  readonly queuedSamples: number;
  write(interleaved: Float32Array): void;
  discard(): void;
}

function feedSink({
  sink,
  queue,
  quantumSamples,
  channels,
  leadSamples,
  onLevel
}: {
  sink: SpeakerSink;
  queue: ReturnType<typeof createSpeakerQueue>;
  quantumSamples: number;
  channels: number;
  leadSamples: number;
  onLevel: (peak: number) => void;
}) {
  let peak = 0;
  let isFed = false;
  for (let iQuantum = 0; iQuantum < MAX_QUANTA_PER_TICK && sink.queuedSamples < leadSamples; iQuantum++) {
    const mono = queue.take(quantumSamples);
    peak = Math.max(peak, peakOf(mono));
    sink.write(
      spreadToChannels({
        mono,
        channels
      })
    );
    isFed = true;
  }

  if (isFed) {
    onLevel(peak);
  }
}

// Model speech (24 kHz PCM16) -> graph rate -> a bounded queue -> the graph, kept `leadMilliseconds`
// ahead of the speakers. Idle, it feeds silence, so the graph never starves.
export function createSpeakerPump({
  sink,
  graphRate,
  channels,
  quantumSamples,
  leadMilliseconds,
  maxQueuedSeconds,
  onLevel
}: {
  sink: SpeakerSink;
  graphRate: number;
  channels: number;
  quantumSamples: number;
  leadMilliseconds: number;
  maxQueuedSeconds: number;
  onLevel: (peak: number) => void;
}) {
  const resampler = createResampler({
    from: SPEAKER_RATE,
    to: graphRate
  });
  const queue = createSpeakerQueue({ maxSamples: graphRate * maxQueuedSeconds });
  const leadSamples = Math.round((graphRate * leadMilliseconds) / MILLISECONDS_PER_SECOND);

  function write(pcm16: Uint8Array) {
    return queue.enqueue(resampler.process(bytesToFloats(pcm16)));
  }

  function flush() {
    queue.clear();
    sink.discard();
  }

  return {
    write,
    flush,
    tick: () =>
      feedSink({
        sink,
        queue,
        quantumSamples,
        channels,
        leadSamples,
        onLevel
      }),
    get queuedMilliseconds() {
      return (queue.queuedSamples * MILLISECONDS_PER_SECOND) / graphRate;
    },
    get underruns() {
      return queue.underruns;
    },
    get droppedSamples() {
      return queue.droppedSamples;
    }
  };
}
