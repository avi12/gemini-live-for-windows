import { createChunker } from "./chunker.ts";
import { floatsToPcm16, mixToMono, peakOf } from "./pcm.ts";
import { createResampler } from "./resampler.ts";
import { MIC_CHUNK_SAMPLES, MIC_RATE } from "@/live/api/constants.ts";

const MAX_BACKLOG_SECONDS = 1;

// Where the pump reads the graph's tap from: interleaved float32 samples, or undefined when none are ready
export interface MicFrameSource {
  read(): Float32Array | undefined;
}

function newest({ mono, maxBacklogFrames, stats }: {
  mono: Float32Array;
  maxBacklogFrames: number;
  stats: { droppedFrames: number };
}) {
  const excess = mono.length - maxBacklogFrames;
  const isWithinBacklog = excess <= 0;
  if (isWithinBacklog) {
    return mono;
  }

  stats.droppedFrames += excess;
  return mono.subarray(excess);
}

// One poll of the microphone: tap -> mono -> level -> 16 kHz -> PCM16 -> 40 ms chunks. Muted, it still
// sends chunks of silence (the connection never goes quiet) and reports level 0.
export function createMicPump({
  source,
  graphRate,
  channels,
  isMuted,
  onChunk,
  onLevel
}: {
  source: MicFrameSource;
  graphRate: number;
  channels: number;
  isMuted: () => boolean;
  onChunk: (pcm16: Uint8Array<ArrayBuffer>) => void;
  onLevel: (peak: number) => void;
}) {
  const resampler = createResampler({
    from: graphRate,
    to: MIC_RATE
  });
  const chunker = createChunker({ chunkSamples: MIC_CHUNK_SAMPLES });
  const maxBacklogFrames = graphRate * MAX_BACKLOG_SECONDS;
  const stats = {
    polls: 0,
    emptyPolls: 0,
    droppedFrames: 0
  };

  function poll() {
    stats.polls += 1;
    const interleaved = source.read();
    const isFrameUnusable = interleaved === undefined || interleaved.length < channels;
    if (isFrameUnusable) {
      stats.emptyPolls += 1;
      return;
    }

    const mono = newest({
      mono: mixToMono({
        interleaved,
        channels
      }),
      maxBacklogFrames,
      stats
    });
    const isMicMuted = isMuted();
    onLevel(isMicMuted ? 0 : peakOf(mono));
    const pcm = floatsToPcm16({
      samples: resampler.process(mono),
      isMuted: isMicMuted
    });
    for (const chunk of chunker.push(pcm)) {
      onChunk(chunk);
    }
  }

  return {
    poll,
    stats
  };
}
