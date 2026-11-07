import type { AudioWorkerLink } from "./audio-duplex.ts";
import { AudioEventKind } from "./audio-protocol.ts";
import { errorMessage } from "@/lib/error-message.ts";
import { Worker } from "node:worker_threads";

// A worker thread of its own for audio: its timers are plain libuv timers, not tied to the window's
// dispatcher, and the graph's polling never waits on painting. A crash of the thread reaches the
// listener as a `failed` event.
export function createAudioWorkerLink({ workerUrl }: { workerUrl: URL }) {
  const worker = new Worker(workerUrl);
  return {
    post: (command, transfer = []) => worker.postMessage(command, [...transfer]),
    onMessage(listener) {
      worker.on("message", listener);
      worker.on("error", error => listener({
        kind: AudioEventKind.failed,
        message: errorMessage(error)
      }));
    },
    async terminate() {
      await worker.terminate();
    }
  } satisfies AudioWorkerLink;
}
