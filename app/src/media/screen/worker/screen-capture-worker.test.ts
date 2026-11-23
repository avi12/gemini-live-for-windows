import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { describe, it } from "node:test";
import { MessageChannel } from "node:worker_threads";

import type { Monitor, Region } from "@/contracts/monitor.ts";
import type { OcrLine } from "@/media/ocr/ocr-geometry.ts";
import { ScreenDetail } from "@/media/screen/capture-geometry.ts";
import type { GrabRequest, ScreenCapture } from "@/media/screen/screen-capture.ts";

import type { CaptureCommand } from "./screen-capture-protocol.ts";
import { serveScreenCapture } from "./screen-capture-worker-host.ts";
import { createScreenCaptureWorker } from "./screen-capture-worker-link.ts";
import type { CaptureWorker } from "./screen-capture-worker-link.ts";

const JPEG_BYTES = [0xff, 0xd8, 0xff];
const FRAME_WIDTH = 64;
const FRAME_HEIGHT = 36;
const EXIT_OK = 0;

const MONITOR: Monitor = {
  deviceName: "\\\\.\\DISPLAY1",
  index: 1,
  isPrimary: true,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  workRight: 1920,
  workBottom: 1040,
  refreshRateHertz: 60
};

// The link and the host joined by a real MessageChannel, standing in for the worker thread
function connect({
  screenCapture,
  readLines = () => Promise.resolve([])
}: {
  screenCapture: ScreenCapture;
  readLines?: (request: { image: Uint8Array; region?: Region | undefined }) => Promise<OcrLine[]>;
}) {
  const { port1, port2 } = new MessageChannel();
  const lifecycle = new EventEmitter();
  const logged: string[] = [];
  let spawned = 0;
  serveScreenCapture({
    port: port2,
    screenCapture,
    readLines,
    exit() {
      port1.close();
      port2.close();
      lifecycle.emit("exit", EXIT_OK);
    }
  });
  port1.on("message", message => lifecycle.emit("message", message));
  const worker: CaptureWorker = Object.assign(lifecycle, {
    postMessage: (command: CaptureCommand) => port1.postMessage(command)
  });
  const link = createScreenCaptureWorker({
    spawn() {
      spawned += 1;
      return worker;
    },
    log: message => logged.push(message)
  });
  return {
    link,
    lifecycle,
    logged,
    spawnCount: () => spawned
  };
}

describe("screen capture worker", () => {
  it("starts the thread at the first grab and hands back the encoded frame", async () => {
    const asked: GrabRequest[] = [];
    let disposed = 0;
    const { link, lifecycle, spawnCount } = connect({
      screenCapture: {
        grab(request) {
          asked.push(request);
          return Promise.resolve({
            jpeg: new Uint8Array(JPEG_BYTES),
            width: FRAME_WIDTH,
            height: FRAME_HEIGHT
          });
        },
        dispose() {
          disposed += 1;
        }
      }
    });
    assert.equal(spawnCount(), 0);

    const frame = await link.grab({
      monitor: MONITOR,
      detail: ScreenDetail.SHARP
    });
    assert.deepEqual([...frame.jpeg], JPEG_BYTES);
    assert.deepEqual([frame.width, frame.height], [FRAME_WIDTH, FRAME_HEIGHT]);
    assert.deepEqual(asked, [
      {
        monitor: MONITOR,
        region: undefined,
        detail: ScreenDetail.SHARP
      }
    ]);
    assert.equal(spawnCount(), 1);

    const exited = once(lifecycle, "exit");
    link.dispose();
    await exited;
    assert.equal(disposed, 1);
    await assert.rejects(
      link.grab({
        monitor: MONITOR,
        detail: ScreenDetail.LIGHT
      }),
      /disposed/
    );
  });

  it("reads the lines of a picture on the worker and leaves the caller its bytes", async () => {
    const line: OcrLine = {
      words: [
        {
          text: "שלום",
          bounds: {
            x: 1,
            y: 2,
            width: FRAME_WIDTH,
            height: FRAME_HEIGHT
          }
        }
      ]
    };
    const readBytes: number[][] = [];
    const { link } = connect({
      screenCapture: {
        grab: () => Promise.reject(new Error("unused")),
        dispose() {}
      },
      readLines({ image }) {
        readBytes.push([...image]);
        return Promise.resolve([line]);
      }
    });
    const image = new Uint8Array(JPEG_BYTES);
    assert.deepEqual(await link.readLines({ image }), [line]);
    assert.deepEqual(readBytes, [JPEG_BYTES]);
    assert.deepEqual([...image], JPEG_BYTES);
    link.dispose();
  });

  it("rejects a grab the worker failed, with its message", async () => {
    const { link } = connect({
      screenCapture: {
        grab: () => Promise.reject(new Error("BitBlt failed")),
        dispose() {}
      }
    });
    await assert.rejects(
      link.grab({
        monitor: MONITOR,
        detail: ScreenDetail.LIGHT
      }),
      /BitBlt failed/
    );
    link.dispose();
  });
});
