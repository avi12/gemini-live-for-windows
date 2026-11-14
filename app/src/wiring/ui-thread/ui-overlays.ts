import path from "node:path";
import type { MessagePort } from "node:worker_threads";

import { launchUri } from "winui-svelte/data-transfer";
import { windowsDisplaySource } from "winui-svelte/devices/display";
import { createMessagePortTransport } from "winui-svelte/state/host";
import { bringWindowToFront } from "winui-svelte/window/foreground";

import { createSessionStore, SESSION_FILE } from "@/google/session/cookies.ts";
import { copyTextWithPowerShell } from "@/lib/clipboard.ts";
import { dataDir } from "@/lib/paths.ts";
import type { Clipboard } from "@/overlays/ports.ts";
import {
  createCursorApi,
  createOverlayWindowHost,
  loadRegisterHotkey,
  prepareOverlayWindows,
  serveOverlayWindows
} from "@/overlays/worker.ts";
import { sealer } from "@/wiring/ui-thread/secret-sealer.ts";

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
export async function startOverlayWindows({ port, log }: { port: MessagePort; log: (message: string) => void }) {
  await prepareOverlayWindows();
  const register = await loadRegisterHotkey();
  const overlayLog = { write: log };
  const cursor = createCursorApi();
  // The Google account's saved session, the one the hidden Google pages start from
  const sessionStore = createSessionStore({
    filePath: path.join(dataDir(), SESSION_FILE),
    sealer,
    log: overlayLog
  });

  serveOverlayWindows({
    transport: createMessagePortTransport({ port }),
    log: overlayLog,
    createHost: events =>
      createOverlayWindowHost({
        events,
        deps: {
          register,
          bringToFront: bringWindowToFront,
          cursor,
          clipboard,
          launchUri,
          loadCookies: sessionStore.load,
          log: overlayLog,
          displayAreas: () => windowsDisplaySource().list(),
          schedule({ callback, milliseconds }) {
            const timer = setTimeout(callback, milliseconds);
            return () => clearTimeout(timer);
          },
          requestFrame(callback) {
            setTimeout(callback, FRAME_MILLISECONDS);
          },
          now: () => Date.now()
        }
      })
  });
}
