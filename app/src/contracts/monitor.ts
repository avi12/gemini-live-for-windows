import { refreshRateSchema } from "@gemini-live/protocol/view";
import { z } from "zod";

// One physical display, in physical pixels (the process is per-monitor DPI aware). The work edges
// are where the taskbar leaves the area free, where the pill docks. Mirrors MonitorInfo.cs.
export const monitorSchema = z.object({
  deviceName: z.string(),
  index: z.number().int().positive(),
  isPrimary: z.boolean(),
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  workRight: z.number().int(),
  workBottom: z.number().int(),
  refreshRateHertz: refreshRateSchema
});

export type Monitor = z.infer<typeof monitorSchema>;

export const regionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive()
});

export type Region = z.infer<typeof regionSchema>;

export function monitorName(monitor: Monitor) {
  return `Display ${monitor.index}`;
}

export function isSameDisplay({ first, second }: {
  first: Monitor | undefined;
  second: Monitor | undefined;
}) {
  return first?.deviceName === second?.deviceName;
}
