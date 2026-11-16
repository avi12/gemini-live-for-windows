import path from "node:path";
import { MessageChannel, Worker } from "node:worker_threads";

import { createWindowModuleRunner } from "winui-svelte/runner";

const SERVER_MODULE = path.join(import.meta.dirname, "module-server-worker.ts");

// One of the app's modules, loaded through a module server of the repo's source instead of from the
// bundle. The app's UI thread and its main thread each load their whole code this way, the pill's
// included, so that every part of a thread shares one copy of winui-svelte. (A pill served on its own
// next to a bundled UI thread has two copies, and the controls its components register are not the
// ones the window draws with.) The server runs on a thread of its own, since this one is about to run
// the window's pump or the app.
export async function loadDevModule<Exports>(entry: string) {
  const modules = new MessageChannel();
  new Worker(SERVER_MODULE, {
    workerData: {
      modules: modules.port2
    },
    transferList: [modules.port2]
  });
  const { runner } = createWindowModuleRunner(modules.port1);
  return runner.import<Exports>(entry);
}
