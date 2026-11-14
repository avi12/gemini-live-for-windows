import type { OverlayLog } from "@/overlays/ports.ts";
import {
  attachChipSchema,
  codeTextsSchema,
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
  ReadCircleText,
  ScanCircleCodes,
  SearchCircle,
  SearchRegion
} from "@/overlays/protocol.ts";
import type { Point } from "@/overlays/shapes.ts";
import { defineMessaging } from "winui-svelte/messaging";
import type { Transport } from "winui-svelte/state/host";
import { z } from "zod";

// What the controller can ask of the windows (UI worker)
export interface OverlayWindowHost {
  coverBorder(options: CoverBorder): void;
  hideBorder(): void;
  attachChip(options: AttachChip): void;
  hideChip(): void;
  holdFocusEscape(isHeld: boolean): void;
  openCircle(options: OpenCircle): Promise<CircleOutcome>;
  closeCircle(): void;
}

// What the windows tell the controller
export interface OverlayWindowEvents {
  focusEscapePressed(): void;
  chipDismissed(): void;
  chipDragStarted(): void;
  chipDragged(travelled: Point): void;
  circleKeyPressed(): void;
  readCircleText(options: ReadCircleText): Promise<OcrLines>;
  searchCircle(options: SearchCircle): Promise<string>;
  searchRegion(options: SearchRegion): Promise<string>;
  scanCircleCodes(options: ScanCircleCodes): Promise<string[]>;
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
    },
    async searchCircle(options) {
      const url = await messaging.sendMessage(OverlayMessage.searchCircle, options);
      return z.string().parse(url);
    },
    async searchRegion(options) {
      const url = await messaging.sendMessage(OverlayMessage.searchRegion, options);
      return z.string().parse(url);
    },
    async scanCircleCodes(options) {
      const texts = await messaging.sendMessage(OverlayMessage.scanCircleCodes, options);
      return codeTextsSchema.parse(texts);
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
  messaging.onMessage(OverlayMessage.closeCircle, () => {
    host.closeCircle();
  });

  return () => messaging.close();
}
