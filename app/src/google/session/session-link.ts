import { randomBytes } from "node:crypto";

import { type BrowserCookie, LinkMessage } from "@gemini-live/protocol/link";

import { createEmitter } from "@/google/emitter.ts";
import type { LinkPublisher, Logger } from "@/google/ports.ts";

import { createLinkClients } from "./link-clients.ts";
import { createLinkServer } from "./link-server.ts";

const TOKEN_BYTES = 32;
const PING_INTERVAL_MS = 20_000;
// The extension answers from a live service worker at once; a slower reply means it is gone
const MESSAGE_TIMEOUT_MS = 10_000;

// What the hosts need from the link to the extension; the real one is createSessionLink
export interface SessionSource {
  readonly isExtensionConnected: boolean;
  onCookies(listener: (cookies: readonly BrowserCookie[]) => void): () => void;
  onConnected(listener: () => void): () => void;
  requestCookies(): void;
  requestRefresh(): void;
}

// The loopback WebSocket the companion browser extension keeps open. It pushes the browser's
// Google cookies on connect and on every rotation; the app can also ask for them on demand. Only
// the extension's pinned ID may connect.
//
// No fixed port, since any port can already be taken: it listens on a free one and publishes it
// with a fresh token, which the extension asks the native messaging host for. The extension sends
// cookies only after the app's Hello carries that token, so whatever else ends up on a stale port
// never gets the session.
export function createSessionLink({
  log,
  publisher,
  pingIntervalMs = PING_INTERVAL_MS,
  messageTimeoutMs = MESSAGE_TIMEOUT_MS
}: {
  log: Logger;
  publisher: LinkPublisher;
  pingIntervalMs?: number;
  messageTimeoutMs?: number;
}) {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const cookiesEmitter = createEmitter<readonly BrowserCookie[]>();
  const connectedEmitter = createEmitter<undefined>();
  const clients = createLinkClients({
    log,
    token,
    messageTimeoutMs,
    onCookies: cookiesEmitter.emit,
    onConnected: () => connectedEmitter.emit(undefined)
  });
  const server = createLinkServer({
    log,
    publisher,
    token,
    pingIntervalMs,
    onSocket(socket) {
      void clients.serve(socket);
    },
    onPing: () => clients.broadcast(LinkMessage.PING)
  });

  const source: SessionSource = {
    get isExtensionConnected() {
      return clients.count > 0;
    },
    onCookies: listener => cookiesEmitter.subscribe(listener),
    onConnected: listener => connectedEmitter.subscribe(() => listener()),
    // Ask the extension for the current session right now
    requestCookies: clients.requestCookies,
    // The session we have stopped working: ask the extension to have the browser refresh it. The
    // refreshed cookies arrive like any rotation.
    requestRefresh: () => clients.broadcast(LinkMessage.REFRESH)
  };

  return {
    source,
    start: server.start,
    stop() {
      server.stop();
      clients.clear();
    }
  };
}
