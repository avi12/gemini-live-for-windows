import type { PixelRect } from "@/media/screen/capture-geometry.ts";

import type { GrayImage } from "./line-finder.ts";

const MAX_GRAY = 255;
// A column of a line varying more than this holds part of a glyph
const INK_SPREAD = 40;
// A gap this share of a line's height wide is a space between words, not a gap inside one
export const SPACE_SHARE = 0.3;

// How much the pixels of column `x` of a line vary, brightest to darkest: a flat column is a gap
export function columnSpread({ image, line, x }: { image: GrayImage; line: PixelRect; x: number }) {
  let low = MAX_GRAY;
  let high = 0;
  for (let y = line.y; y < line.y + line.height; y++) {
    const value = image.gray[y * image.width + x] ?? 0;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return high - low;
}

// Walks from `start` toward `limit` while there is ink, across gaps narrower than `maxGap`, and returns
// the edge of the last ink it met: how far a glyph's run really reaches
export function inkEdge({
  image,
  line,
  start,
  limit,
  maxGap
}: {
  image: GrayImage;
  line: PixelRect;
  start: number;
  limit: number;
  maxGap: number;
}) {
  const step = limit >= start ? 1 : -1;
  let edge = start;
  let gap = 0;
  for (let x = start; x !== limit; x += step) {
    const isInk =
      columnSpread({
        image,
        line,
        x
      }) > INK_SPREAD;
    if (isInk) {
      edge = step > 0 ? x + 1 : x;
      gap = 0;
      continue;
    }

    gap++;

    if (gap >= maxGap) {
      break;
    }
  }
  return edge;
}

export interface WordSpan {
  left: number;
  right: number;
}

// Word spans (left to right, in the picture's pixels) widened to the ink around them. The recogniser
// marks a glyph where it is surest of it, near its middle, so a span from it is short of the word's
// edges; the picture knows where the glyphs really end. A span never reaches past halfway to its neighbour.
export function snapToInk({ image, line, spans }: { image: GrayImage; line: PixelRect; spans: readonly WordSpan[] }) {
  const maxGap = Math.max(1, Math.round(line.height * SPACE_SHARE));
  return spans.map((span, iSpan) => {
    const previous = spans[iSpan - 1];
    const next = spans[iSpan + 1];
    const lowest = previous === undefined ? line.x : Math.round((previous.right + span.left) / 2);
    const highest = next === undefined ? line.x + line.width : Math.round((span.right + next.left) / 2);
    return {
      left: Math.min(
        span.left,
        inkEdge({
          image,
          line,
          start: Math.max(lowest, Math.round(span.left)),
          limit: lowest,
          maxGap
        })
      ),
      right: Math.max(
        span.right,
        inkEdge({
          image,
          line,
          start: Math.min(highest, Math.round(span.right)),
          limit: highest,
          maxGap
        })
      )
    } satisfies WordSpan;
  });
}
