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

// Two lines count as the same text when the smaller one lies mostly inside the other
const SAME_LINE_OVERLAP = 0.5;

function boxOf(line: OcrLine) {
  const left = Math.min(...line.words.map(word => word.bounds.x));
  const top = Math.min(...line.words.map(word => word.bounds.y));
  const right = Math.max(...line.words.map(word => word.bounds.x + word.bounds.width));
  const bottom = Math.max(...line.words.map(word => word.bounds.y + word.bounds.height));
  return {
    left,
    top,
    right,
    bottom
  };
}

function isSameLine({ first, second }: { first: OcrLine; second: OcrLine }) {
  const one = boxOf(first);
  const other = boxOf(second);
  const overlapWidth = Math.min(one.right, other.right) - Math.max(one.left, other.left);
  const overlapHeight = Math.min(one.bottom, other.bottom) - Math.max(one.top, other.top);
  const isApart = overlapWidth <= 0 || overlapHeight <= 0;
  if (isApart) {
    return false;
  }

  const smaller = Math.min(
    (one.right - one.left) * (one.bottom - one.top),
    (other.right - other.left) * (other.bottom - other.top)
  );
  return (overlapWidth * overlapHeight) / smaller >= SAME_LINE_OVERLAP;
}

function characterCount(line: OcrLine) {
  return lineText(line).replaceAll(/\s/gu, "").length;
}

// The lines of several recognizers read the same picture, each in its own language: a page that
// mixes scripts gets every language's lines. Where two recognizers read the same place, the one that
// found more characters wins (a wrong-language reading finds few or none); on a tie the earlier pass
// (the user's own language) stays.
export function mergeLines(passes: readonly (readonly OcrLine[])[]) {
  const kept: OcrLine[] = [];
  for (const pass of passes) {
    for (const found of pass) {
      const iSame = kept.findIndex(line =>
        isSameLine({
          first: line,
          second: found
        })
      );
      const same = kept[iSame];
      if (same === undefined) {
        kept.push(found);
      } else if (characterCount(found) > characterCount(same)) {
        kept[iSame] = found;
      }
    }
  }

  return sortLines(kept);
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
