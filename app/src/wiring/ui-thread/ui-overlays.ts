import { copyTextWithPowerShell } from "@/lib/clipboard.ts";
import type { Clipboard } from "@/overlays/ports.ts";
import {
  createCursorApi,
  createForegroundApi,
  createOverlayWindowHost,
  loadRegisterHotkey,
  prepareOverlayWindows,
  serveOverlayWindows
} from "@/overlays/worker.ts";
import type { MessagePort } from "node:worker_threads";
import { createMessagePortTransport } from "winui-svelte/state/host";

// About one 60 Hz frame; the circle overlay folds the pointer's moves into one update per frame
const FRAME_MILLISECONDS = 16;

const clipboard: Clipboard = {
  async writeText(text) {
    try {
      await copyTextWithPowerShell(text);
      return true;
    } catch {
      return false;
    }
  }
};

// The share border, the focus chip, the circle overlay and every global hotkey: all of them are
// windows or message-pump hooks, so they live here and the main thread drives them over the link
export async function startOverlayWindows({ port, isDebugging, log }: {
  port: MessagePort;
  isDebugging: boolean;
  log: (message: string) => void;
}) {
  await prepareOverlayWindows();
  const register = await loadRegisterHotkey();
  const overlayLog = { write: log };
  const foreground = createForegroundApi();
  const cursor = createCursorApi();

  serveOverlayWindows({
    transport: createMessagePortTransport({ port }),
    log: overlayLog,
    createHost: events => createOverlayWindowHost({
      events,
      deps: {
        register,
        foreground,
        cursor,
        clipboard,
        log: overlayLog,
        isDebugging,
        requestFrame(callback) {
          setTimeout(callback, FRAME_MILLISECONDS);
        },
        now: () => Date.now()
      }
    })
  });
}
