import type { Monitor } from "@/contracts/monitor.ts";
import { type ClientMessage, clientMessageSchema } from "@/live/api/protocol.ts";
import type { SocketClose } from "@/live/api/socket.ts";
import type { AudioDuplex, ScreenSource, ScreenTarget } from "@/live/ports.ts";

export const TEST_KEY = "test-key-123";

export const PCM_BYTES = new Uint8Array([1, 2, 0]);
export const PCM_BASE64 = Buffer.from(PCM_BYTES).toString("base64");
export const FRAME_BYTES = new Uint8Array([1, 0]);
export const FRAME_BASE64 = Buffer.from(FRAME_BYTES).toString("base64");

export const TEST_MONITOR: Monitor = {
  deviceName: "DISPLAY1",
  index: 1,
  isPrimary: true,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  workRight: 1920,
  workBottom: 1040,
  refreshRateHertz: 60
};

function createChannel<T>() {
  const listeners: Array<(value: T) => void> = [];
  return {
    add: (listener: (value: T) => void) => void listeners.push(listener),
    emit(value: T) {
      for (const listener of listeners) {
        listener(value);
      }
    }
  };
}

function createFakeSocket(isSetupAnswered: boolean) {
  const sent: ClientMessage[] = [];
  const closes: SocketClose[] = [];
  const opens = createChannel<void>();
  const errors = createChannel<void>();
  const messages = createChannel<string>();
  const closings = createChannel<SocketClose>();
  let isOpen = false;

  function serverSend(message: unknown) {
    messages.emit(JSON.stringify(message));
  }

  function serverClose(event: SocketClose) {
    isOpen = false;
    closings.emit(event);
  }

  queueMicrotask(() => {
    isOpen = true;
    opens.emit();
  });

  return {
    sent,
    closes,
    serverSend,
    serverClose,
    raiseError: () => errors.emit(),
    serverSendRaw: (text: string) => messages.emit(text),
    socket: {
      isOpen: () => isOpen,
      send(data: string) {
        const message = clientMessageSchema.parse(JSON.parse(data));
        sent.push(message);
        const isSetup = "setup" in message;
        const isAnswering = isSetup && isSetupAnswered;
        if (isAnswering) {
          queueMicrotask(() => serverSend({
            setupComplete: {}
          }));
        }
      },
      close(event: SocketClose) {
        closes.push(event);
        queueMicrotask(() => serverClose(event));
      },
      onOpen: opens.add,
      onError: errors.add,
      onMessage: messages.add,
      onClose: closings.add
    }
  };
}

export function createFakeNetwork({ isSetupAnswered = true }: { isSetupAnswered?: boolean } = {}) {
  const sockets: Array<ReturnType<typeof createFakeSocket>> = [];
  const urls: string[] = [];
  let isConnectFailing = false;

  function connect(url: string) {
    urls.push(url);

    if (isConnectFailing) {
      throw new Error(`bad url ${url}`);
    }

    const fake = createFakeSocket(isSetupAnswered);
    sockets.push(fake);
    return fake.socket;
  }

  return {
    connect,
    sockets,
    urls,
    failConnect() {
      isConnectFailing = true;
    }
  };
}

export function setupOf(message: ClientMessage | undefined) {
  if (!message) {
    return undefined;
  }

  return "setup" in message ? message.setup : undefined;
}

export async function flush() {
  await new Promise<void>(resolve => setImmediate(resolve));
}

export function createFakeAudio() {
  const calls: string[] = [];
  const played: Uint8Array[] = [];
  const chunkListeners: Array<(pcm16: Uint8Array) => void> = [];
  const micLevelListeners: Array<(peak: number) => void> = [];
  const speakerLevelListeners: Array<(peak: number) => void> = [];
  const audio: AudioDuplex = {
    isMuted: false,
    async start() {
      calls.push("start");
    },
    onMicChunk(listener) {
      chunkListeners.push(listener);
      return () => calls.push("unsubscribe");
    },
    onMicLevel(listener) {
      micLevelListeners.push(listener);
      return () => calls.push("unsubscribe");
    },
    onSpeakerLevel(listener) {
      speakerLevelListeners.push(listener);
      return () => calls.push("unsubscribe");
    },
    play(pcm16) {
      played.push(pcm16);
    },
    flush() {
      calls.push("flush");
    },
    dispose() {
      calls.push("dispose");
    }
  };
  return {
    audio,
    calls,
    played,
    emitChunk(pcm16: Uint8Array) {
      for (const listener of chunkListeners) {
        listener(pcm16);
      }
    },
    emitMicLevel(peak: number) {
      for (const listener of micLevelListeners) {
        listener(peak);
      }
    },
    emitSpeakerLevel(peak: number) {
      for (const listener of speakerLevelListeners) {
        listener(peak);
      }
    }
  };
}

export function createFakeScreen(frames: readonly Uint8Array[]) {
  const targets: ScreenTarget[] = [];
  let iFrame = 0;
  const source: ScreenSource = {
    async capture(target) {
      targets.push(target);
      const frame = frames[Math.min(iFrame, frames.length - 1)];
      iFrame += 1;

      if (!frame) {
        throw new Error("no frame");
      }

      return frame;
    }
  };
  return {
    source,
    targets
  };
}
