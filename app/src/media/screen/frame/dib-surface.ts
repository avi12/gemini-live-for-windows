import { argHandle, argPointer, argU32 } from "@/win32/bind.ts";
import { createDIBSection, deleteObject, selectObject } from "@/win32/gdi.ts";
import { Win32Bytes, withMemory } from "@/win32/memory.ts";

const NO_HANDLE = 0n;
const BI_RGB = 0;
const DIB_RGB_COLORS = 0;
const BITS_PER_PIXEL = 32;
const PLANES = 1;
const BITMAP_INFO_HEADER_BYTES = 40;
const HEADER_WIDTH_OFFSET = 4;
const HEADER_HEIGHT_OFFSET = 8;
const HEADER_PLANES_OFFSET = 12;
const HEADER_BIT_COUNT_OFFSET = 14;
const HEADER_COMPRESSION_OFFSET = 16;

// A 32-bit top-down DIB section selected into a memory DC: GDI draws into it and `address` is
// where its pixels sit
export interface Surface {
  width: number;
  height: number;
  bitmap: bigint;
  previous: bigint;
  address: bigint;
}

export function createSurface({ memoryDC, width, height }: { memoryDC: bigint; width: number; height: number }) {
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
        size: Win32Bytes.POINTER,
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

export function releaseSurface({ memoryDC, held }: { memoryDC: bigint; held: Surface }) {
  selectObject([argHandle(memoryDC), argHandle(held.previous)]);
  deleteObject([argHandle(held.bitmap)]);
}
