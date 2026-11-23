import { Bgra } from "@/media/bgra.ts";
import { argHandle, argI32, argU32, bindFunction, Win32Type } from "@/win32/bind.ts";
import { createCompatibleDC, deleteDC, getDC, releaseDC } from "@/win32/gdi.ts";

import type { PixelRect, PixelSize } from "./capture-geometry.ts";
import { createSurface, releaseSurface, type Surface } from "./dib-surface.ts";

const SRCCOPY = 0x00cc0020;
const CAPTUREBLT = 0x40000000;
const HALFTONE = 4;
const NO_HANDLE = 0n;

const setStretchBltMode = bindFunction({
  library: "gdi32.dll",
  entryPoint: "SetStretchBltMode",
  parameters: [Win32Type.HANDLE, Win32Type.I32],
  returns: Win32Type.I32
});

const stretchBlt = bindFunction({
  library: "gdi32.dll",
  entryPoint: "StretchBlt",
  parameters: [
    Win32Type.HANDLE,
    Win32Type.I32,
    Win32Type.I32,
    Win32Type.I32,
    Win32Type.I32,
    Win32Type.HANDLE,
    Win32Type.I32,
    Win32Type.I32,
    Win32Type.I32,
    Win32Type.I32,
    Win32Type.U32
  ],
  returns: Win32Type.BOOL32
});

const bitBlt = bindFunction({
  library: "gdi32.dll",
  entryPoint: "BitBlt",
  parameters: [
    Win32Type.HANDLE,
    Win32Type.I32,
    Win32Type.I32,
    Win32Type.I32,
    Win32Type.I32,
    Win32Type.HANDLE,
    Win32Type.I32,
    Win32Type.I32,
    Win32Type.U32
  ],
  returns: Win32Type.BOOL32
});

// A 32-bit top-down BGRA copy of part of the screen. `address` points into a buffer that the next
// capture overwrites: finish with it (or copy it out) first.
export interface CapturedPixels {
  readonly width: number;
  readonly height: number;
  readonly address: bigint;
  readonly byteLength: number;
}

function openMemoryDC() {
  const screen = getDC([argHandle(null)]).address;
  const memoryDC = createCompatibleDC([argHandle(screen)]).address;
  releaseDC([argHandle(null), argHandle(screen)]);
  return memoryDC;
}

function copy({
  memoryDC,
  screen,
  area,
  size
}: {
  memoryDC: bigint;
  screen: bigint;
  area: PixelRect;
  size: PixelSize;
}) {
  const isScaled = size.width !== area.width || size.height !== area.height;
  if (!isScaled) {
    return (
      bitBlt([
        argHandle(memoryDC),
        argI32(0),
        argI32(0),
        argI32(size.width),
        argI32(size.height),
        argHandle(screen),
        argI32(area.x),
        argI32(area.y),
        argU32(SRCCOPY | CAPTUREBLT)
      ]).number !== 0
    );
  }

  setStretchBltMode([argHandle(memoryDC), argI32(HALFTONE)]);
  return (
    stretchBlt([
      argHandle(memoryDC),
      argI32(0),
      argI32(0),
      argI32(size.width),
      argI32(size.height),
      argHandle(screen),
      argI32(area.x),
      argI32(area.y),
      argI32(area.width),
      argI32(area.height),
      argU32(SRCCOPY | CAPTUREBLT)
    ]).number !== 0
  );
}

function copyScreen({ memoryDC, area, size }: { memoryDC: bigint; area: PixelRect; size: PixelSize }) {
  const screen = getDC([argHandle(null)]).address;
  try {
    const isCopied = copy({
      memoryDC,
      screen,
      area,
      size
    });
    if (!isCopied) {
      throw new Error("The screen could not be copied (BitBlt failed)");
    }
  } finally {
    releaseDC([argHandle(null), argHandle(screen)]);
  }
}

interface GdiState {
  memoryDC: bigint;
  surface: Surface | undefined;
}

function releaseHeld(state: GdiState) {
  const held = state.surface;
  state.surface = undefined;
  const isNothingHeld = held === undefined;
  if (isNothingHeld) {
    return;
  }

  releaseSurface({
    memoryDC: state.memoryDC,
    held
  });
}

function ensureSurface({ state, width, height }: PixelSize & { state: GdiState }) {
  const hasMemoryDC = state.memoryDC !== NO_HANDLE;
  if (!hasMemoryDC) {
    state.memoryDC = openMemoryDC();
  }

  const current = state.surface;
  const isSizeKept = current?.width === width && current.height === height;
  if (isSizeKept) {
    return current;
  }

  releaseHeld(state);
  const created = createSurface({
    memoryDC: state.memoryDC,
    width,
    height
  });
  state.surface = created;
  return created;
}

function disposeGdi(state: GdiState) {
  releaseHeld(state);
  const hasMemoryDC = state.memoryDC !== NO_HANDLE;
  if (hasMemoryDC) {
    deleteDC([argHandle(state.memoryDC)]);
    state.memoryDC = NO_HANDLE;
  }
}

// BitBlt of the screen with CAPTUREBLT (so layered windows show up) into one DIB section that is reused
// while the size stays the same: a 4K grab is 33 MB, and one a second must not churn that. The process
// must be per-monitor DPI aware first, or the rectangle and the pixels are virtualised.
export function createGdiCapturer() {
  const state: GdiState = {
    memoryDC: NO_HANDLE,
    surface: undefined
  };

  return {
    // `area` is in virtual-screen pixels; the result is `size` pixels, shrunk by the GDI half-tone filter
    // when that is smaller. Shrinking here keeps the buffer, and everything after it, small
    capture({ area, size }: { area: PixelRect; size: PixelSize }) {
      const target = ensureSurface({
        state,
        ...size
      });
      copyScreen({
        memoryDC: state.memoryDC,
        area,
        size
      });
      return {
        ...size,
        address: target.address,
        byteLength: size.width * size.height * Bgra.BYTES_PER_PIXEL
      };
    },
    dispose: () => disposeGdi(state)
  };
}
