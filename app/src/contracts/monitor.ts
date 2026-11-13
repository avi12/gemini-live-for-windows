import { refreshRateSchema, regionSchema } from "@gemini-live/protocol/view";
import { z } from "zod";

// One physical display, in physical pixels (the process is per-monitor DPI aware). The work edges
// are where the taskbar leaves the area free, where the pill docks. Mirrors MonitorInfo.cs.
export const monitorSchema = regionSchema.extend({
  deviceName: z.string(),
  index: z.number().int().positive(),
  isPrimary: z.boolean(),
  workRight: z.number().int(),
  workBottom: z.number().int(),
  refreshRateHertz: refreshRateSchema
});

export type Monitor = z.infer<typeof monitorSchema>;

export type Region = z.infer<typeof regionSchema>;

export function monitorName(monitor: Monitor) {
  return `Display ${monitor.index}`;
}

export function isSameDisplay({ first, second }: { first: Monitor | undefined; second: Monitor | undefined }) {
  return first?.deviceName === second?.deviceName;
}
