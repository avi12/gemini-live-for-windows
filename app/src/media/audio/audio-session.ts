import { createLevelThrottle } from "./level-throttle.ts";
import { createMicPump } from "./mic-pump.ts";
import type { MicFrameSource } from "./mic-pump.ts";
import { createSpeakerPump } from "./speaker-pump.ts";
import type { SpeakerSink } from "./speaker-pump.ts";
import { errorMessage } from "@/lib/error-message.ts";
import type { Clock } from "@/media/clock.ts";

export const POLL_MILLISECONDS = 10;
const LEVEL_MILLISECONDS = 33;
const SPEAKER_LEAD_MILLISECONDS = 80;
const MAX_SPEAKER_QUEUE_SECONDS = 30;

// The graph as the session sees it: the real one and the loopback fixture (audio-graph.ts) both are this
export interface SessionGraph {
  readonly sampleRate: number;
  readonly channels: number;
  readonly quantumSamples: number;
  readonly micSource: MicFrameSource;
  readonly speakerSink: SpeakerSink;
  start(): void;
  close(): void;
}

function throttled({ throttle, emit }: {
  throttle: ReturnType<typeof createLevelThrottle>;
  emit: (peak: number) => void;
}) {
  return (peak: number) => {
    const report = throttle.offer(peak);
    const hasReport = report !== undefined;
    if (hasReport) {
      emit(report);
    }
  };
}

// Everything between the graph and the callbacks: one timer polls the mic tap and tops up the speaker
// feed (dynwinrt delivers no native-thread callbacks, so nothing here is event driven), levels are
// throttled to about 30 a second, and disposal stops the timer before the graph closes.
function createPumps({ graph, clock, isMuted, onMicChunk, onMicLevel, onSpeakerLevel }: {
  graph: SessionGraph;
  clock: Clock;
  isMuted: () => boolean;
  onMicChunk: (pcm16: Uint8Array<ArrayBuffer>) => void;
  onMicLevel: (peak: number) => void;
  onSpeakerLevel: (peak: number) => void;
}) {
  const micThrottle = createLevelThrottle({
    intervalMilliseconds: LEVEL_MILLISECONDS,
    now: clock.now
  });
  const speakerThrottle = createLevelThrottle({
    intervalMilliseconds: LEVEL_MILLISECONDS,
    now: clock.now
  });
  const mic = createMicPump({
    source: graph.micSource,
    graphRate: graph.sampleRate,
    channels: graph.channels,
    isMuted,
    onChunk: onMicChunk,
    onLevel: throttled({
      throttle: micThrottle,
      emit: onMicLevel
    })
  });
  const speaker = createSpeakerPump({
    sink: graph.speakerSink,
    graphRate: graph.sampleRate,
    channels: graph.channels,
    quantumSamples: graph.quantumSamples,
    leadMilliseconds: SPEAKER_LEAD_MILLISECONDS,
    maxQueuedSeconds: MAX_SPEAKER_QUEUE_SECONDS,
    onLevel: throttled({
      throttle: speakerThrottle,
      emit: onSpeakerLevel
    })
  });
  return {
    mic,
    speaker
  };
}

export function createAudioSession({ graph, clock, onMicChunk, onMicLevel, onSpeakerLevel, onFailure }: {
  graph: SessionGraph;
  clock: Clock;
  onMicChunk: (pcm16: Uint8Array<ArrayBuffer>) => void;
  onMicLevel: (peak: number) => void;
  onSpeakerLevel: (peak: number) => void;
  onFailure: (message: string) => void;
}) {
  let isMuted = false;
  let stopTimer: (() => void) | undefined;

  const { mic, speaker } = createPumps({
    graph,
    clock,
    isMuted: () => isMuted,
    onMicChunk,
    onMicLevel,
    onSpeakerLevel
  });

  function start() {
    graph.start();
    speaker.tick();
    stopTimer = clock.setInterval(tick, POLL_MILLISECONDS);
  }

  function stop() {
    stopTimer?.();
    stopTimer = undefined;
  }

  function tick() {
    try {
      speaker.tick();
      mic.poll();
    } catch (error) {
      stop();
      onFailure(errorMessage(error));
    }
  }

  function dispose() {
    stop();
    graph.close();
  }

  return {
    start,
    dispose,
    play: speaker.write,
    flush: speaker.flush,
    setMuted(isNowMuted: boolean) {
      isMuted = isNowMuted;
    },
    mic,
    speaker
  };
}

export type AudioSession = ReturnType<typeof createAudioSession>;
