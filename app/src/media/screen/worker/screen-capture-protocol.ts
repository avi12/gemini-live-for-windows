import { regionSchema } from "@gemini-live/protocol/view";
import { z } from "@gemini-live/protocol/zod";

import { monitorSchema } from "@/contracts/monitor.ts";
import { ScreenDetail } from "@/media/screen/capture-geometry.ts";

// The two directions of the screen capture worker's port: screen grabs, and OCR of a picture (Windows
// OCR plus the LiteRT Hebrew recogniser), both kept off the caller's thread. Both ends parse what they receive: the
// worker is a thread boundary, and a malformed message must fail loudly, not hang a grab.
export const CaptureCommandKind = {
  GRAB: "grab",
  READ_LINES: "readLines",
  DISPOSE: "dispose"
} as const;

export const CaptureReplyKind = {
  FRAME: "frame",
  LINES: "lines",
  FAILED: "failed"
} as const;

const ocrLineSchema = z.object({
  words: z
    .array(
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
    .readonly()
});

export const captureCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(CaptureCommandKind.GRAB),
    id: z.number().int(),
    monitor: monitorSchema,
    region: regionSchema.optional(),
    detail: z.enum(ScreenDetail)
  }),
  z.object({
    kind: z.literal(CaptureCommandKind.READ_LINES),
    id: z.number().int(),
    // Any Uint8Array view: the caller's picture is copied across, never moved
    image: z.instanceof(Uint8Array<ArrayBufferLike>),
    region: regionSchema.optional()
  }),
  z.object({ kind: z.literal(CaptureCommandKind.DISPOSE) })
]);

export const captureReplySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(CaptureReplyKind.FRAME),
    id: z.number().int(),
    jpeg: z.instanceof(Uint8Array),
    width: z.number().int(),
    height: z.number().int()
  }),
  z.object({
    kind: z.literal(CaptureReplyKind.LINES),
    id: z.number().int(),
    lines: z.array(ocrLineSchema)
  }),
  z.object({
    kind: z.literal(CaptureReplyKind.FAILED),
    id: z.number().int(),
    message: z.string()
  })
]);

export type CaptureCommand = z.infer<typeof captureCommandSchema>;
export type GrabCommand = Extract<CaptureCommand, { kind: typeof CaptureCommandKind.GRAB }>;
export type ReadLinesCommand = Extract<CaptureCommand, { kind: typeof CaptureCommandKind.READ_LINES }>;
export type CaptureReply = z.infer<typeof captureReplySchema>;
