import { regionSchema } from "@gemini-live/protocol/view";
import type { ProtocolWithReturn } from "winui-svelte/messaging";
import { z } from "zod";

import { monitorSchema } from "@/contracts/monitor.ts";

// The overlay boundary: the controller on the main thread (engine, screen capture, OCR, Lens) and
// the windows on the UI worker (the share border, the focus chip, the circle overlay and every
// global hotkey, which Windows delivers to the thread that registered it).

export const OverlayMessage = {
  // Controller to windows
  COVER_BORDER: "overlay/coverBorder",
  HIDE_BORDER: "overlay/hideBorder",
  ATTACH_CHIP: "overlay/attachChip",
  HIDE_CHIP: "overlay/hideChip",
  HOLD_FOCUS_ESCAPE: "overlay/holdFocusEscape",
  OPEN_CIRCLE: "overlay/openCircle",
  // Windows to controller
  FOCUS_ESCAPE_PRESSED: "overlay/focusEscapePressed",
  CHIP_DISMISSED: "overlay/chipDismissed",
  CHIP_DRAG_STARTED: "overlay/chipDragStarted",
  CHIP_DRAGGED: "overlay/chipDragged",
  CIRCLE_KEY_PRESSED: "overlay/circleKeyPressed",
  READ_CIRCLE_TEXT: "overlay/readCircleText"
} as const;

export const CircleAction = {
  ASK_GEMINI: "askGemini",
  LENS: "lens"
} as const;
export type CircleAction = (typeof CircleAction)[keyof typeof CircleAction];

export const coverBorderSchema = z.object({
  monitor: monitorSchema,
  // The circled part of the display, in its physical pixels; null for the whole display
  region: regionSchema.nullable()
});
export type CoverBorder = z.infer<typeof coverBorderSchema>;

export const attachChipSchema = z.object({
  monitor: monitorSchema,
  region: regionSchema
});
export type AttachChip = z.infer<typeof attachChipSchema>;

export const holdFocusEscapeSchema = z.object({ isHeld: z.boolean() });
export type HoldFocusEscape = z.infer<typeof holdFocusEscapeSchema>;

export const chipDraggedSchema = z.object({
  // How far the pointer moved since the drag began, in physical screen pixels
  dx: z.number(),
  dy: z.number()
});
export type ChipDragged = z.infer<typeof chipDraggedSchema>;

export const openCircleSchema = z.object({
  monitor: monitorSchema,
  // The frozen display as a JPEG, base64; the window shows it and the controller crops it
  stillJpegBase64: z.string(),
  stillWidth: z.number().int().positive(),
  stillHeight: z.number().int().positive(),
  isAskOnRelease: z.boolean()
});
export type OpenCircle = z.infer<typeof openCircleSchema>;

export const circleOutcomeSchema = z.discriminatedUnion("isCancelled", [
  z.object({ isCancelled: z.literal(true) }),
  z.object({
    isCancelled: z.literal(false),
    action: z.enum(CircleAction),
    // In the still's physical pixels
    region: regionSchema
  })
]);
export type CircleOutcome = z.infer<typeof circleOutcomeSchema>;

export const readCircleTextSchema = z.object({ region: regionSchema.nullable() });
export type ReadCircleText = z.infer<typeof readCircleTextSchema>;

export const ocrLinesSchema = z.array(
  z.object({
    words: z.array(
      z.object({
        text: z.string(),
        bounds: z.object({
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number()
        })
      })
    )
  })
);
export type OcrLines = z.infer<typeof ocrLinesSchema>;

export interface OverlayProtocol {
  [OverlayMessage.COVER_BORDER]: ProtocolWithReturn<CoverBorder, void>;
  [OverlayMessage.HIDE_BORDER]: ProtocolWithReturn<void, void>;
  [OverlayMessage.ATTACH_CHIP]: ProtocolWithReturn<AttachChip, void>;
  [OverlayMessage.HIDE_CHIP]: ProtocolWithReturn<void, void>;
  [OverlayMessage.HOLD_FOCUS_ESCAPE]: ProtocolWithReturn<HoldFocusEscape, void>;
  // Answered when the overlay is gone: the action and region, or that it was cancelled
  [OverlayMessage.OPEN_CIRCLE]: ProtocolWithReturn<OpenCircle, CircleOutcome>;
  [OverlayMessage.FOCUS_ESCAPE_PRESSED]: ProtocolWithReturn<void, void>;
  [OverlayMessage.CHIP_DISMISSED]: ProtocolWithReturn<void, void>;
  [OverlayMessage.CHIP_DRAG_STARTED]: ProtocolWithReturn<void, void>;
  [OverlayMessage.CHIP_DRAGGED]: ProtocolWithReturn<ChipDragged, void>;
  [OverlayMessage.CIRCLE_KEY_PRESSED]: ProtocolWithReturn<void, void>;
  [OverlayMessage.READ_CIRCLE_TEXT]: ProtocolWithReturn<ReadCircleText, OcrLines>;
}
