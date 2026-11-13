import path from "node:path";
import { MessageChannel, Worker } from "node:worker_threads";

import type * as MountModule from "@gemini-live/pill/mount";
import { createWindowModuleRunner } from "winui-svelte/runner";

import { PILL_ENTRY } from "./module-server.ts";

const SERVER_MODULE = path.join(import.meta.dirname, "module-server-worker.ts");

// For an app that mounts the pill itself: the same mountPill as the bundle's, loaded through the
// module server (on its own thread, since this one is about to run the window's message pump)
export async function loadDevMountPill() {
  const modules = new MessageChannel();
  new Worker(SERVER_MODULE, {
    workerData: {
      modules: modules.port2
    },
    transferList: [modules.port2]
  });
  const { runner } = createWindowModuleRunner(modules.port1);
  const { mountPill } = await runner.import<typeof MountModule>(PILL_ENTRY);
  return mountPill;
}
