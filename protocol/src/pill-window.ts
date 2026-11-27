import { regionSchema } from "./pill-display.ts";
import { z } from "./zod.ts";

// The pill window's own messages, beside the view: bringing it to the front, moving it by a delta,
// clipping it to a region, and restoring the app that had focus before it.

export const WindowMessage = {
  BRING_TO_FRONT: "bringToFront",
  MOVE_BY: "moveBy",
  CLIP_TO: "clipTo",
  RESTORE_PREVIOUS_APP: "restorePreviousApp"
} as const;

export const moveByDataSchema = z.object({
  deltaX: z.number().int(),
  deltaY: z.number().int()
});

type MoveByData = z.infer<typeof moveByDataSchema>;

export const clipToDataSchema = z.object({ region: regionSchema.nullable() });

export type ClipToData = z.infer<typeof clipToDataSchema>;

export interface WindowProtocol {
  [WindowMessage.BRING_TO_FRONT](): void;
  [WindowMessage.MOVE_BY](data: MoveByData): void;
  [WindowMessage.CLIP_TO](data: ClipToData): void;
  [WindowMessage.RESTORE_PREVIOUS_APP](): void;
}
