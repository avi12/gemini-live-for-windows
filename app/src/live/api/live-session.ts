import { LiveStatus } from "@/contracts/live-engine.ts";
import { errorMessage } from "@/lib/error-message.ts";
import {
  AUDIO_MIME_TYPE,
  CloseCode,
  CONNECTION_FAILED_REASON,
  FRAME_MIME_TYPE,
  INVALID_MESSAGE_REASON,
  LIVE_ENDPOINT,
  MODEL_PREFIX,
  NORMAL_CLOSE_REASON,
  RECONNECT_FAILED_PREFIX,
  SESSION_CLOSE_TIMEOUT_MS,
  SETUP_REJECTED_PREFIX,
  SYSTEM_PROMPT
} from "@/live/api/constants.ts";
import {
  MediaResolution,
  Modality,
  parseServerFrame,
  type RealtimeInput,
  serializeClientMessage
} from "@/live/api/protocol.ts";
import { closeReason } from "@/live/api/reasons.ts";
import { SessionEventKind, toSessionEvents, unhandledFields } from "@/live/api/server-events.ts";
import type { LiveSocket, SocketConnector } from "@/live/api/socket.ts";
import type { LiveConfig, LogSink } from "@/live/ports.ts";

export interface SessionListeners {
  onAudio(pcm16: Uint8Array): void;
  onInterrupted(): void;
  onUserText(text: string): void;
  onModelText(text: string): void;
  onStatus(status: string): void;
  onClosed(reason: string): void;
}

export interface LiveSessionDeps {
  readonly config: LiveConfig;
  readonly connect: SocketConnector;
  readonly listeners: SessionListeners;
  readonly log: LogSink;
}

interface SessionState {
  readonly unhandledSeen: Set<string>;
  current: LiveSocket | undefined;
  resumeHandle: string | undefined;
  isDisposed: boolean;
}

interface SessionContext extends LiveSessionDeps {
  readonly state: SessionState;
}

function encodeBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

function buildSetup({ config, resumeHandle }: {
  config: LiveConfig;
  resumeHandle: string | undefined;
}) {
  return {
    model: `${MODEL_PREFIX}${config.model}`,
    generationConfig: {
      responseModalities: [Modality.audio],
      mediaResolution: MediaResolution.medium,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: config.voice
          }
        }
      }
    },
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }]
    },
    tools: [{
      googleSearch: {}
    }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    // Audio+video sessions are capped at ~2 minutes of context without this
    contextWindowCompression: {
      slidingWindow: {}
    },
    // Lets the session reconnect into the same conversation when the server sends goAway
    sessionResumption: resumeHandle === undefined ? {} : { handle: resumeHandle }
  };
}

function sendRealtime({ state, input }: {
  state: SessionState;
  input: RealtimeInput;
}) {
  if (!state.current?.isOpen()) {
    return;
  }

  state.current.send(serializeClientMessage({ realtimeInput: input }));
}

function retire({ state, socket }: {
  state: SessionState;
  socket: LiveSocket | undefined;
}) {
  const isCurrent = state.current === socket;
  if (isCurrent) {
    state.current = undefined;
  }

  socket?.close({
    code: CloseCode.normalClosure,
    reason: NORMAL_CLOSE_REASON
  });
}

function logUnhandled({ ctx, data }: {
  ctx: SessionContext;
  data: Parameters<typeof unhandledFields>[0];
}) {
  for (const field of unhandledFields(data)) {
    if (ctx.state.unhandledSeen.has(field)) {
      continue;
    }

    ctx.state.unhandledSeen.add(field);
    ctx.log(`live api: ignoring "${field}"`);
  }
}

function dispatchEvent({ ctx, event, socket }: {
  ctx: SessionContext;
  event: ReturnType<typeof toSessionEvents>[number];
  socket: LiveSocket;
}) {
  const { listeners, state } = ctx;
  switch (event.kind) {
    case SessionEventKind.audio:
      listeners.onAudio(event.pcm16);
      break;
    case SessionEventKind.interrupted:
      listeners.onInterrupted();
      break;
    case SessionEventKind.userText:
      listeners.onUserText(event.text);
      break;
    case SessionEventKind.modelText:
      listeners.onModelText(event.text);
      break;
    case SessionEventKind.resumeHandle:
      state.resumeHandle = event.handle;
      break;
    case SessionEventKind.goAway:
      ctx.log(`goAway in ${event.timeLeft ?? "?"} - resuming`);
      listeners.onStatus(LiveStatus.reconnecting);
      void resume({
        ctx,
        previous: socket
      });
      break;
  }
}

function handleMessage({ ctx, text, socket }: {
  ctx: SessionContext;
  text: string;
  socket: LiveSocket;
}) {
  const parsed = parseServerFrame(text);
  if (!parsed.success) {
    retire({
      state: ctx.state,
      socket
    });
    ctx.listeners.onClosed(INVALID_MESSAGE_REASON);
    return;
  }

  logUnhandled({
    ctx,
    data: parsed.data
  });
  for (const event of toSessionEvents(parsed.data)) {
    dispatchEvent({
      ctx,
      event,
      socket
    });
  }
}

