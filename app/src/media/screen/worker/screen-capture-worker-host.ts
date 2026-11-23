import type { Region } from "@/contracts/monitor.ts";
import { errorMessage } from "@/lib/error-message.ts";
import type { OcrLine } from "@/media/ocr/ocr-geometry.ts";
import type { ScreenCapture } from "@/media/screen/screen-capture.ts";

import { CaptureCommandKind, captureCommandSchema, CaptureReplyKind } from "./screen-capture-protocol.ts";
import type { CaptureReply, GrabCommand, ReadLinesCommand } from "./screen-capture-protocol.ts";

// The two ends of the worker's port, so the host runs against a MessageChannel in tests
export interface CapturePort {
  postMessage(reply: CaptureReply, transfer?: readonly ArrayBuffer[]): void;
  on(event: "message", listener: (message: unknown) => void): void;
}

// Bytes that own their whole ArrayBuffer, so the buffer can be transferred, not copied
function ownedBytes(bytes: Uint8Array) {
  const isWholeBuffer =
    bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  return isWholeBuffer ? new Uint8Array(bytes.buffer) : bytes.slice();
}

// The worker's whole behaviour: grab commands in, frames out (the JPEG's buffer moves, not copied),
// and pictures in, OCR lines out. A dispose waits for the work already asked for, disposes the capture
// and ends the thread through `exit`. Importing it does nothing; screen-capture-worker.ts is the entry
// that calls it.
export function serveScreenCapture({
  port,
  screenCapture,
  readLines,
  exit
}: {
  port: CapturePort;
  screenCapture: ScreenCapture;
  readLines: (request: { image: Uint8Array; region?: Region | undefined }) => Promise<OcrLine[]>;
  exit: () => void;
}) {
  let settled: Promise<unknown> = Promise.resolve();

  async function grab({ id, monitor, region, detail }: GrabCommand) {
    const frame = await screenCapture.grab({
      monitor,
      region,
      detail
    });
    const jpeg = ownedBytes(frame.jpeg);
    port.postMessage(
      {
        kind: CaptureReplyKind.FRAME,
        id,
        jpeg,
        width: frame.width,
        height: frame.height
      },
      [jpeg.buffer]
    );
  }

  async function read({ id, image, region }: ReadLinesCommand) {
    port.postMessage({
      kind: CaptureReplyKind.LINES,
      id,
      lines: await readLines({
        image,
        region
      })
    });
  }

  async function answer(command: GrabCommand | ReadLinesCommand) {
    try {
      await (command.kind === CaptureCommandKind.GRAB ? grab(command) : read(command));
    } catch (error) {
      port.postMessage({
        kind: CaptureReplyKind.FAILED,
        id: command.id,
        message: errorMessage(error)
      });
    }
  }

  port.on("message", message => {
    const command = captureCommandSchema.parse(message);
    const isDispose = command.kind === CaptureCommandKind.DISPOSE;
    if (!isDispose) {
      const next = answer(command);
      settled = settled.then(() => next);
      return;
    }

    void settled.then(() => {
      screenCapture.dispose();
      exit();
    });
  });
}
