import { regionSchema } from "@gemini-live/protocol/view";
import type { ProtocolWithReturn } from "winui-svelte/messaging";
import { z } from "zod";

import { monitorSchema } from "@/contracts/monitor.ts";

// The overlay boundary: the controller on the main thread (engine, screen capture) and the windows
// on the UI worker (the share border, the focus chip and every global hotkey, which Windows delivers
// to the thread that registered it).

export const OverlayMessage = {
  // Controller to windows
  COVER_BORDER: "overlay/coverBorder",
  HIDE_BORDER: "overlay/hideBorder",
  ATTACH_CHIP: "overlay/attachChip",
  HIDE_CHIP: "overlay/hideChip",
  HOLD_FOCUS_ESCAPE: "overlay/holdFocusEscape",
  // Windows to controller
  FOCUS_ESCAPE_PRESSED: "overlay/focusEscapePressed",
  CHIP_DISMISSED: "overlay/chipDismissed",
  CHIP_DRAG_STARTED: "overlay/chipDragStarted",
  CHIP_DRAGGED: "overlay/chipDragged"
} as const;

export const coverBorderSchema = z.object({
  monitor: monitorSchema,
  // The watched part of the display, in its physical pixels; null for the whole display
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

export interface OverlayProtocol {
  [OverlayMessage.COVER_BORDER]: ProtocolWithReturn<CoverBorder, void>;
  [OverlayMessage.HIDE_BORDER]: ProtocolWithReturn<void, void>;
  [OverlayMessage.ATTACH_CHIP]: ProtocolWithReturn<AttachChip, void>;
  [OverlayMessage.HIDE_CHIP]: ProtocolWithReturn<void, void>;
  [OverlayMessage.HOLD_FOCUS_ESCAPE]: ProtocolWithReturn<HoldFocusEscape, void>;
  [OverlayMessage.FOCUS_ESCAPE_PRESSED]: ProtocolWithReturn<void, void>;
  [OverlayMessage.CHIP_DISMISSED]: ProtocolWithReturn<void, void>;
  [OverlayMessage.CHIP_DRAG_STARTED]: ProtocolWithReturn<void, void>;
  [OverlayMessage.CHIP_DRAGGED]: ProtocolWithReturn<ChipDragged, void>;
}
