import type { Monitor, Region } from "@/contracts/monitor.ts";

// How much detail a frame keeps. `light` is enough for the API engine, which bills each 768-pixel tile
// of a frame; `sharp` is for Gemini's web client, which misreads small text in a downscaled, compressed
// picture; `frozen` is the still Circle to Search shows and crops, kept at full resolution.
export const ScreenDetail = {
  light: "light",
  sharp: "sharp",
  frozen: "frozen"
} as const;
export type ScreenDetail = typeof ScreenDetail[keyof typeof ScreenDetail];

export const DETAIL_SETTINGS = {
  [ScreenDetail.light]: {
    maxEdge: 1280,
    quality: 0.7
  },
  [ScreenDetail.sharp]: {
    maxEdge: 2200,
    quality: 0.85
  },
  [ScreenDetail.frozen]: {
    maxEdge: Number.POSITIVE_INFINITY,
    quality: 0.92
  }
} as const;

export interface PixelSize {
  width: number;
  height: number;
}

export interface PixelRect extends PixelSize {
  x: number;
  y: number;
}

// Never upscales; each edge keeps at least one pixel
export function fitToEdge({ size, maxEdge }: {
  size: PixelSize;
  maxEdge: number;
}) {
  const scale = Math.min(1, maxEdge / Math.max(size.width, size.height));
  return {
    width: Math.max(1, Math.trunc(size.width * scale)),
    height: Math.max(1, Math.trunc(size.height * scale))
  };
}

// The part of `region` that lies inside a surface of `size`, or undefined when none of it does
export function clipToSurface({ region, size }: {
  region: Region;
  size: PixelSize;
}) {
  const left = Math.max(0, region.x);
  const top = Math.max(0, region.y);
  const right = Math.min(size.width, region.x + region.width);
  const bottom = Math.min(size.height, region.y + region.height);
  const isRightAtMostLeftOrBottomAtMostTop = right <= left || bottom <= top;
  if (isRightAtMostLeftOrBottomAtMostTop) {
    return undefined;
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

// What to copy from the virtual screen, in physical pixels: the whole display, or `region` of it
// (in the display's own pixels), clipped to the display
export function screenArea({ monitor, region }: {
  monitor: Monitor;
  region: Region | undefined;
}) {
  const clipped = region === undefined
    ? {
      x: 0,
      y: 0,
      width: monitor.width,
      height: monitor.height
    }
    : clipToSurface({
      region,
      size: monitor
    });
  const isClippedMissing = clipped === undefined;
  if (isClippedMissing) {
    return undefined;
  }

  return {
    x: monitor.x + clipped.x,
    y: monitor.y + clipped.y,
    width: clipped.width,
    height: clipped.height
  };
}
