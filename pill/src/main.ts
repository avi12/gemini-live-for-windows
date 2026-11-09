import { startRelay } from "@/lib/relay.ts";
import path from "node:path";
import { Worker } from "node:worker_threads";

await startRelay({
  startWindow: port => new Worker(path.join(import.meta.dirname, "window.js"), {
    workerData: {
      port
    },
    transferList: [port]
  })
});
