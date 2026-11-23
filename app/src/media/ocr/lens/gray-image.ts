import { Bgra } from "@/media/bgra.ts";

// The Rec. 601 luma weights: how bright each channel looks to the eye
const BLUE_WEIGHT = 0.114;
const GREEN_WEIGHT = 0.587;
const RED_WEIGHT = 0.299;

export interface GrayImage {
  readonly gray: Uint8Array;
  readonly width: number;
  readonly height: number;
}

// The luminance of each pixel of a BGRA picture
export function toGray({ bgra, width, height }: { bgra: Uint8Array; width: number; height: number }) {
  const gray = new Uint8Array(width * height);
  for (let iPixel = 0; iPixel < gray.length; iPixel++) {
    const offset = iPixel * Bgra.BYTES_PER_PIXEL;
    gray[iPixel] = Math.round(
      (bgra[offset + Bgra.BLUE_OFFSET] ?? 0) * BLUE_WEIGHT +
        (bgra[offset + Bgra.GREEN_OFFSET] ?? 0) * GREEN_WEIGHT +
        (bgra[offset + Bgra.RED_OFFSET] ?? 0) * RED_WEIGHT
    );
  }
  return {
    gray,
    width,
    height
  } satisfies GrayImage;
}
