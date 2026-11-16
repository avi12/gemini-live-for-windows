import path from "node:path";
import type { MessagePort } from "node:worker_threads";

import { startModuleServer } from "winui-svelte/vite";

export const PILL_ROOT = path.resolve(import.meta.dirname, "..");
export const PILL_ENTRY = "/src/mount.ts";
const APP_ROOT = path.resolve(PILL_ROOT, "..", "app");

// The one place the pill's module server is configured: the pill's own vite config, answering on
// `port` to a window module runner
export function servePillModules({ port }: { port: MessagePort }) {
  return startModuleServer({
    root: PILL_ROOT,
    configFile: path.join(PILL_ROOT, "vite.config.ts"),
    port
  });
}

// The same for the installed app's UI thread, which carries the pill
export function serveAppModules({ port }: { port: MessagePort }) {
  return startModuleServer({
    root: APP_ROOT,
    configFile: path.join(APP_ROOT, "vite.config.ts"),
    port
  });
}
