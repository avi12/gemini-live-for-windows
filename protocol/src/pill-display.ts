import { z } from "zod";

// The displays the pill lists and shares, part of the pill's view (view.ts).

export const DEFAULT_REFRESH_RATE_HERTZ = 60;
const LARGEST_UNKNOWN_REFRESH_RATE_HERTZ = 1;

export const refreshRateSchema = z.number().int().positive();

export function knownRefreshRate(reportedHertz: number) {
  const isUnknown = !Number.isFinite(reportedHertz) || reportedHertz <= LARGEST_UNKNOWN_REFRESH_RATE_HERTZ;
  return isUnknown ? DEFAULT_REFRESH_RATE_HERTZ : Math.round(reportedHertz);
}

export const regionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive()
});

export const displaySchema = regionSchema.extend({
  id: z.string(),
  index: z.number().int().positive(),
  isPrimary: z.boolean(),
  refreshRateHertz: refreshRateSchema
});

export type PillDisplay = z.infer<typeof displaySchema>;
