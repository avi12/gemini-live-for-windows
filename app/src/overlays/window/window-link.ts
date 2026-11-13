import { defineMessaging } from "winui-svelte/messaging";
import type { Transport } from "winui-svelte/state/host";

import type { OverlayLog } from "@/overlays/ports.ts";
import {
  attachChipSchema,
  coverBorderSchema,
  holdFocusEscapeSchema,
  ocrLinesSchema,
  openCircleSchema,
  OverlayMessage
} from "@/overlays/protocol.ts";
import type {
  AttachChip,
  CircleOutcome,
  CoverBorder,
  OcrLines,
  OpenCircle,
  OverlayProtocol,
  ReadCircleText
} from "@/overlays/protocol.ts";
import type { Point } from "@/overlays/shapes.ts";

// What the controller can ask of the windows (UI worker)
export interface OverlayWindowHost {
  coverBorder(options: CoverBorder): void;
  hideBorder(): void;
  attachChip(options: AttachChip): void;
  hideChip(): void;
  holdFocusEscape(isHeld: boolean): void;
  openCircle(options: OpenCircle): Promise<CircleOutcome>;
}

// What the windows tell the controller
export interface OverlayWindowEvents {
  focusEscapePressed(): void;
  chipDismissed(): void;
  chipDragStarted(): void;
  chipDragged(travelled: Point): void;
  circleKeyPressed(): void;
  readCircleText(options: ReadCircleText): Promise<OcrLines>;
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
      }),
    circleKeyPressed: () => messaging.notify(OverlayMessage.CIRCLE_KEY_PRESSED),
    async readCircleText(options) {
      const lines = await messaging.sendMessage(OverlayMessage.READ_CIRCLE_TEXT, options);
      return ocrLinesSchema.parse(lines);
    }
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
  messaging.onMessage(OverlayMessage.OPEN_CIRCLE, message =>
    host.openCircle(parsed(openCircleSchema.safeParse(message.data)))
  );

  return () => messaging.close();
}
