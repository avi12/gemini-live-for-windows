import { servePillModules } from "./module-server.ts";
import path from "node:path";
import { MessageChannel, Worker } from "node:worker_threads";
import type { MessagePort } from "node:worker_threads";

const WINDOW_MODULE = path.join(import.meta.dirname, "window.ts");

// The pill's window as a worker that loads its code from the module server, over `port` for the
// host's state protocol
export async function startDevWindow({ port }: { port: MessagePort }) {
  const modules = new MessageChannel();
  const server = await servePillModules({ port: modules.port1 });
  const worker = new Worker(WINDOW_MODULE, {
    workerData: {
      modules: modules.port2,
      port
    },
    transferList: [modules.port2, port]
  });
  return {
    worker,
    server
  };
}
