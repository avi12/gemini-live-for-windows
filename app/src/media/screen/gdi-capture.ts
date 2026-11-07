import type { PixelRect, PixelSize } from "./capture-geometry.ts";
import {
  argHandle,
  argI32,
  argPointer,
  argU32,
  bindFunction,
  Win32Type,
  withMemory
} from "@/win32/bind.ts";
import {
  createCompatibleDC,
  createDIBSection,
  deleteDC,
  deleteObject,
  getDC,
  releaseDC,
  selectObject
} from "@/win32/gdi.ts";

const SRCCOPY = 0x00cc0020;
const CAPTUREBLT = 0x40000000;
const HALFTONE = 4;
const NO_HANDLE = 0n;
const BI_RGB = 0;
const DIB_RGB_COLORS = 0;
const BITS_PER_PIXEL = 32;
const BYTES_PER_PIXEL = 4;
const PLANES = 1;
const BITMAP_INFO_HEADER_BYTES = 40;
const POINTER_BYTES = 8;
const HEADER_WIDTH_OFFSET = 4;
const HEADER_HEIGHT_OFFSET = 8;
const HEADER_PLANES_OFFSET = 12;
const HEADER_BIT_COUNT_OFFSET = 14;
const HEADER_COMPRESSION_OFFSET = 16;

const setStretchBltMode = bindFunction({
  library: "gdi32.dll",
  entryPoint: "SetStretchBltMode",
  parameters: [Win32Type.handle, Win32Type.i32],
  returns: Win32Type.i32
});

const stretchBlt = bindFunction({
  library: "gdi32.dll",
  entryPoint: "StretchBlt",
  parameters: [
    Win32Type.handle,
    Win32Type.i32,
    Win32Type.i32,
    Win32Type.i32,
    Win32Type.i32,
    Win32Type.handle,
    Win32Type.i32,
    Win32Type.i32,
    Win32Type.i32,
    Win32Type.i32,
    Win32Type.u32
  ],
  returns: Win32Type.bool32
});

const bitBlt = bindFunction({
  library: "gdi32.dll",
  entryPoint: "BitBlt",
  parameters: [
    Win32Type.handle,
    Win32Type.i32,
    Win32Type.i32,
    Win32Type.i32,
    Win32Type.i32,
    Win32Type.handle,
    Win32Type.i32,
    Win32Type.i32,
    Win32Type.u32
  ],
  returns: Win32Type.bool32
});

// A 32-bit top-down BGRA copy of part of the screen. `address` points into a buffer that the next
// capture overwrites: finish with it (or copy it out) first.
export interface CapturedPixels {
  readonly width: number;
  readonly height: number;
  readonly address: bigint;
  readonly byteLength: number;
}

interface Surface {
  width: number;
  height: number;
  bitmap: bigint;
  previous: bigint;
  address: bigint;
}

function createSurface({ memoryDC, width, height }: {
  memoryDC: bigint;
  width: number;
  height: number;
}) {
  return withMemory({
    size: BITMAP_INFO_HEADER_BYTES,
    use(header) {
      header.writeU32(0, BITMAP_INFO_HEADER_BYTES);
      header.writeI32(HEADER_WIDTH_OFFSET, width);
      // A negative height is a top-down bitmap, the row order every consumer expects
      header.writeI32(HEADER_HEIGHT_OFFSET, -height);
      header.writeU16(HEADER_PLANES_OFFSET, PLANES);
      header.writeU16(HEADER_BIT_COUNT_OFFSET, BITS_PER_PIXEL);
      header.writeU32(HEADER_COMPRESSION_OFFSET, BI_RGB);
      return withMemory({
        size: POINTER_BYTES,
        use(bitsOut) {
          const bitmap = createDIBSection([
            argHandle(null),
            argPointer(header),
            argU32(DIB_RGB_COLORS),
            argPointer(bitsOut),
            argHandle(null),
            argU32(0)
          ]).address;
          const isAllocationFailed = bitmap === NO_HANDLE;
          if (isAllocationFailed) {
            throw new Error(`Could not allocate a ${width}x${height} capture bitmap`);
          }

          const previous = selectObject([argHandle(memoryDC), argHandle(bitmap)]).address;
          return {
            width,
            height,
            bitmap,
            previous,
            address: bitsOut.readU64(0)
          } satisfies Surface;
        }
      });
    }
  });
}

function openMemoryDC() {
  const screen = getDC([argHandle(null)]).address;
  const memoryDC = createCompatibleDC([argHandle(screen)]).address;
  releaseDC([argHandle(null), argHandle(screen)]);
  return memoryDC;
}

function releaseSurface({ memoryDC, held }: {
  memoryDC: bigint;
  held: Surface;
}) {
  selectObject([argHandle(memoryDC), argHandle(held.previous)]);
  deleteObject([argHandle(held.bitmap)]);
}

function copy({ memoryDC, screen, area, size }: {
  memoryDC: bigint;
  screen: bigint;
  area: PixelRect;
  size: PixelSize;
}) {
  const isScaled = size.width !== area.width || size.height !== area.height;
  if (!isScaled) {
    return bitBlt([
      argHandle(memoryDC),
      argI32(0),
      argI32(0),
      argI32(size.width),
      argI32(size.height),
      argHandle(screen),
      argI32(area.x),
      argI32(area.y),
      argU32(SRCCOPY | CAPTUREBLT)
    ]).number !== 0;
  }

  setStretchBltMode([argHandle(memoryDC), argI32(HALFTONE)]);
  return stretchBlt([
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
  ]).number !== 0;
}

function copyScreen({ memoryDC, area, size }: {
  memoryDC: bigint;
  area: PixelRect;
  size: PixelSize;
}) {
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
    capture({ area, size }: {
      area: PixelRect;
      size: PixelSize;
    }) {
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
        byteLength: size.width * size.height * BYTES_PER_PIXEL
      };
    },
    dispose: () => disposeGdi(state)
  };
}
