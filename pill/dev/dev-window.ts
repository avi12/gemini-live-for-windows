import path from "node:path";
import { MessageChannel, Worker } from "node:worker_threads";
import type { MessagePort } from "node:worker_threads";

import { PILL_ROOT, serveModules } from "./module-server.ts";

const WINDOW_MODULE = path.join(import.meta.dirname, "window.ts");

// The pill's window as a worker that loads its code from the module server, over `port` for the
// host's state protocol
export async function startDevWindow({ port, isFakeCapture = false }: { port: MessagePort; isFakeCapture?: boolean }) {
  const modules = new MessageChannel();
  const server = await serveModules({
    root: PILL_ROOT,
    port: modules.port1
  });
  const worker = new Worker(WINDOW_MODULE, {
    workerData: {
      modules: modules.port2,
      port,
      isFakeCapture
    },
    transferList: [modules.port2, port]
  });
  return {
    worker,
    server
  };
}
