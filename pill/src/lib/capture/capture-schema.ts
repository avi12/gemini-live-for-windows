import { z } from "zod";

const CaptureLimit = {
  minFramesPerSecond: 1,
  maxFramesPerSecond: 240,
  maxEdgePixels: 1024
} as const;

const MILLISECONDS_PER_SECOND = 1000;

const displayIdSchema = z.string().regex(/^\d+$/u, "a display id is a decimal number");

const framesPerSecondSchema = z
  .number()
  .min(CaptureLimit.minFramesPerSecond)
  .max(CaptureLimit.maxFramesPerSecond);

const previewSizeSchema = z.object({
  width: z.number().int().positive().max(CaptureLimit.maxEdgePixels),
  height: z.number().int().positive().max(CaptureLimit.maxEdgePixels)
});

export const captureConfigSchema = z.object({
  displayId: displayIdSchema,
  targetFramesPerSecond: framesPerSecondSchema,
  size: previewSizeSchema
});

const captureTargetSchema = z.object({
  displayId: displayIdSchema,
  targetFramesPerSecond: framesPerSecondSchema
});

export const captureTargetsSchema = z.array(captureTargetSchema);

export type CaptureConfig = z.infer<typeof captureConfigSchema>;
export type CaptureTarget = z.infer<typeof captureTargetSchema>;
export type PreviewSize = z.infer<typeof previewSizeSchema>;

export interface PreviewFrame {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export interface CaptureSource {
  readNextFrame(): PreviewFrame | undefined;
  close(): void;
}

export interface CaptureBridge {
  openSource(config: CaptureConfig): CaptureSource;
}

export interface PreviewDisplay {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PreviewSource {
  captureIdOf(display: PreviewDisplay): string | undefined;
  bridge: CaptureBridge;
}

export interface CaptureScheduler {
  every(options: {
    intervalMilliseconds: number;
    run: () => void;
  }): () => void;
}

export function framePeriodMilliseconds(targetFramesPerSecond: number) {
  return MILLISECONDS_PER_SECOND / targetFramesPerSecond;
}
