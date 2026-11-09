import path from "node:path";
import type { MessagePort } from "node:worker_threads";
import { startModuleServer } from "winui-svelte/vite";

export const PILL_ROOT = path.resolve(import.meta.dirname, "..");
export const PILL_ENTRY = "/src/mount.ts";

// The one place the pill's module server is configured: the pill's own vite config, answering on
// `port` to a window module runner
export function servePillModules({ port }: { port: MessagePort }) {
  return startModuleServer({
    root: PILL_ROOT,
    configFile: path.join(PILL_ROOT, "vite.config.ts"),
    port
  });
}
