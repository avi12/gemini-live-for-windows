import { z } from "zod";

const CaptureLimit = {
  MIN_FRAMES_PER_SECOND: 1,
  MAX_FRAMES_PER_SECOND: 240,
  MAX_EDGE_PIXELS: 1024
} as const;

const MILLISECONDS_PER_SECOND = 1000;

const displayIdSchema = z.string().regex(/^\d+$/u, "a display id is a decimal number");

const framesPerSecondSchema = z
  .number()
  .min(CaptureLimit.MIN_FRAMES_PER_SECOND)
  .max(CaptureLimit.MAX_FRAMES_PER_SECOND);

const previewSizeSchema = z.object({
  width: z.number().int().positive().max(CaptureLimit.MAX_EDGE_PIXELS),
  height: z.number().int().positive().max(CaptureLimit.MAX_EDGE_PIXELS)
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

interface RepeatOptions {
  intervalMilliseconds: number;
  run: () => void;
}

export interface CaptureScheduler {
  repeat(options: RepeatOptions): () => void;
}

export function framePeriodMilliseconds(targetFramesPerSecond: number) {
  return MILLISECONDS_PER_SECOND / targetFramesPerSecond;
}
