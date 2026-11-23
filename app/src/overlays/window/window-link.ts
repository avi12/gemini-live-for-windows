import { defineMessaging } from "winui-svelte/messaging";
import type { Transport } from "winui-svelte/state/host";

import type { OverlayLog } from "@/overlays/ports.ts";
import { coverBorderSchema, OverlayMessage } from "@/overlays/protocol.ts";
import type { CoverBorder, OverlayProtocol } from "@/overlays/protocol.ts";

// What the controller can ask of the windows (UI worker)
export interface OverlayWindowHost {
  coverBorder(options: CoverBorder): void;
  hideBorder(): void;
}

// The windows' end of the overlay link (UI worker): serves the controller's requests with `host`
export function serveOverlayWindows({
  transport,
  host,
  log
}: {
  transport: Transport;
  host: OverlayWindowHost;
  log: OverlayLog;
}) {
  const messaging = defineMessaging<OverlayProtocol>({
    transport,
    onError: error => log.write(`overlays: ${error.message}`)
  });

  messaging.onMessage(OverlayMessage.COVER_BORDER, message => {
    const parsed = coverBorderSchema.safeParse(message.data);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    host.coverBorder(parsed.data);
  });
  messaging.onMessage(OverlayMessage.HIDE_BORDER, () => {
    host.hideBorder();
  });

  return () => messaging.close();
}
