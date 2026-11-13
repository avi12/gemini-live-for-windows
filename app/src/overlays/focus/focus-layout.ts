import type { Monitor, Region } from "@/contracts/monitor.ts";
import { moved } from "@/overlays/circle/gesture/geometry.ts";
import { inflateRect } from "@/overlays/shapes.ts";
import type { Point } from "@/overlays/shapes.ts";

// Around a circled region the frame sits just outside it, so it never covers what Gemini sees
export const REGION_FRAME_GAP = 4;

// Physical pixels between the focus chip and the region's frame
export const CHIP_GAP = 10;

// Where the share border's window goes, in physical screen pixels: exactly the display, or the
// circled region (of that display's pixels) inflated by the gap
export function borderBounds({ monitor, region }: { monitor: Monitor; region: Region | null }) {
  const isWholeDisplay = region === null;
  if (isWholeDisplay) {
    return {
      x: monitor.x,
      y: monitor.y,
      width: monitor.width,
      height: monitor.height
    };
  }

  return inflateRect({
    rect: {
      x: monitor.x + region.x,
      y: monitor.y + region.y,
      width: region.width,
      height: region.height
    },
    amount: REGION_FRAME_GAP
  });
}

// The chip's top-left corner, in physical screen pixels: just above the region's frame, or below
// it when the region touches the top of the display
export function chipOrigin({ monitor, region, chipHeight }: { monitor: Monitor; region: Region; chipHeight: number }) {
  const above = region.y - CHIP_GAP - chipHeight;
  const isRoomAbove = above >= 0;
  const top = isRoomAbove ? above : region.y + region.height + CHIP_GAP;
  return {
    x: monitor.x + region.x,
    y: monitor.y + top
  };
}

// The watched region moved with the chip by how far the pointer has travelled, never off the
// display. Gemini follows live, as the engine reads the region on every frame
export function regionAfterDrag({ start, travelled, monitor }: { start: Region; travelled: Point; monitor: Monitor }) {
  const origin = moved({
    selection: start,
    grip: {
      x: 0,
      y: 0
    },
    pointer: {
      x: start.x + travelled.x,
      y: start.y + travelled.y
    },
    screen: monitor
  });
  return {
    x: Math.trunc(origin.x),
    y: Math.trunc(origin.y),
    width: start.width,
    height: start.height
  };
}
