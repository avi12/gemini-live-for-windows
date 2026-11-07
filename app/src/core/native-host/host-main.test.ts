import { encodeFrame, MAX_MESSAGE_BYTES, readFrames } from "./frame.ts";
import { serveNativeHost } from "./host-main.ts";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";

const HEADER_BYTES = 4;
// Inside the first header, then inside the second frame's body
const FIRST_CUT = 2;
const SECOND_CUT = 9;

async function collect(frames: AsyncIterable<string>) {
  const all: string[] = [];
  for await (const frame of frames) {
    all.push(frame);
  }

  return all;
}

function request({ id, type }: {
  id: number;
  type: string;
}) {
  return encodeFrame(
    JSON.stringify({
      id,
      type,
      data: null,
      timestamp: 1
    })
  );
}

describe("frames", () => {
  it("writes a 4-byte little-endian length, then UTF-8", () => {
    const frame = encodeFrame("{\"a\":\"é\"}");
    assert.equal(frame.readUInt32LE(0), frame.length - HEADER_BYTES);
    assert.equal(frame.subarray(HEADER_BYTES).toString("utf8"), "{\"a\":\"é\"}");
  });

  it("reads frames split across arbitrary chunks, and several in one chunk", async () => {
    const input = new PassThrough();
    const wire = Buffer.concat([encodeFrame("one"), encodeFrame("deux é"), encodeFrame("")]);
    const pending = collect(readFrames(input));
    input.write(wire.subarray(0, FIRST_CUT));
    input.write(wire.subarray(FIRST_CUT, SECOND_CUT));
    input.write(wire.subarray(SECOND_CUT));
    input.end();
    assert.deepEqual(await pending, ["one", "deux é", ""]);
  });

  it("ends quietly when the browser closes the input", async () => {
    const input = new PassThrough();
    input.end();
    assert.deepEqual(await collect(readFrames(input)), []);
  });

  it("rejects a frame larger than a request can be", async () => {
    const input = new PassThrough();
    const header = Buffer.alloc(HEADER_BYTES);
    header.writeUInt32LE(MAX_MESSAGE_BYTES + 1);
    input.end(header);
    await assert.rejects(collect(readFrames(input)), RangeError);
  });
});

describe("serveNativeHost", () => {
  async function converse({ requests, link }: {
    requests: Buffer[];
    link: {
      port: number;
      token: string;
    } | undefined;
  }) {
    const input = new PassThrough();
    const output = new PassThrough();
    const serving = serveNativeHost({
      input,
      output,
      readLink: async () => link
    });
    for (const frame of requests) {
      input.write(frame);
    }

    input.end();
    await serving;
    await new Promise(resolve => setImmediate(resolve));
    output.end();
    return collect(readFrames(output));
  }

  it("answers a link request with the running app's link", async () => {
    const replies = await converse({
      requests: [request({
        id: 7,
        type: "link"
      })],
      link: {
        port: 5123,
        token: "abc"
      }
    });
    assert.deepEqual(replies.map(reply => JSON.parse(reply)), [{
      replyTo: 7,
      res: {
        port: 5123,
        token: "abc"
      }
    }]);
  });

  it("answers null when the app isn't running", async () => {
    const replies = await converse({
      requests: [request({
        id: 1,
        type: "link"
      })],
      link: undefined
    });
    assert.deepEqual(replies.map(reply => JSON.parse(reply)), [{
      replyTo: 1,
      res: null
    }]);
  });

  it("answers an unknown type with an error and skips what is not an envelope", async () => {
    const replies = await converse({
      requests: [encodeFrame("not json"), encodeFrame("[]"), request({
        id: 2,
        type: "nope"
      })],
      link: undefined
    });
    assert.deepEqual(replies.map(reply => JSON.parse(reply)), [{
      replyTo: 2,
      err: "No listener for \"nope\""
    }]);
  });
});
