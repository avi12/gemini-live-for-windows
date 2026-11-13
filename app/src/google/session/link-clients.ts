import { defineMessaging, type Messenger } from "@gemini-live/messaging";
import {
  type BrowserCookie,
  browserCookiesSchema,
  LinkMessage,
  type LinkProtocolMap
} from "@gemini-live/protocol/link";
import { WebSocket } from "ws";

import type { Logger } from "@/google/ports.ts";
import { createFrameTransport } from "@/google/web-host/transports.ts";
import { errorMessage } from "@/lib/error-message.ts";

import { authCookies } from "./cookies.ts";

function createSocketTransport(socket: WebSocket) {
  return createFrameTransport({
    send(json) {
      const isOpen = socket.readyState === WebSocket.OPEN;
      if (isOpen) {
        socket.send(json);
      }
    },
    onFrame: listener =>
      socket.on("message", (data, isBinary) => {
        const isText = !isBinary && Buffer.isBuffer(data);
        if (!isText) {
          return;
        }

        listener(data.toString("utf8"));
      })
  });
}

async function greet({
  socket,
  messenger,
  token,
  log
}: {
  socket: WebSocket;
  messenger: Messenger<LinkProtocolMap>;
  token: string;
  log: Logger;
}) {
  try {
    await messenger.sendMessage(LinkMessage.HELLO, token);
    return true;
  } catch (error) {
    log.write(`session link: hello refused: ${errorMessage(error)}`);
    socket.terminate();
    return false;
  }
}

function deliverCookies({
  received,
  log,
  onCookies
}: {
  received: unknown;
  log: Logger;
  onCookies: (cookies: readonly BrowserCookie[]) => void;
}) {
  const parsed = browserCookiesSchema.safeParse(received);
  if (!parsed.success) {
    log.write("session link: cookies in an unknown shape");
    return;
  }

  const auth = authCookies(parsed.data);
  log.write(`session link: ${auth.length} auth cookies from the browser`);
  onCookies(auth);
}

async function queryCookies({
  messenger,
  log,
  onCookies
}: {
  messenger: Messenger<LinkProtocolMap>;
  log: Logger;
  onCookies: (cookies: readonly BrowserCookie[]) => void;
}) {
  try {
    deliverCookies({
      received: await messenger.sendMessage(LinkMessage.QUERY),
      log,
      onCookies
    });
  } catch (error) {
    log.write(`session link query: ${errorMessage(error)}`);
  }
}

// The socket's messenger once it has said hello with the token; undefined when it was refused
async function openClient({
  socket,
  token,
  log,
  messageTimeoutMs,
  onCookies,
  onClosed
}: {
  socket: WebSocket;
  token: string;
  log: Logger;
  messageTimeoutMs: number;
  onCookies: (cookies: readonly BrowserCookie[]) => void;
  onClosed: (messenger: Messenger<LinkProtocolMap>) => void;
}) {
  const messenger = defineMessaging<LinkProtocolMap>(createSocketTransport(socket), { timeoutMs: messageTimeoutMs });
  messenger.onMessage(LinkMessage.COOKIES, message => {
    deliverCookies({
      received: message.data,
      log,
      onCookies
    });
  });
  socket.on("error", error => log.write(`session link: ${error.message}`));
  socket.on("close", () => onClosed(messenger));

  const isGreeted = await greet({
    socket,
    messenger,
    token,
    log
  });
  return isGreeted ? messenger : undefined;
}

// The extension connections that said hello with this run's token: what they send, and what the
// app asks of them
export function createLinkClients({
  log,
  token,
  messageTimeoutMs,
  onCookies,
  onConnected
}: {
  log: Logger;
  token: string;
  messageTimeoutMs: number;
  onCookies: (cookies: readonly BrowserCookie[]) => void;
  onConnected: () => void;
}) {
  const clients = new Set<Messenger<LinkProtocolMap>>();

  async function serve(socket: WebSocket) {
    const messenger = await openClient({
      socket,
      token,
      log,
      messageTimeoutMs,
      onCookies,
      onClosed(closed) {
        if (clients.delete(closed)) {
          log.write("session link: extension disconnected");
        }
      }
    });
    if (!messenger) {
      return;
    }

    clients.add(messenger);
    log.write("session link: extension connected");
    onConnected();
  }

  return {
    serve,
    get count() {
      return clients.size;
    },
    broadcast(type: typeof LinkMessage.REFRESH | typeof LinkMessage.PING) {
      for (const messenger of clients) {
        messenger.sendMessage(type).catch(error => log.write(`session link ${type}: ${errorMessage(error)}`));
      }
    },
    requestCookies() {
      for (const messenger of clients) {
        void queryCookies({
          messenger,
          log,
          onCookies
        });
      }
    },
    clear() {
      clients.clear();
    }
  };
}
