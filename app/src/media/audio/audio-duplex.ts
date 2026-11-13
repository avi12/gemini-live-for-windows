import type { AudioDuplex, Unsubscribe } from "@/live/ports.ts";

import { AudioCommandKind, AudioEventKind, audioEventSchema } from "./audio-protocol.ts";
import type { AudioCommand, AudioEvent } from "./audio-protocol.ts";

const DISPOSE_GRACE_MILLISECONDS = 1000;

// The main thread's end of the audio worker: post a command (optionally handing buffers over), hear
// what comes back, terminate. The Worker-backed one is audio-worker-link.ts; tests pass a fake.
export interface AudioWorkerLink {
  post(command: AudioCommand, transfer?: readonly ArrayBuffer[]): void;
  onMessage(listener: (message: unknown) => void): void;
  terminate(): Promise<void>;
}

function createListeners<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe(listener: (value: T) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(value: T) {
      for (const listener of listeners) {
        listener(value);
      }
    }
  };
}

function createStartGate(failures: ReturnType<typeof createListeners<string>>) {
  let settleStart:
    | {
        resolve: () => void;
        reject: (error: Error) => void;
      }
    | undefined;

  return {
    wait(begin: () => void) {
      return new Promise<void>((resolve, reject) => {
        settleStart = {
          resolve,
          reject
        };
        begin();
      });
    },
    started() {
      settleStart?.resolve();
      settleStart = undefined;
    },
    failed(message: string) {
      const pending = settleStart;
      settleStart = undefined;

      const isStartSettled = pending === undefined;
      if (isStartSettled) {
        failures.emit(message);
        return;
      }

      pending.reject(new Error(message));
    }
  };
}

function createHubs() {
  return {
    chunks: createListeners<Uint8Array>(),
    micLevels: createListeners<number>(),
    speakerLevels: createListeners<number>(),
    failures: createListeners<string>()
  };
}

function postMute({ link, isMuted }: { link: AudioWorkerLink; isMuted: boolean }) {
  link.post({
    kind: AudioCommandKind.MUTE,
    isMuted
  });
}

function postStart({
  link,
  deviceId,
  isLoopback
}: {
  link: AudioWorkerLink;
  deviceId: string | null;
  isLoopback: boolean;
}) {
  link.post({
    kind: AudioCommandKind.START,
    deviceId,
    isLoopback
  });
}

function postDispose(link: AudioWorkerLink) {
  link.post({ kind: AudioCommandKind.DISPOSE });
  const timer = setTimeout(() => {
    void link.terminate();
  }, DISPOSE_GRACE_MILLISECONDS);
  timer.unref();
  return timer;
}

function listenToWorker({
  link,
  gate,
  hubs,
  onDisposed
}: {
  link: AudioWorkerLink;
  gate: ReturnType<typeof createStartGate>;
  hubs: ReturnType<typeof createHubs>;
  onDisposed: () => void;
}) {
  function route(event: AudioEvent) {
    switch (event.kind) {
      case AudioEventKind.MIC_CHUNK:
        hubs.chunks.emit(event.pcm16);
        break;
      case AudioEventKind.MIC_LEVEL:
        hubs.micLevels.emit(event.peak);
        break;
      case AudioEventKind.SPEAKER_LEVEL:
        hubs.speakerLevels.emit(event.peak);
        break;
      case AudioEventKind.FAILED:
        gate.failed(event.message);
        break;
      case AudioEventKind.STARTED:
        gate.started();
        break;
      default:
        onDisposed();
    }
  }

  link.onMessage(message => {
    const parsed = audioEventSchema.safeParse(message);
    if (!parsed.success) {
      gate.failed(`Unreadable audio event: ${parsed.error.message}`);
      return;
    }

    route(parsed.data);
  });
}

function postPlay({ link, pcm16 }: { link: AudioWorkerLink; pcm16: Uint8Array }) {
  const copy = pcm16.slice();
  link.post(
    {
      kind: AudioCommandKind.PLAY,
      pcm16: copy
    },
    [copy.buffer]
  );
}

function createLifecycle(link: AudioWorkerLink) {
  let isDisposed = false;
  let graceTimer: NodeJS.Timeout | undefined;

  return {
    play(pcm16: Uint8Array) {
      if (isDisposed) {
        return;
      }

      postPlay({
        link,
        pcm16
      });
    },
    dispose() {
      if (isDisposed) {
        return;
      }

      isDisposed = true;
      graceTimer = postDispose(link);
    },
    terminate() {
      clearTimeout(graceTimer);
      void link.terminate();
    }
  };
}

// AudioDuplex over a worker. `microphoneId` is read when starting (the pill's picker may change it
// between sessions): a Windows device id, or null for the default microphone. `isLoopback` swaps the
// real devices for the device-free fixture graph, for tests.
export function createAudioDuplex({
  link,
  microphoneId,
  isLoopback = false
}: {
  link: AudioWorkerLink;
  microphoneId: () => string | null;
  isLoopback?: boolean;
}) {
  const hubs = createHubs();
  const gate = createStartGate(hubs.failures);
  const lifecycle = createLifecycle(link);
  let isMuted = false;

  listenToWorker({
    link,
    gate,
    hubs,
    onDisposed: lifecycle.terminate
  });

  return {
    get isMuted() {
      return isMuted;
    },
    set isMuted(isNowMuted: boolean) {
      isMuted = isNowMuted;
      postMute({
        link,
        isMuted: isNowMuted
      });
    },
    start: () =>
      gate.wait(() =>
        postStart({
          link,
          deviceId: microphoneId(),
          isLoopback
        })
      ),
    onMicChunk: hubs.chunks.subscribe,
    onMicLevel: hubs.micLevels.subscribe,
    onSpeakerLevel: hubs.speakerLevels.subscribe,
    // Beyond the AudioDuplex port: the graph died after start (a device was unplugged, say)
    onFailure: hubs.failures.subscribe,
    play: lifecycle.play,
    flush: () => link.post({ kind: AudioCommandKind.FLUSH }),
    dispose: lifecycle.dispose
  } satisfies AudioDuplex & { onFailure: (listener: (message: string) => void) => Unsubscribe };
}
