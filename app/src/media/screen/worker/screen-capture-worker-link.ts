import type { Region } from "@/contracts/monitor.ts";
import { errorMessage } from "@/lib/error-message.ts";
import type { OcrLine } from "@/media/ocr/ocr-geometry.ts";
import type { EncodedFrame, GrabRequest, ScreenCapture } from "@/media/screen/screen-capture.ts";

import { CaptureCommandKind, CaptureReplyKind, captureReplySchema } from "./screen-capture-protocol.ts";
import type { CaptureCommand, CaptureReply, GrabCommand, ReadLinesCommand } from "./screen-capture-protocol.ts";

// The parts of a node:worker_threads Worker the link uses, so tests can hand it a fake
export interface CaptureWorker {
  postMessage(command: CaptureCommand): void;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "exit", listener: (exitCode: number) => void): unknown;
}

type Answer = Exclude<CaptureReply, { kind: typeof CaptureReplyKind.FAILED }>;

// Every command that waits for an answer, before the link numbers it
type AskedCommand = Omit<GrabCommand, "id"> | Omit<ReadLinesCommand, "id">;

interface Pending {
  resolve(answer: Answer): void;
  reject: (error: Error) => void;
}

function frameOf(answer: Answer) {
  if (answer.kind !== CaptureReplyKind.FRAME) {
    throw new Error(`The screen capture worker answered a grab with ${answer.kind}`);
  }

  return {
    jpeg: answer.jpeg,
    width: answer.width,
    height: answer.height
  } satisfies EncodedFrame;
}

function linesOf(answer: Answer) {
  if (answer.kind !== CaptureReplyKind.LINES) {
    throw new Error(`The screen capture worker answered a text read with ${answer.kind}`);
  }

  return answer.lines satisfies OcrLine[];
}

// Screen capture and OCR on a worker thread of their own: the GDI grab of a large display, the JPEG
// encode and the text recognition (Windows OCR, the LiteRT Hebrew model) take from a hundred
// milliseconds to seconds, which on the caller's thread freezes the pill. The caller only posts the
// request and awaits the answer. The thread starts at the first request, and again after a crash; the
// worker serialises the grabs itself. `dispose()` lets the worker finish its work and end.
export function createScreenCaptureWorker({
  spawn,
  log
}: {
  spawn: () => CaptureWorker;
  log: (message: string) => void;
}) {
  const pending = new Map<number, Pending>();
  let worker: CaptureWorker | undefined;
  let nextId = 0;
  let isDisposed = false;

  function failAll(message: string) {
    for (const { reject } of pending.values()) {
      reject(new Error(message));
    }

    pending.clear();
  }

  function receive(message: unknown) {
    const parsed = captureReplySchema.safeParse(message);
    if (!parsed.success) {
      log(`screen capture worker: unreadable reply: ${parsed.error.message}`);
      return;
    }

    const reply = parsed.data;
    const waiter = pending.get(reply.id);
    pending.delete(reply.id);

    if (reply.kind === CaptureReplyKind.FAILED) {
      waiter?.reject(new Error(reply.message));
      return;
    }

    waiter?.resolve(reply);
  }

  function start() {
    const started = spawn();
    started.on("message", receive);
    started.on("error", error => {
      log(`screen capture worker: ${errorMessage(error)}`);
    });
    started.on("exit", exitCode => {
      const isCurrent = worker === started;
      if (isCurrent) {
        worker = undefined;
      }

      failAll(`The screen capture worker ended (exit code ${exitCode})`);
    });
    return started;
  }

  function ask(command: AskedCommand) {
    if (isDisposed) {
      return Promise.reject(new Error("The screen capture is disposed"));
    }

    worker ??= start();
    nextId += 1;
    const id = nextId;
    const answer = new Promise<Answer>((resolve, reject) => {
      pending.set(id, {
        resolve,
        reject
      });
    });
    worker.postMessage({
      ...command,
      id
    });
    return answer;
  }

  async function grab({ monitor, region, detail }: GrabRequest) {
    return frameOf(
      await ask({
        kind: CaptureCommandKind.GRAB,
        monitor,
        region,
        detail
      })
    );
  }

  // All text lines of an encoded picture, as ocr.ts's readLines reads them, on the worker's thread.
  // The picture is copied to the worker, so the caller keeps its bytes.
  async function readLines({ image, region }: { image: Uint8Array; region?: Region | undefined }) {
    return linesOf(
      await ask({
        kind: CaptureCommandKind.READ_LINES,
        image,
        region
      })
    );
  }

  function dispose() {
    isDisposed = true;
    worker?.postMessage({ kind: CaptureCommandKind.DISPOSE });
    worker = undefined;
  }

  return {
    grab,
    readLines,
    dispose
  } satisfies ScreenCapture & { readLines: typeof readLines };
}
