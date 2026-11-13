import {
  EngineKind,
  type LiveEngine,
  type LiveEvent,
  LiveEventKind,
  type LiveEventListener
} from "@/contracts/live-engine.ts";
import type { Monitor, Region } from "@/contracts/monitor.ts";
import { noop } from "@/lib/noop.ts";
import { FRAME_INTERVAL_MS } from "@/live/api/constants.ts";
import { createLiveSession } from "@/live/api/live-session.ts";
import { connectWebSocket, type SocketConnector } from "@/live/api/socket.ts";
import { createFrameSender } from "@/live/frame-sender.ts";
import { micLevel, speakerLevel } from "@/live/level.ts";
import type { AudioDuplex, LiveConfig, LogSink, ScreenSource } from "@/live/ports.ts";
import { appendFragment, EMPTY_UTTERANCE } from "@/live/utterance.ts";

export interface ApiKeyEngineDeps {
  readonly config: LiveConfig;
  readonly monitor: Monitor;
  readonly audio: AudioDuplex;
  readonly screen: ScreenSource;
  readonly log: LogSink;
  readonly connect?: SocketConnector;
  readonly now?: () => number;
}

type Emit = (event: LiveEvent) => void;

function createTranscript(emit: Emit) {
  let utterance = EMPTY_UTTERANCE;

  return function appendTranscript({ fragment, isUser }: { fragment: string; isUser: boolean }) {
    utterance = appendFragment({
      utterance,
      fragment,
      isUser
    });
    emit({
      kind: LiveEventKind.TRANSCRIPT,
      text: utterance.text.trim(),
      isUser
    });
  };
}

function buildSessionListeners({ audio, emit }: { audio: AudioDuplex; emit: Emit }) {
  const appendTranscript = createTranscript(emit);

  return {
    onAudio: (pcm16: Uint8Array) => audio.play(pcm16),
    onInterrupted: () => audio.flush(),
    onUserText: (fragment: string) =>
      appendTranscript({
        fragment,
        isUser: true
      }),
    onModelText: (fragment: string) =>
      appendTranscript({
        fragment,
        isUser: false
      }),
    onStatus: (status: string) =>
      emit({
        kind: LiveEventKind.STATUS,
        status
      }),
    onClosed: (reason: string) =>
      emit({
        kind: LiveEventKind.ENDED,
        reason
      })
  };
}

function subscribeAudio({
  audio,
  sendAudio,
  emit
}: {
  audio: AudioDuplex;
  sendAudio: (pcm16: Uint8Array) => void;
  emit: Emit;
}) {
  return [
    audio.onMicChunk(sendAudio),
    audio.onMicLevel(peak =>
      emit({
        kind: LiveEventKind.LEVEL,
        peak: micLevel({
          peak,
          isMuted: audio.isMuted
        }),
        isUser: true
      })
    ),
    audio.onSpeakerLevel(peak =>
      emit({
        kind: LiveEventKind.LEVEL,
        peak: speakerLevel(peak),
        isUser: false
      })
    )
  ];
}

function createFrameLoop(frames: ReturnType<typeof createFrameSender>) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let isInFlight = false;
  let isStopped = false;

  async function tick() {
    const isSkipped = isInFlight || isStopped;
    if (isSkipped) {
      return;
    }

    isInFlight = true;
    try {
      await frames.tick();
    } finally {
      isInFlight = false;
    }
  }

  return {
    start() {
      void tick();
      timer = setInterval(() => {
        void tick();
      }, FRAME_INTERVAL_MS);
    },
    stop() {
      isStopped = true;
      clearInterval(timer);
    }
  };
}

function assembleParts({
  config,
  monitor,
  audio,
  screen,
  log,
  connect,
  now,
  emit
}: Required<ApiKeyEngineDeps> & {
  emit: Emit;
}) {
  const session = createLiveSession({
    config,
    connect,
    log,
    listeners: buildSessionListeners({
      audio,
      emit
    })
  });
  const frames = createFrameSender({
    source: screen,
    monitor,
    send: session.sendFrame,
    now,
    log
  });
  return {
    session,
    frames,
    frameLoop: createFrameLoop(frames),
    unsubscribes: subscribeAudio({
      audio,
      sendAudio: session.sendAudio,
      emit
    })
  };
}

// The API-key engine: mic to Gemini, screen to Gemini, Gemini to speaker, over the public Live
// API. Mic chunks (every 40 ms) and screen stills (about 1/s) are two producers writing to the
// same socket, so listening, looking and talking all happen at once.
export function createApiKeyEngine({ connect = connectWebSocket, now = Date.now, ...deps }: ApiKeyEngineDeps) {
  const { audio } = deps;
  const listeners = new Set<LiveEventListener>();
  const { session, frames, frameLoop, unsubscribes } = assembleParts({
    ...deps,
    connect,
    now,
    emit(event) {
      for (const listener of listeners) {
        listener(event);
      }
    }
  });

  return {
    kind: EngineKind.API_KEY,
    reportsLevels: true,
    isCameraShared: false,
    get monitor() {
      return frames.monitor;
    },
    get isMuted() {
      return audio.isMuted;
    },
    set isMuted(isMuted: boolean) {
      audio.isMuted = isMuted;
    },
    get region() {
      return frames.region;
    },
    set region(region: Region | undefined) {
      frames.region = region;
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onExtensionNeeded: () => noop,
    useCamera: () => Promise.resolve(false),
    async start() {
      await session.open();
      await audio.start();
      frameLoop.start();
    },
    share: next => frames.share(next),
    async dispose() {
      frameLoop.stop();
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      audio.dispose();
      await session.dispose();
      listeners.clear();
    }
  } satisfies LiveEngine;
}
