import { SocketState } from "@/live/api/constants.ts";

export interface SocketClose {
  readonly code: number;
  readonly reason: string;
}

// The smallest surface the session needs from a WebSocket, so tests drive it without a network
export interface LiveSocket {
  isOpen(): boolean;
  send(data: string): void;
  close(args: SocketClose): void;
  onOpen(listener: () => void): void;
  onError(listener: () => void): void;
  onMessage(listener: (text: string) => void): void;
  onClose(listener: (event: SocketClose) => void): void;
}

export type SocketConnector = (url: string) => LiveSocket;

const textDecoder = new TextDecoder();

// The server sends JSON in binary frames; both frame types carry UTF-8 JSON
function decodeFrame(data: unknown) {
  const isText = typeof data === "string";
  if (isText) {
    return data;
  }

  const isBinary = data instanceof ArrayBuffer;
  if (isBinary) {
    return textDecoder.decode(data);
  }

  return undefined;
}

export function connectWebSocket(url: string) {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  return {
    isOpen: () => socket.readyState === SocketState.open,
    send: data => socket.send(data),
    close: ({ code, reason }) => socket.close(code, reason),
    onOpen: listener => socket.addEventListener("open", () => listener()),
    onError: listener => socket.addEventListener("error", () => listener()),
    onMessage: listener => socket.addEventListener("message", event => {
      const text = decodeFrame(event.data);
      const isUnreadable = text === undefined;
      if (isUnreadable) {
        return;
      }

      listener(text);
    }),
    onClose: listener => socket.addEventListener("close", event => {
      listener({
        code: event.code,
        reason: event.reason
      });
    })
  } satisfies LiveSocket;
}
