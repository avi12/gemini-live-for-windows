import { defineMessaging } from "winui-svelte/messaging";
import type { Transport } from "winui-svelte/state/host";

import type { FocusWindows } from "@/overlays/focus/screen-focus.ts";
import type { OverlayLog } from "@/overlays/ports.ts";
import { chipDraggedSchema, OverlayMessage } from "@/overlays/protocol.ts";
import type { OverlayProtocol } from "@/overlays/protocol.ts";
import type { Point } from "@/overlays/shapes.ts";

// What the windows tell the controller
export interface OverlayControllerEvents {
  focusEscapePressed(): void;
  chipDismissed(): void;
  chipDragStarted(): void;
  chipDragged(travelled: Point): void;
}

function listenForEvents({
  messaging,
  events
}: {
  messaging: ReturnType<typeof defineMessaging<OverlayProtocol>>;
  events: OverlayControllerEvents;
}) {
  messaging.onMessage(OverlayMessage.FOCUS_ESCAPE_PRESSED, () => {
    events.focusEscapePressed();
  });
  messaging.onMessage(OverlayMessage.CHIP_DISMISSED, () => {
    events.chipDismissed();
  });
  messaging.onMessage(OverlayMessage.CHIP_DRAG_STARTED, () => {
    events.chipDragStarted();
  });
  messaging.onMessage(OverlayMessage.CHIP_DRAGGED, message => {
    const parsed = chipDraggedSchema.safeParse(message.data);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    events.chipDragged({
      x: parsed.data.dx,
      y: parsed.data.dy
    });
  });
}

// The controller's end of the overlay link (main thread): the windows it drives and the events it
// hears back
export function connectOverlayWindows({
  transport,
  events,
  log
}: {
  transport: Transport;
  events: OverlayControllerEvents;
  log: OverlayLog;
}) {
  const messaging = defineMessaging<OverlayProtocol>({
    transport,
    onError: error => log.write(`overlays: ${error.message}`)
  });
  listenForEvents({
    messaging,
    events
  });

  const windows: FocusWindows = {
    coverBorder: options => messaging.notify(OverlayMessage.COVER_BORDER, options),
    hideBorder: () => messaging.notify(OverlayMessage.HIDE_BORDER),
    attachChip: options => messaging.notify(OverlayMessage.ATTACH_CHIP, options),
    hideChip: () => messaging.notify(OverlayMessage.HIDE_CHIP),
    holdEscape: options => messaging.notify(OverlayMessage.HOLD_FOCUS_ESCAPE, options)
  };

  return {
    windows,
    close: () => messaging.close()
  };
}
