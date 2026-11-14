import type { Monitor } from "@/contracts/monitor.ts";
import type { Rect } from "@/overlays/shapes.ts";

export interface DisplayAreaEntry {
  readonly id: bigint;
  // The whole display in physical pixels, as Windows places it: a display left of or above the
  // primary has a negative origin
  readonly outerBounds: Rect;
}

// The id Windows gives the display `monitor` describes, found by where it sits and how big it is
// (the one thing both lists measure the same way, in physical pixels on a per-monitor DPI aware
// process), or undefined when no display has those bounds: it was unplugged or changed since
export function displayIdOf({ monitor, areas }: { monitor: Monitor; areas: readonly DisplayAreaEntry[] }) {
  const match = areas.find(({ outerBounds }) => {
    const isSameOrigin = outerBounds.x === monitor.x && outerBounds.y === monitor.y;
    const isSameSize = outerBounds.width === monitor.width && outerBounds.height === monitor.height;
    return isSameOrigin && isSameSize;
  });
  return match?.id;
}
