import type { Logger } from "@/google/ports.ts";
import { GlicMessage } from "@/google/protocols/glic.ts";
import { withinMs } from "@/google/web-host/timeout.ts";
import { errorMessage } from "@/lib/error-message.ts";

import { type GlicWebHost, SEND_TIMEOUT_MS } from "./glic-web-host.ts";

// Sends a command to the page without waiting for it. A page that is loading or gone misses it,
// which is logged; with no engine at all there is nobody to tell.
function createCommandSender({ webHost, log }: { webHost: GlicWebHost; log: Logger }) {
  return async function command({ label, send }: { label: string; send: () => Promise<unknown> }) {
    if (!webHost.core) {
      return;
    }

    try {
      await withinMs({
        work: send(),
        durationMs: SEND_TIMEOUT_MS,
        label
      });
    } catch (error) {
      log.write(`glic: ${label} failed: ${errorMessage(error)}`);
    }
  };
}

// What the host says to the page
export function createGlicCommands({ webHost, log }: { webHost: GlicWebHost; log: Logger }) {
  const { messenger } = webHost;
  const command = createCommandSender({
    webHost,
    log
  });

  return {
    sendStart: () =>
      command({
        label: GlicMessage.START,
        send: () => messenger.sendMessage(GlicMessage.START)
      }),
    sendStop: () =>
      command({
        label: GlicMessage.STOP,
        send: () => messenger.sendMessage(GlicMessage.STOP)
      }),
    sendMuted: (isMuted: boolean) =>
      command({
        label: GlicMessage.SET_MUTED,
        send: () => messenger.sendMessage(GlicMessage.SET_MUTED, isMuted)
      }),
    sendMic: (id: string | null) =>
      command({
        label: GlicMessage.SET_MIC,
        send: () => messenger.sendMessage(GlicMessage.SET_MIC, id)
      })
  };
}

export type GlicCommands = ReturnType<typeof createGlicCommands>;
