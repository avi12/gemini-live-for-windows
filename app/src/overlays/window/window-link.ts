import { defineMessaging } from "winui-svelte/messaging";
import type { Transport } from "winui-svelte/state/host";

import type { OverlayLog } from "@/overlays/ports.ts";
import { attachChipSchema, coverBorderSchema, holdFocusEscapeSchema, OverlayMessage } from "@/overlays/protocol.ts";
import type { AttachChip, CoverBorder, OverlayProtocol } from "@/overlays/protocol.ts";
import type { Point } from "@/overlays/shapes.ts";

// What the controller can ask of the windows (UI worker)
export interface OverlayWindowHost {
  coverBorder(options: CoverBorder): void;
  hideBorder(): void;
  attachChip(options: AttachChip): void;
  hideChip(): void;
  holdFocusEscape(isHeld: boolean): void;
}

// What the windows tell the controller
export interface OverlayWindowEvents {
  focusEscapePressed: () => void;
  chipDismissed: () => void;
  chipDragStarted: () => void;
  chipDragged: (travelled: Point) => void;
}

function parsed<T>(
  result:
    | {
        success: true;
        data: T;
      }
    | {
        success: false;
        error: Error;
      }
) {
  if (!result.success) {
    throw new Error(result.error.message);
  }

  return result.data;
}

// The windows' end of the overlay link (UI worker): serves the controller's requests with `host`
// and returns the events the windows raise, which go to the controller
export function serveOverlayWindows({
  transport,
  createHost,
  log
}: {
  transport: Transport;
  createHost: (events: OverlayWindowEvents) => OverlayWindowHost;
  log: OverlayLog;
}) {
  const messaging = defineMessaging<OverlayProtocol>({
    transport,
    onError: error => log.write(`overlays: ${error.message}`)
  });
  const host = createHost({
    focusEscapePressed: () => messaging.notify(OverlayMessage.FOCUS_ESCAPE_PRESSED),
    chipDismissed: () => messaging.notify(OverlayMessage.CHIP_DISMISSED),
    chipDragStarted: () => messaging.notify(OverlayMessage.CHIP_DRAG_STARTED),
    chipDragged: travelled =>
      messaging.notify(OverlayMessage.CHIP_DRAGGED, {
        dx: travelled.x,
        dy: travelled.y
      })
  });

  messaging.onMessage(OverlayMessage.COVER_BORDER, message => {
    host.coverBorder(parsed(coverBorderSchema.safeParse(message.data)));
  });
  messaging.onMessage(OverlayMessage.HIDE_BORDER, () => {
    host.hideBorder();
  });
  messaging.onMessage(OverlayMessage.ATTACH_CHIP, message => {
    host.attachChip(parsed(attachChipSchema.safeParse(message.data)));
  });
  messaging.onMessage(OverlayMessage.HIDE_CHIP, () => {
    host.hideChip();
  });
  messaging.onMessage(OverlayMessage.HOLD_FOCUS_ESCAPE, message => {
    host.holdFocusEscape(parsed(holdFocusEscapeSchema.safeParse(message.data)).isHeld);
  });

  return () => messaging.close();
}
