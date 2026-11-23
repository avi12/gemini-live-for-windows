import type { PillRegion } from "@gemini-live/protocol/view";

import { argI32 } from "@/win32/bind.ts";
import { createRectRgn } from "@/win32/gdi.ts";
import { setWindowRegion } from "@/win32/user32.ts";

// SetWindowRgn's "no region": the whole window again
const WHOLE_WINDOW = 0n;

// Shows only `region` of the pill's window, and takes clicks only there; null shows all of it. A
// rectangle, not the orb's circle: a region has hard pixel edges, which would cut the orb's soft edge.
export function clipWindow({ hwnd, region }: { hwnd: bigint; region: PillRegion | null }) {
  if (region === null) {
    setWindowRegion({
      hwnd,
      region: WHOLE_WINDOW
    });
    return;
  }

  const { x, y, width, height } = region;
  setWindowRegion({
    hwnd,
    region: createRectRgn([argI32(x), argI32(y), argI32(x + width), argI32(y + height)]).address
  });
}
