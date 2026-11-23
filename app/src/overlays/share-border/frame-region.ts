import { argHandle, argI32, combineRgn, createRectRgn, deleteObject, setWindowRegion } from "@/win32/index.ts";

const RGN_DIFF = 4;

export interface FrameRegion {
  hwnd: bigint;
  // The window's size in physical pixels
  width: number;
  height: number;
  // The frame's thickness in physical pixels
  thickness: number;
}

function rectangleOf({ left, top, right, bottom }: { left: number; top: number; right: number; bottom: number }) {
  return createRectRgn([argI32(left), argI32(top), argI32(right), argI32(bottom)]).address;
}

/** Clips the window to nothing: it stays where it is, shown, with no pixel of it on the display. */
export function cutEmptyRegion(hwnd: bigint) {
  setWindowRegion({
    hwnd,
    region: rectangleOf({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0
    })
  });
}

/**
 * Cuts the window down to a frame: its outer rectangle minus the inside. The frame is drawn opaque and
 * the middle is not part of the window at all, so nothing there has to be transparent (a transparent
 * window can show a white surface instead) and a click in the middle reaches what lies beneath.
 */
export function cutFrameRegion({ hwnd, width, height, thickness }: FrameRegion) {
  const outer = rectangleOf({
    left: 0,
    top: 0,
    right: width,
    bottom: height
  });
  const inner = rectangleOf({
    left: thickness,
    top: thickness,
    right: width - thickness,
    bottom: height - thickness
  });
  combineRgn([argHandle(outer), argHandle(outer), argHandle(inner), argI32(RGN_DIFF)]);
  deleteObject([argHandle(inner)]);
  setWindowRegion({
    hwnd,
    region: outer
  });
}
