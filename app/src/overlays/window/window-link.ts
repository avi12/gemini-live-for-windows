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
import { defineMessaging } from "winui-svelte/messaging";
import type { Transport } from "winui-svelte/state/host";

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

function parsed<T>(result: {
  success: true;
  data: T;
} | {
  success: false;
  error: Error;
}) {
  if (!result.success) {
    throw new Error(result.error.message);
  }

  return result.data;
}

// The windows' end of the overlay link (UI worker): serves the controller's requests with `host`
// and returns the events the windows raise, which go to the controller
export function serveOverlayWindows({ transport, createHost, log }: {
  transport: Transport;
  createHost: (events: OverlayWindowEvents) => OverlayWindowHost;
  log: OverlayLog;
}) {
  const messaging = defineMessaging<OverlayProtocol>({
    transport,
    onError: error => log.write(`overlays: ${error.message}`)
  });
  const host = createHost({
    focusEscapePressed: () => messaging.notify(OverlayMessage.focusEscapePressed),
    chipDismissed: () => messaging.notify(OverlayMessage.chipDismissed),
    chipDragStarted: () => messaging.notify(OverlayMessage.chipDragStarted),
    chipDragged: travelled => messaging.notify(OverlayMessage.chipDragged, {
      dx: travelled.x,
      dy: travelled.y
    }),
    circleKeyPressed: () => messaging.notify(OverlayMessage.circleKeyPressed),
    async readCircleText(options) {
      const lines = await messaging.sendMessage(OverlayMessage.readCircleText, options);
      return ocrLinesSchema.parse(lines);
    }
  });

  messaging.onMessage(OverlayMessage.coverBorder, message => {
    host.coverBorder(parsed(coverBorderSchema.safeParse(message.data)));
  });
  messaging.onMessage(OverlayMessage.hideBorder, () => {
    host.hideBorder();
  });
  messaging.onMessage(OverlayMessage.attachChip, message => {
    host.attachChip(parsed(attachChipSchema.safeParse(message.data)));
  });
  messaging.onMessage(OverlayMessage.hideChip, () => {
    host.hideChip();
  });
  messaging.onMessage(OverlayMessage.holdFocusEscape, message => {
    host.holdFocusEscape(parsed(holdFocusEscapeSchema.safeParse(message.data)).isHeld);
  });
  messaging.onMessage(
    OverlayMessage.openCircle,
    message => host.openCircle(parsed(openCircleSchema.safeParse(message.data)))
  );

  return () => messaging.close();
}
