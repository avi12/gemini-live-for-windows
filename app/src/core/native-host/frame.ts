import type { Readable } from "node:stream";

const LENGTH_BYTES = 4;
// The extension only ever sends small requests; anything bigger isn't one of ours
const BYTES_PER_MEBIBYTE = 1_048_576;
export const MAX_MESSAGE_BYTES = BYTES_PER_MEBIBYTE;

// A browser's native messaging frame: a 4-byte little-endian length, then that much UTF-8 JSON
export function encodeFrame(json: string) {
  const body = Buffer.from(json, "utf8");
  const header = Buffer.alloc(LENGTH_BYTES);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

// The messages from the browser, one per frame, until it closes our input
export async function* readFrames(input: Readable) {
  let pending = Buffer.alloc(0);
  for await (const chunk of input) {
    pending = Buffer.concat([pending, Buffer.from(chunk)]);
    while (pending.length >= LENGTH_BYTES) {
      const length = pending.readUInt32LE(0);
      const isTooLarge = length > MAX_MESSAGE_BYTES;
      if (isTooLarge) {
        throw new RangeError(`message of ${length} bytes`);
      }

      const end = LENGTH_BYTES + length;
      const isIncomplete = pending.length < end;
      if (isIncomplete) {
        break;
      }

      yield pending.subarray(LENGTH_BYTES, end).toString("utf8");
      pending = pending.subarray(end);
    }
  }
}
