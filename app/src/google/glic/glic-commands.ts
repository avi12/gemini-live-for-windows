import { type GlicWebHost, SEND_TIMEOUT_MS } from "./glic-web-host.ts";
import type { Logger } from "@/google/ports.ts";
import { GlicMessage } from "@/google/protocols/glic.ts";
import { withinMs } from "@/google/web-host/timeout.ts";
import { errorMessage } from "@/lib/error-message.ts";

// Sends a command to the page without waiting for it. A page that is loading or gone misses it,
// which is logged; with no engine at all there is nobody to tell.
function createCommandSender({ webHost, log }: {
  webHost: GlicWebHost;
  log: Logger;
}) {
  return async function command({ label, send }: {
    label: string;
    send: () => Promise<unknown>;
  }) {
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
export function createGlicCommands({ webHost, log }: {
  webHost: GlicWebHost;
  log: Logger;
}) {
  const { messenger } = webHost;
  const command = createCommandSender({
    webHost,
    log
  });

  return {
    sendStart: () => command({
      label: GlicMessage.start,
      send: () => messenger.sendMessage(GlicMessage.start)
    }),
    sendStop: () => command({
      label: GlicMessage.stop,
      send: () => messenger.sendMessage(GlicMessage.stop)
    }),
    sendMuted: (isMuted: boolean) => command({
      label: GlicMessage.setMuted,
      send: () => messenger.sendMessage(GlicMessage.setMuted, isMuted)
    }),
    sendMic: (id: string | null) => command({
      label: GlicMessage.setMic,
      send: () => messenger.sendMessage(GlicMessage.setMic, id)
    })
  };
}

export type GlicCommands = ReturnType<typeof createGlicCommands>;
