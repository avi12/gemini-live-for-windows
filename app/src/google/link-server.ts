import type { LinkPublisher, Logger } from "./ports.ts";
import { EXTENSION_ORIGIN } from "@gemini-live/protocol/link";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";

const LOOPBACK = "127.0.0.1";
const HTTP_FORBIDDEN = 403;

async function listenOnFreePort(log: Logger) {
  const listening = new WebSocketServer({
    host: LOOPBACK,
    port: 0,
    verifyClient(info, callback) {
      const isExtension = info.origin === EXTENSION_ORIGIN;
      if (!isExtension) {
        log.write(`session link: refused origin ${info.origin || "(none)"}`);
      }

      callback(isExtension, HTTP_FORBIDDEN, "Forbidden");
    }
  });
  const isListening = await new Promise<boolean>(resolve => {
    listening.once("listening", () => resolve(true));
    listening.once("error", error => {
      log.write(`session link: cannot listen: ${error.message}`);
      resolve(false);
    });
  });
  return isListening ? listening : undefined;
}

// The loopback WebSocket server on a free port, open to the extension's origin only. Once up it
// publishes the port with the run's token and pings its clients to keep the extension awake.
export function createLinkServer({ log, publisher, token, pingIntervalMs, onSocket, onPing }: {
  log: Logger;
  publisher: LinkPublisher;
  token: string;
  pingIntervalMs: number;
  onSocket: (socket: WebSocket) => void;
  onPing: () => void;
}) {
  let server: WebSocketServer | undefined;
  let pingTimer: NodeJS.Timeout | undefined;

  // Resolves with the port once listening; undefined when no port could be taken
  async function start() {
    const listening = await listenOnFreePort(log);
    const isClosed = !listening;
    if (isClosed) {
      return undefined;
    }

    server = listening;
    listening.on("connection", onSocket);
    const address = listening.address();
    const isNetworkAddress = address !== null && typeof address !== "string";
    if (!isNetworkAddress) {
      return undefined;
    }

    const { port } = address;
    log.write(`session link: listening on ${port}`);
    await publisher.publish({
      port,
      token
    });
    pingTimer = setInterval(onPing, pingIntervalMs);
    return port;
  }

  function stop() {
    clearInterval(pingTimer);
    for (const client of server?.clients ?? []) {
      client.terminate();
    }

    server?.close();
    server = undefined;
  }

  return {
    start,
    stop
  };
}
