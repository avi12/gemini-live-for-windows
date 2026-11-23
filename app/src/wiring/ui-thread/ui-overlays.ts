import type { MessagePort } from "node:worker_threads";

import { createMessagePortTransport } from "winui-svelte/state/host";

import {
  createCursorApi,
  createOverlayWindowHost,
  loadRegisterHotkey,
  prepareOverlayWindows,
  serveOverlayWindows
} from "@/overlays/worker.ts";

// The share border, the focus chip and the global hotkey: all of them are windows or message-pump
// hooks, so they live here and the main thread drives them over the link
export async function startOverlayWindows({ port, log }: { port: MessagePort; log: (message: string) => void }) {
  await prepareOverlayWindows();
  const register = await loadRegisterHotkey();
  const overlayLog = { write: log };
  const cursor = createCursorApi();

  serveOverlayWindows({
    transport: createMessagePortTransport({ port }),
    log: overlayLog,
    createHost: events =>
      createOverlayWindowHost({
        events,
        deps: {
          register,
          cursor,
          log: overlayLog
        }
      })
  });
}
