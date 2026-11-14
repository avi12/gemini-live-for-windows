import {
  argHandle,
  argI32,
  combineRgn,
  createRectRgn,
  createRoundRectRgn,
  deleteObject,
  setWindowRegion
} from "@/win32/index.ts";

const RGN_DIFF = 4;
const ROUND_DIAMETER_FACTOR = 2;

export interface FrameRegion {
  hwnd: bigint;
  // The window's size in physical pixels
  width: number;
  height: number;
  // The frame's thickness in physical pixels
  thickness: number;
  // Corner radius of the frame's outside in physical pixels; 0 is square
  radius: number;
}

function rectangleOf({
  left,
  top,
  right,
  bottom,
  radius
}: {
  left: number;
  top: number;
  right: number;
  bottom: number;
  radius: number;
}) {
  const isSquare = radius <= 0;
  if (isSquare) {
    return createRectRgn([argI32(left), argI32(top), argI32(right), argI32(bottom)]).address;
  }

  const diameter = radius * ROUND_DIAMETER_FACTOR;
  return createRoundRectRgn([
    argI32(left),
    argI32(top),
    argI32(right),
    argI32(bottom),
    argI32(diameter),
    argI32(diameter)
  ]).address;
}

/** Clips the window to nothing: it stays where it is, shown, with no pixel of it on the display. */
export function cutEmptyRegion(hwnd: bigint) {
  setWindowRegion({
    hwnd,
    region: createRectRgn([argI32(0), argI32(0), argI32(0), argI32(0)]).address
  });
}

/**
 * Cuts the window down to a frame: its outer rectangle minus the inside. The frame is drawn opaque and
 * the middle is not part of the window at all, so nothing there has to be transparent (a transparent
 * window can show a white surface instead) and a click in the middle reaches what lies beneath.
 */
export function cutFrameRegion({ hwnd, width, height, thickness, radius }: FrameRegion) {
  const outer = rectangleOf({
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    radius
  });
  const inner = rectangleOf({
    left: thickness,
    top: thickness,
    right: width - thickness,
    bottom: height - thickness,
    radius: Math.max(radius - thickness, 0)
  });
  combineRgn([argHandle(outer), argHandle(outer), argHandle(inner), argI32(RGN_DIFF)]);
  deleteObject([argHandle(inner)]);
  setWindowRegion({
    hwnd,
    region: outer
  });
}
