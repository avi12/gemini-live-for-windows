import { LiveStatus } from "@/contracts/live-engine.ts";
import { errorMessage } from "@/lib/error-message.ts";
import {
  AUDIO_MIME_TYPE,
  CloseCode,
  CONNECTION_FAILED_REASON,
  FRAME_MIME_TYPE,
  INVALID_MESSAGE_REASON,
  LIVE_ENDPOINT,
  NORMAL_CLOSE_REASON,
  RECONNECT_FAILED_PREFIX,
  SESSION_CLOSE_TIMEOUT_MS,
  SETUP_REJECTED_PREFIX
} from "@/live/api/constants.ts";
import { parseServerFrame, type RealtimeInput, serializeClientMessage } from "@/live/api/protocol.ts";
import { closeReason } from "@/live/api/reasons.ts";
import { SessionEventKind, toSessionEvents, unhandledFields } from "@/live/api/server-events.ts";
import { buildSetup } from "@/live/api/session-setup.ts";
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

function closeNormally(socket: LiveSocket | undefined) {
  socket?.close({
    code: CloseCode.NORMAL_CLOSURE,
    reason: NORMAL_CLOSE_REASON
  });
}

function sendRealtime({ state, input }: { state: SessionState; input: RealtimeInput }) {
  if (!state.current?.isOpen()) {
    return;
  }

  state.current.send(serializeClientMessage({ realtimeInput: input }));
}

function retire({ state, socket }: { state: SessionState; socket: LiveSocket | undefined }) {
  const isCurrent = state.current === socket;
  if (isCurrent) {
    state.current = undefined;
  }

  closeNormally(socket);
}

function logUnhandled({ context, data }: { context: SessionContext; data: Parameters<typeof unhandledFields>[0] }) {
  for (const field of unhandledFields(data)) {
    if (context.state.unhandledSeen.has(field)) {
      continue;
    }

    context.state.unhandledSeen.add(field);
    context.log(`live api: ignoring "${field}"`);
  }
}

function dispatchEvent({
  context,
  event,
  socket
}: {
  context: SessionContext;
  event: ReturnType<typeof toSessionEvents>[number];
  socket: LiveSocket;
}) {
  const { listeners, state } = context;
  switch (event.kind) {
    case SessionEventKind.AUDIO:
      listeners.onAudio(event.pcm16);
      break;
    case SessionEventKind.INTERRUPTED:
      listeners.onInterrupted();
      break;
    case SessionEventKind.USER_TEXT:
      listeners.onUserText(event.text);
      break;
    case SessionEventKind.MODEL_TEXT:
      listeners.onModelText(event.text);
      break;
    case SessionEventKind.RESUME_HANDLE:
      state.resumeHandle = event.handle;
      break;
    case SessionEventKind.GO_AWAY:
      context.log(`goAway in ${event.timeLeft ?? "?"} - resuming`);
      listeners.onStatus(LiveStatus.RECONNECTING);
      void resume({
        context,
        previous: socket
      });
      break;
  }
}

function handleMessage({ context, text, socket }: { context: SessionContext; text: string; socket: LiveSocket }) {
  const parsed = parseServerFrame(text);
  if (!parsed.success) {
    retire({
      state: context.state,
      socket
    });
    context.listeners.onClosed(INVALID_MESSAGE_REASON);
    return;
  }

  logUnhandled({
    context,
    data: parsed.data
  });
  for (const event of toSessionEvents(parsed.data)) {
    dispatchEvent({
      context,
      event,
      socket
    });
  }
}

function acceptSetup({ state, socket, text }: { state: SessionState; socket: LiveSocket; text: string }) {
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

function wireSocket({
  context,
  socket,
  resolve,
  reject
}: {
  context: SessionContext;
  socket: LiveSocket;
  resolve: () => void;
  reject: (error: Error) => void;
}) {
  const { state, listeners } = context;
  let isReady = false;
  socket.onOpen(() =>
    socket.send(
      serializeClientMessage({
        setup: buildSetup({
          config: context.config,
          resumeHandle: state.resumeHandle
        })
      })
    )
  );
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
        context,
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
function openSocket(context: SessionContext) {
  return new Promise<void>((resolve, reject) => {
    const url = `${LIVE_ENDPOINT}?key=${encodeURIComponent(context.config.apiKey())}`;
    let socket: LiveSocket;
    try {
      socket = context.connect(url);
    } catch {
      reject(new Error(CONNECTION_FAILED_REASON));
      return;
    }
    context.state.current = socket;
    wireSocket({
      context,
      socket,
      resolve,
      reject
    });
  });
}

async function resume({ context, previous }: { context: SessionContext; previous: LiveSocket }) {
  retire({
    state: context.state,
    socket: previous
  });
  try {
    await openSocket(context);
  } catch (error) {
    context.listeners.onClosed(`${RECONNECT_FAILED_PREFIX}${errorMessage(error)}`);
    return;
  }

  if (context.state.isDisposed) {
    return;
  }

  context.listeners.onStatus(LiveStatus.LISTENING);
}

async function disposeSession(state: SessionState) {
  state.isDisposed = true;
  const socket = state.current;
  state.current = undefined;

  if (!socket?.isOpen()) {
    closeNormally(socket);
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const closed = new Promise<void>(resolve => {
    socket.onClose(() => resolve());
    timer = setTimeout(resolve, SESSION_CLOSE_TIMEOUT_MS);
  });
  closeNormally(socket);
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
  const context: SessionContext = {
    ...deps,
    state
  };

  return {
    open: () => openSocket(context),
    dispose: () => disposeSession(state),
    sendAudio: (pcm16: Uint8Array) =>
      sendRealtime({
        state,
        input: {
          audio: {
            mimeType: AUDIO_MIME_TYPE,
            data: encodeBase64(pcm16)
          }
        }
      }),
    sendFrame: (jpeg: Uint8Array) =>
      sendRealtime({
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
