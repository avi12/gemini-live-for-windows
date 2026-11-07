import type { RawDisplay } from "./monitor-structs.ts";
import { monitorSchema } from "@/contracts/monitor.ts";
import type { Monitor } from "@/contracts/monitor.ts";

function toMonitor({ raw, index }: {
  raw: RawDisplay;
  index: number;
}) {
  return monitorSchema.safeParse({
    deviceName: raw.deviceName,
    index,
    isPrimary: raw.isPrimary,
    x: raw.left,
    y: raw.top,
    width: raw.right - raw.left,
    height: raw.bottom - raw.top,
    workRight: raw.workRight,
    workBottom: raw.workBottom
  });
}

// Left to right, ties top to bottom, numbered from 1: how Windows' own display settings roughly
// number them (Monitors.cs). One physical display is listed once even if two devices map to it.
export function orderDisplays(raws: readonly RawDisplay[]) {
  const unique = [...new Map(raws.map(raw => [raw.deviceName, raw])).values()];
  const sorted = unique.toSorted((first, second) => first.left - second.left || first.top - second.top);
  const monitors: Monitor[] = [];
  for (const raw of sorted) {
    const parsed = toMonitor({
      raw,
      index: monitors.length + 1
    });
    if (parsed.success) {
      monitors.push(parsed.data);
    }
  }
  return monitors;
}

// The display Windows named `deviceName`; the primary one if it is gone or none was named
export function displayNamed({ all, deviceName }: {
  all: readonly Monitor[];
  deviceName: string | undefined;
}) {
  const named = all.find(monitor => monitor.deviceName === deviceName);
  return named ?? all.find(monitor => monitor.isPrimary) ?? all[0];
}

// After displays changed: the current version of `display` in `all`, or `fallback` if it was unplugged
export function reconcileDisplay({ all, display, fallback }: {
  all: readonly Monitor[];
  display: Monitor;
  fallback: () => Monitor;
}) {
  return all.find(monitor => monitor.deviceName === display.deviceName) ?? fallback();
}

// The same physical displays in the same places: nothing the pill or the capture needs to redo
export function haveDisplaysChanged({ before, after }: {
  before: readonly Monitor[];
  after: readonly Monitor[];
}) {
  const isResized = before.length !== after.length;
  if (isResized) {
    return true;
  }

  return before.some((monitor, iMonitor) => JSON.stringify(monitor) !== JSON.stringify(after[iMonitor]));
}
