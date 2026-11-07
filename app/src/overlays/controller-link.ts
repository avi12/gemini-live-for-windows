import { errorMessage } from "@/lib/error-message.ts";
import type { FocusWindows } from "@/overlays/focus/screen-focus.ts";
import type { OverlayLog } from "@/overlays/ports.ts";
import { chipDraggedSchema, circleOutcomeSchema, OverlayMessage, readCircleTextSchema } from "@/overlays/protocol.ts";
import type { OcrLines, OpenCircle, OverlayProtocol, ReadCircleText } from "@/overlays/protocol.ts";
import type { Point } from "@/overlays/shapes.ts";
import { defineMessaging } from "winui-svelte/messaging";
import type { Transport } from "winui-svelte/state/host";

// What the windows tell the controller
export interface OverlayControllerEvents {
  focusEscapePressed(): void;
  chipDismissed(): void;
  chipDragStarted(): void;
  chipDragged(travelled: Point): void;
  circleKeyPressed(): void;
  // OCR of the frozen still the open circle overlay shows, inside the region or all of it
  readCircleText(options: ReadCircleText): Promise<OcrLines>;
}

function listenForEvents({ messaging, events }: {
  messaging: ReturnType<typeof defineMessaging<OverlayProtocol>>;
  events: OverlayControllerEvents;
}) {
  messaging.onMessage(OverlayMessage.focusEscapePressed, () => {
    events.focusEscapePressed();
  });
  messaging.onMessage(OverlayMessage.chipDismissed, () => {
    events.chipDismissed();
  });
  messaging.onMessage(OverlayMessage.chipDragStarted, () => {
    events.chipDragStarted();
  });
  messaging.onMessage(OverlayMessage.circleKeyPressed, () => {
    events.circleKeyPressed();
  });
  messaging.onMessage(OverlayMessage.chipDragged, message => {
    const parsed = chipDraggedSchema.safeParse(message.data);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    events.chipDragged({
      x: parsed.data.dx,
      y: parsed.data.dy
    });
  });
  messaging.onMessage(OverlayMessage.readCircleText, async message => {
    const parsed = readCircleTextSchema.safeParse(message.data);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    return events.readCircleText(parsed.data);
  });
}

// The controller's end of the overlay link (main thread): the windows it drives, the circle overlay
// it opens, and the events it hears back
export function connectOverlayWindows({ transport, events, log }: {
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

  function notifyFailure(error: unknown) {
    log.write(`overlays: ${errorMessage(error)}`);
  }

  const windows: FocusWindows = {
    coverBorder: options => messaging.notify(OverlayMessage.coverBorder, options),
    hideBorder: () => messaging.notify(OverlayMessage.hideBorder),
    attachChip: options => messaging.notify(OverlayMessage.attachChip, options),
    hideChip: () => messaging.notify(OverlayMessage.hideChip),
    holdEscape: options => messaging.notify(OverlayMessage.holdFocusEscape, options)
  };

  // Resolves when the overlay is gone: the action and region the user chose, or that they backed out
  async function openCircle(options: OpenCircle) {
    const answer = await messaging.sendMessage(OverlayMessage.openCircle, options).catch((error: unknown) => {
      notifyFailure(error);
      return { isCancelled: true } as const;
    });
    return circleOutcomeSchema.parse(answer);
  }

  return {
    windows,
    openCircle,
    close: () => messaging.close()
  };
}
