import type net from "node:net";
import { createInterface } from "node:readline";

import type { Transport } from "@gemini-live/messaging";

function parseLine(line: string) {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed;
  } catch {
    return undefined;
  }
}

// One JSON envelope per line over a socket (a named pipe or TCP)
export function socketTransport(socket: net.Socket) {
  const transport = {
    post(envelope) {
      socket.write(`${JSON.stringify(envelope)}\n`);
    },
    listen(receive) {
      createInterface({ input: socket }).on("line", line => receive(parseLine(line)));
    }
  } satisfies Transport;
  return transport;
}
