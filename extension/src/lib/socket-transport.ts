import type { Transport } from "@gemini-live/messaging";

/** The link's socket as a messaging transport: JSON text frames both ways. */
export function socketTransport(socket: WebSocket) {
  return {
    post(envelope) {
      // A closing socket drops the frame; its sender's timeout reports it.
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(envelope));
      }
    },
    listen(receive) {
      socket.addEventListener("message", ({ data }) => {
        if (typeof data !== "string") {
          return;
        }

        try {
          receive(JSON.parse(data));
        } catch {
          // Not ours to interpret; the app only sends JSON.
        }
      });
    }
  } satisfies Transport;
}
