import { defineMessaging } from "winui-svelte/messaging";
import type { Transport } from "winui-svelte/state/host";

import { errorMessage } from "@/lib/error-message.ts";
import type { FocusWindows } from "@/overlays/focus/screen-focus.ts";
import type { OverlayLog } from "@/overlays/ports.ts";
import {
  chipDraggedSchema,
  circleOutcomeSchema,
  OverlayMessage,
  readCircleTextSchema,
  scanCircleCodesSchema,
  searchCircleSchema,
  searchRegionSchema
} from "@/overlays/protocol.ts";
import type {
  OcrLines,
  OpenCircle,
  OverlayProtocol,
  ReadCircleText,
  ScanCircleCodes,
  SearchCircle,
  SearchRegion
} from "@/overlays/protocol.ts";
import type { Point } from "@/overlays/shapes.ts";

// What the windows tell the controller
export interface OverlayControllerEvents {
  focusEscapePressed(): void;
  chipDismissed(): void;
  chipDragStarted(): void;
  chipDragged(travelled: Point): void;
  chipSelectTextPressed(): void;
  circleKeyPressed(): void;
  // OCR of the frozen still the open circle overlay shows, inside the region or all of it
  readCircleText(options: ReadCircleText): Promise<OcrLines>;
  // Reverse image search on the circled part of the frozen still: whether the page opened
  searchCircle(options: SearchCircle): Promise<string>;
  // The same for the region of the live screen the region frame sits over
  searchRegion(options: SearchRegion): Promise<string>;
  // The decoded text of each QR code inside the region of the frozen still
  scanCircleCodes(options: ScanCircleCodes): Promise<string[]>;
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
  messaging.onMessage(OverlayMessage.SELECT_CHIP_TEXT, () => {
    events.chipSelectTextPressed();
  });
  messaging.onMessage(OverlayMessage.CIRCLE_KEY_PRESSED, () => {
    events.circleKeyPressed();
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
  messaging.onMessage(OverlayMessage.READ_CIRCLE_TEXT, async message => {
    const parsed = readCircleTextSchema.safeParse(message.data);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    return events.readCircleText(parsed.data);
  });
  messaging.onMessage(OverlayMessage.SEARCH_CIRCLE, async message => {
    const parsed = searchCircleSchema.safeParse(message.data);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    return events.searchCircle(parsed.data);
  });
  messaging.onMessage(OverlayMessage.SEARCH_REGION, async message => {
    const parsed = searchRegionSchema.safeParse(message.data);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    return events.searchRegion(parsed.data);
  });
  messaging.onMessage(OverlayMessage.SCAN_CIRCLE_CODES, async message => {
    const parsed = scanCircleCodesSchema.safeParse(message.data);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    return events.scanCircleCodes(parsed.data);
  });
}

// The controller's end of the overlay link (main thread): the windows it drives, the circle overlay
// it opens, and the events it hears back
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

  function notifyFailure(error: unknown) {
    log.write(`overlays: ${errorMessage(error)}`);
  }

  const windows: FocusWindows = {
    coverBorder: options => messaging.notify(OverlayMessage.COVER_BORDER, options),
    hideBorder: () => messaging.notify(OverlayMessage.HIDE_BORDER),
    attachChip: options => messaging.notify(OverlayMessage.ATTACH_CHIP, options),
    hideChip: () => messaging.notify(OverlayMessage.HIDE_CHIP),
    holdEscape: options => messaging.notify(OverlayMessage.HOLD_FOCUS_ESCAPE, options)
  };

  // Resolves when the overlay is gone: the action and region the user chose, or that they backed out
  async function openCircle(options: OpenCircle) {
    const answer = await messaging.sendMessage(OverlayMessage.OPEN_CIRCLE, options).catch((error: unknown) => {
      notifyFailure(error);
      return {
        isCancelled: true,
        error: errorMessage(error)
      } as const;
    });
    return circleOutcomeSchema.parse(answer);
  }

  return {
    windows,
    openCircle,
    closeCircle: () => messaging.notify(OverlayMessage.CLOSE_CIRCLE),
    close: () => messaging.close()
  };
}