function acceptSetup({ state, socket, text }: {
  state: SessionState;
  socket: LiveSocket;
  text: string;
}) {
  const parsed = parseServerFrame(text);
  const isSetupRefused = !parsed.success || !parsed.data.setupComplete;
  if (isSetupRefused) {
    retire({
      state,
      socket
    });
    return false;
  }

  return true;
}

function wireSocket({ ctx, socket, resolve, reject }: {
  ctx: SessionContext;
  socket: LiveSocket;
  resolve: () => void;
  reject: (error: Error) => void;
}) {
  const { state, listeners } = ctx;
  let isReady = false;
  socket.onOpen(() => socket.send(
    serializeClientMessage({
      setup: buildSetup({
        config: ctx.config,
        resumeHandle: state.resumeHandle
      })
    })
  ));
  socket.onError(() => {
    if (!isReady) {
      reject(new Error(CONNECTION_FAILED_REASON));
    }
  });
  socket.onClose(event => {
    if (!isReady) {
      reject(new Error(`${SETUP_REJECTED_PREFIX}${closeReason(event.reason)}`));
      return;
    }

    const isStale = socket !== state.current || state.isDisposed;
    if (isStale) {
      return;
    }

    state.current = undefined;
    listeners.onClosed(closeReason(event.reason));
  });
  socket.onMessage(text => {
    const isSuperseded = socket !== state.current;
    if (isSuperseded) {
      return;
    }

    if (isReady) {
      handleMessage({
        ctx,
        text,
        socket
      });
      return;
    }

    const isSetupAccepted = acceptSetup({
      state,
      socket,
      text
    });
    if (!isSetupAccepted) {
      reject(new Error(`${SETUP_REJECTED_PREFIX}${text}`));
      return;
    }

    isReady = true;
    resolve();
  });
}

// Resolves once the server answers setup with setupComplete, which it does before anything else
function openSocket(ctx: SessionContext) {
  return new Promise<void>((resolve, reject) => {
    const url = `${LIVE_ENDPOINT}?key=${encodeURIComponent(ctx.config.apiKey())}`;
    let socket: LiveSocket;
    try {
      socket = ctx.connect(url);
    } catch {
      reject(new Error(CONNECTION_FAILED_REASON));
      return;
    }
    ctx.state.current = socket;
    wireSocket({
      ctx,
      socket,
      resolve,
      reject
    });
  });
}

async function resume({ ctx, previous }: {
  ctx: SessionContext;
  previous: LiveSocket;
}) {
  retire({
    state: ctx.state,
    socket: previous
  });
  try {
    await openSocket(ctx);
  } catch (error) {
    ctx.listeners.onClosed(`${RECONNECT_FAILED_PREFIX}${errorMessage(error)}`);
    return;
  }

  if (ctx.state.isDisposed) {
    return;
  }

  ctx.listeners.onStatus(LiveStatus.listening);
}

async function disposeSession(state: SessionState) {
  state.isDisposed = true;
  const socket = state.current;
  state.current = undefined;

  if (!socket?.isOpen()) {
    socket?.close({
      code: CloseCode.normalClosure,
      reason: NORMAL_CLOSE_REASON
    });
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const closed = new Promise<void>(resolve => {
    socket.onClose(() => resolve());
    timer = setTimeout(resolve, SESSION_CLOSE_TIMEOUT_MS);
  });
  socket.close({
    code: CloseCode.normalClosure,
    reason: NORMAL_CLOSE_REASON
  });
  await closed;
  clearTimeout(timer);
}

// One Gemini Live conversation over the BidiGenerateContent WebSocket. Mic audio and screen frames
// flow up as independent realtimeInput messages while model audio flows down; nothing is
// turn-based on the wire. Voice activity detection and barge-in run on Google's side.
export function createLiveSession(deps: LiveSessionDeps) {
  const state: SessionState = {
    unhandledSeen: new Set<string>(),
    current: undefined,
    resumeHandle: undefined,
    isDisposed: false
  };
  const ctx: SessionContext = {
    ...deps,
    state
  };

  return {
    open: () => openSocket(ctx),
    dispose: () => disposeSession(state),
    sendAudio: (pcm16: Uint8Array) => sendRealtime({
      state,
      input: {
        audio: {
          mimeType: AUDIO_MIME_TYPE,
          data: encodeBase64(pcm16)
        }
      }
    }),
    sendFrame: (jpeg: Uint8Array) => sendRealtime({
      state,
      input: {
        video: {
          mimeType: FRAME_MIME_TYPE,
          data: encodeBase64(jpeg)
        }
      }
    })
  };
}
