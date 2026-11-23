import { defineMessaging } from "winui-svelte/messaging";
import type { Transport } from "winui-svelte/state/host";

import type { Monitor } from "@/contracts/monitor.ts";
import type { OverlayLog } from "@/overlays/ports.ts";
import { OverlayMessage } from "@/overlays/protocol.ts";
import type { OverlayProtocol } from "@/overlays/protocol.ts";

// The controller's end of the overlay link (main thread): the share border it drives on the UI worker
export function connectOverlayWindows({ transport, log }: { transport: Transport; log: OverlayLog }) {
  const messaging = defineMessaging<OverlayProtocol>({
    transport,
    onError: error => log.write(`overlays: ${error.message}`)
  });

  return {
    shareBorder: {
      cover: (monitor: Monitor) => messaging.notify(OverlayMessage.COVER_BORDER, { monitor }),
      hideBorder: () => messaging.notify(OverlayMessage.HIDE_BORDER)
    }
  };
}
