import type { Region } from "@/contracts/monitor.ts";
import type { PixelRect, PixelSize } from "@/media/screen/capture-geometry.ts";
import { clipToSurface } from "@/media/screen/capture-geometry.ts";

// Under a few pixels tall the engine misses text, so a tiny crop is enlarged until its short edge is this
export const MIN_OCR_EDGE = 40;

export interface OcrWord {
  readonly text: string;
  readonly bounds: PixelRect;
}

export interface OcrLine {
  readonly words: readonly OcrWord[];
}

// The part of the image to read, and how much to scale it first: shrunk to the engine's largest image,
// or enlarged (never past that) so the short edge reaches the minimum
export function planScan({
  image,
  region,
  maxDimension
}: {
  image: PixelSize;
  region: Region | undefined;
  maxDimension: number;
}) {
  const area = clipToSurface({
    region: region ?? {
      x: 0,
      y: 0,
      ...image
    },
    size: image
  });
  const isAreaMissing = area === undefined;
  if (isAreaMissing) {
    return undefined;
  }

  const longEdge = Math.max(area.width, area.height);
  const shortEdge = Math.min(area.width, area.height);
  const shrink = Math.min(1, maxDimension / longEdge);
  const enlarge = shortEdge * shrink < MIN_OCR_EDGE ? Math.min(MIN_OCR_EDGE / shortEdge, maxDimension / longEdge) : 1;
  const scale = shrink < 1 ? shrink : enlarge;
  return {
    area,
    scale,
    size: {
      width: Math.max(1, Math.round(area.width * scale)),
      height: Math.max(1, Math.round(area.height * scale))
    }
  };
}

// A box the engine reported in the scanned (cropped, scaled) image, back in the source image's pixels
export function toSourceBounds({
  bounds,
  origin,
  scale
}: {
  bounds: PixelRect;
  origin: {
    x: number;
    y: number;
  };
  scale: number;
}) {
  return {
    x: origin.x + bounds.x / scale,
    y: origin.y + bounds.y / scale,
    width: bounds.width / scale,
    height: bounds.height / scale
  };
}

function topOf(line: OcrLine) {
  return Math.min(...line.words.map(word => word.bounds.y));
}

// Top to bottom. Words stay in the order Windows returns them, so a right-to-left line (Hebrew) lists
// its words right to left, each still carrying its own box.
export function sortLines(lines: readonly OcrLine[]) {
  return lines.filter(line => line.words.length > 0).toSorted((first, second) => topOf(first) - topOf(second));
}

// The user's own languages first, then every installed recognizer language, so a Hebrew or English
// screen is read whichever the profile lacks. Each tag once.
export function engineTagOrder({
  profileTag,
  installedTags
}: {
  profileTag: string | undefined;
  installedTags: readonly string[];
}) {
  const tags = profileTag === undefined ? [] : [profileTag];
  for (const tag of installedTags) {
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags;
}

export class NoOcrLanguageError extends Error {
  constructor() {
    super("No OCR language is installed: add one in Settings > Time & language > Language & region");
    this.name = "NoOcrLanguageError";
  }
}

export function lineText(line: OcrLine) {
  return line.words.map(word => word.text).join(" ");
}
