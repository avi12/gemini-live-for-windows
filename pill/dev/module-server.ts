import path from "node:path";
import type { MessagePort } from "node:worker_threads";

import { startModuleServer } from "winui-svelte/vite";

export const PILL_ROOT = path.resolve(import.meta.dirname, "..");
export const PILL_ENTRY = "/src/mount.ts";
const VITE_CONFIG_FILE = "vite.config.ts";

// A module server for the package at `root`, configured by that package's own vite config, answering
// on `port` to a window module runner. The root is the caller's to give, so the pill never reaches
// into the packages that load their code through it (the app's UI and main threads).
export function serveModules({ root, port }: { root: string; port: MessagePort }) {
  return startModuleServer({
    root,
    configFile: path.join(root, VITE_CONFIG_FILE),
    port
  });
}
