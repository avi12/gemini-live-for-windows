import { z } from "./zod.ts";

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

// The work edges are where the taskbar leaves the display free: they move when the taskbar comes back
// after a graphics driver reset, and the pill docks again on that change
export const displaySchema = regionSchema.extend({
  id: z.string(),
  index: z.number().int().positive(),
  isPrimary: z.boolean(),
  workRight: z.number().int(),
  workBottom: z.number().int(),
  refreshRateHertz: refreshRateSchema
});

export type PillDisplay = z.infer<typeof displaySchema>;
