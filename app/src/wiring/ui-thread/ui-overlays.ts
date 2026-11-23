import type { MessagePort } from "node:worker_threads";

import { createMessagePortTransport } from "winui-svelte/state/host";

import { createOverlayWindowHost } from "@/overlays/window/window-host.ts";
import { serveOverlayWindows } from "@/overlays/window/window-link.ts";
import { prepareOverlayWindows } from "@/overlays/worker.ts";

// The share border is a window, so it lives here and the main thread drives it over the link
export async function startOverlayWindows({ port, log }: { port: MessagePort; log: (message: string) => void }) {
  await prepareOverlayWindows();
  serveOverlayWindows({
    transport: createMessagePortTransport({ port }),
    log: {
      write: log
    },
    host: createOverlayWindowHost()
  });
}
