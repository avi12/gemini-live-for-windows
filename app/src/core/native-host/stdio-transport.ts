import type { Readable, Writable } from "node:stream";

import type { Transport } from "@gemini-live/messaging";

import { noop } from "@/lib/noop.ts";

import { encodeFrame, readFrames } from "./frame.ts";

function parseFrame(json: string) {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed;
  } catch {
    return undefined;
  }
}

// Envelopes as a browser's native messaging frames; `closed` settles once the browser lets go of
// our input, with the reason when the input was not a valid stream of frames
export function stdioTransport({ input, output }: { input: Readable; output: Writable }) {
  let finish: (reason: unknown) => void = noop;
  const closed = new Promise<unknown>(resolve => {
    finish = resolve;
  });
  const transport: Transport = {
    post(envelope) {
      output.write(encodeFrame(JSON.stringify(envelope)));
    },
    listen(receive) {
      void (async () => {
        for await (const json of readFrames(input)) {
          receive(parseFrame(json));
        }
      })().then(() => finish(undefined), finish);
    }
  };
  return {
    transport,
    closed
  };
}
