import type { Monitor } from "@/contracts/monitor.ts";
import { rectBottom, rectRight } from "@/overlays/shapes.ts";
import type { Point, Rect } from "@/overlays/shapes.ts";

// Which part of the region's frame the pointer holds: a side drags the whole region along, a
// corner pulls that corner and resizes the region
export const RegionGrip = {
  MOVE: "move",
  TOP_LEFT: "topLeft",
  TOP_RIGHT: "topRight",
  BOTTOM_RIGHT: "bottomRight",
  BOTTOM_LEFT: "bottomLeft"
} as const;
export type RegionGrip = (typeof RegionGrip)[keyof typeof RegionGrip];

// The cursor each grip shows: the CSS names the window understands
export const GRIP_CURSORS = {
  [RegionGrip.MOVE]: "move",
  [RegionGrip.TOP_LEFT]: "nwse-resize",
  [RegionGrip.BOTTOM_RIGHT]: "nwse-resize",
  [RegionGrip.TOP_RIGHT]: "nesw-resize",
  [RegionGrip.BOTTOM_LEFT]: "nesw-resize"
} as const satisfies Record<RegionGrip, string>;

// The smallest a region may be pulled to, in physical pixels
export const MIN_REGION_SIZE = 64;

// The part of a frame (its window, `size` in physical pixels) a point inside it holds: within
// `corner` of two sides at once is a corner, anywhere else on the frame is its side
export function gripAt({
  point,
  size,
  corner
}: {
  point: Point;
  size: {
    width: number;
    height: number;
  };
  corner: number;
}) {
  const isLeft = point.x < corner;
  const isRight = point.x >= size.width - corner;
  const isTop = point.y < corner;
  const isBottom = point.y >= size.height - corner;
  const isTopLeft = isTop && isLeft;
  if (isTopLeft) {
    return RegionGrip.TOP_LEFT;
  }

  const isTopRight = isTop && isRight;
  if (isTopRight) {
    return RegionGrip.TOP_RIGHT;
  }

  const isBottomRight = isBottom && isRight;
  if (isBottomRight) {
    return RegionGrip.BOTTOM_RIGHT;
  }

  const isBottomLeft = isBottom && isLeft;
  if (isBottomLeft) {
    return RegionGrip.BOTTOM_LEFT;
  }

  return RegionGrip.MOVE;
}

function clamp({ value, low, high }: { value: number; low: number; high: number }) {
  return Math.min(Math.max(value, low), high);
}

// The region after the pointer travelled `delta` from where it took hold of `grip`: moved whole, or
// with one corner pulled, never smaller than `MIN_REGION_SIZE` and never off `monitor`
export function dragRegion({
  start,
  grip,
  delta,
  monitor
}: {
  start: Rect;
  grip: RegionGrip;
  delta: Point;
  monitor: Pick<Monitor, "x" | "y" | "width" | "height">;
}) {
  const monitorRight = monitor.x + monitor.width;
  const monitorBottom = monitor.y + monitor.height;
  const isMove = grip === RegionGrip.MOVE;
  if (isMove) {
    return {
      x: clamp({
        value: start.x + delta.x,
        low: monitor.x,
        high: monitorRight - start.width
      }),
      y: clamp({
        value: start.y + delta.y,
        low: monitor.y,
        high: monitorBottom - start.height
      }),
      width: start.width,
      height: start.height
    };
  }

  const isLeftGrip = grip === RegionGrip.TOP_LEFT || grip === RegionGrip.BOTTOM_LEFT;
  const isTopGrip = grip === RegionGrip.TOP_LEFT || grip === RegionGrip.TOP_RIGHT;
  const fixedX = isLeftGrip ? rectRight(start) : start.x;
  const fixedY = isTopGrip ? rectBottom(start) : start.y;
  const movingX = clamp({
    value: (isLeftGrip ? start.x : rectRight(start)) + delta.x,
    low: monitor.x,
    high: monitorRight
  });
  const movingY = clamp({
    value: (isTopGrip ? start.y : rectBottom(start)) + delta.y,
    low: monitor.y,
    high: monitorBottom
  });
  const directionX = isLeftGrip ? -1 : 1;
  const directionY = isTopGrip ? -1 : 1;
  const width = Math.max((movingX - fixedX) * directionX, MIN_REGION_SIZE);
  const height = Math.max((movingY - fixedY) * directionY, MIN_REGION_SIZE);
  return {
    x: isLeftGrip ? fixedX - width : fixedX,
    y: isTopGrip ? fixedY - height : fixedY,
    width,
    height
  };
}
