import type { PixelRect } from "@/media/screen/capture-geometry.ts";

import { columnSpread, SPACE_SHARE } from "./column-ink.ts";
import type { GrayImage } from "./gray-image.ts";

// What the recogniser takes: one grayscale strip, this big
export const STRIP_HEIGHT = 32;
export const STRIP_WIDTH = 168;
// A piece of a line may be squeezed to fit the strip by up to this much and still be read
const MAX_SQUEEZE = 1;
const TARGET_SQUEEZE = 0.9;
// The cut between two pieces is searched for this share of a piece around where it would fall
const CUT_SEARCH_SHARE = 0.45;
// Columns this much more varied than the quietest still count as part of a gap
const QUIET_MARGIN = 12;

interface Strip {
  readonly pixels: Uint8Array;
  // The piece of the picture it shows, and how wide of the strip is the piece (the rest is padding)
  readonly source: PixelRect;
  readonly contentWidth: number;
}

function backgroundOf({ image, area }: { image: GrayImage; area: PixelRect }) {
  let total = 0;
  let count = 0;
  for (const y of [area.y, area.y + area.height - 1]) {
    for (let x = area.x; x < area.x + area.width; x++) {
      total += image.gray[y * image.width + x] ?? 0;
      count++;
    }
  }
  return Math.round(total / count);
}

function averageOf({
  image,
  fromX,
  toX,
  fromY,
  toY
}: {
  image: GrayImage;
  fromX: number;
  toX: number;
  fromY: number;
  toY: number;
}) {
  let total = 0;
  let count = 0;
  for (let sourceY = fromY; sourceY < toY; sourceY++) {
    for (let sourceX = fromX; sourceX < toX; sourceX++) {
      total += image.gray[sourceY * image.width + sourceX] ?? 0;
      count++;
    }
  }
  return Math.round(total / count);
}

// `area` of the picture averaged down (or stretched up) to `width` by the strip's height, in a strip
// padded to its full width with the area's background
function toStrip({ image, area }: { image: GrayImage; area: PixelRect }) {
  const stretch = STRIP_HEIGHT / area.height;
  const contentWidth = Math.max(1, Math.min(STRIP_WIDTH, Math.round(area.width * stretch)));
  const pixels = new Uint8Array(STRIP_WIDTH * STRIP_HEIGHT).fill(
    backgroundOf({
      image,
      area
    })
  );
  const stepX = area.width / contentWidth;
  const stepY = area.height / STRIP_HEIGHT;
  for (let y = 0; y < STRIP_HEIGHT; y++) {
    for (let x = 0; x < contentWidth; x++) {
      const fromX = area.x + Math.floor(x * stepX);
      const toX = Math.max(fromX + 1, area.x + Math.floor((x + 1) * stepX));
      const fromY = area.y + Math.floor(y * stepY);
      const toY = Math.max(fromY + 1, area.y + Math.floor((y + 1) * stepY));
      pixels[y * STRIP_WIDTH + x] = averageOf({
        image,
        fromX,
        toX,
        fromY,
        toY
      });
    }
  }
  return {
    pixels,
    source: area,
    contentWidth
  } satisfies Strip;
}

// The column near `target` whose pixels vary the least, so the cut falls in a gap between letters
function quietestColumn({
  image,
  line,
  target,
  reach
}: {
  image: GrayImage;
  line: PixelRect;
  target: number;
  reach: number;
}) {
  const from = Math.max(line.x + 1, target - reach);
  const to = Math.min(line.x + line.width - 1, target + reach);
  const spreads: number[] = [];
  for (let x = from; x <= to; x++) {
    spreads.push(
      columnSpread({
        image,
        line,
        x
      })
    );
  }

  // The widest stretch of columns as quiet as the quietest one: a gap between words, cut in its middle
  const quiet = Math.min(...spreads) + QUIET_MARGIN;
  const spaceWidth = line.height * SPACE_SHARE;
  let best = target;
  let bestWidth = 0;
  let isBestSpace = false;
  let runStart = -1;
  for (let column = 0; column <= spreads.length; column++) {
    const isQuiet = (spreads[column] ?? Number.POSITIVE_INFINITY) <= quiet;
    const isRunStart = isQuiet && runStart < 0;
    if (isRunStart) {
      runStart = column;
    }

    const isRunOver = !isQuiet && runStart >= 0;
    if (isRunOver) {
      const width = column - runStart;
      const middle = from + runStart + Math.floor(width / 2);
      // A gap as wide as a space is a place between words, and the one nearest the target wins; the dots
      // and gaps inside a word or a number are only a fallback, widest first
      const isSpace = width >= spaceWidth;
      const isNearer = Math.abs(middle - target) < Math.abs(best - target);
      const isBetterOfKind = isSpace ? isNearer : width > bestWidth;
      const isBetter = isSpace === isBestSpace ? isBetterOfKind : isSpace;
      if (isBetter) {
        bestWidth = width;
        best = middle;
        isBestSpace = isSpace;
      }

      runStart = -1;
    }
  }
  return best;
}

// A line as strips the recogniser can take: one when it fits the strip (squeezed a little at most),
// else pieces cut at gaps, each squeezed no more than that
export function cutIntoStrips({ image, line }: { image: GrayImage; line: PixelRect }) {
  const fullWidth = (line.width * STRIP_HEIGHT) / line.height;
  const isOnePiece = fullWidth <= STRIP_WIDTH * MAX_SQUEEZE;
  if (isOnePiece) {
    return [
      toStrip({
        image,
        area: line
      })
    ];
  }

  const pieceCount = Math.ceil(fullWidth / (STRIP_WIDTH * TARGET_SQUEEZE));
  const pieceWidth = line.width / pieceCount;
  const cuts = [line.x];
  for (let iCut = 1; iCut < pieceCount; iCut++) {
    cuts.push(
      quietestColumn({
        image,
        line,
        target: Math.round(line.x + iCut * pieceWidth),
        reach: Math.round(pieceWidth * CUT_SEARCH_SHARE)
      })
    );
  }
  cuts.push(line.x + line.width);

  return cuts.slice(1).map((right, iPiece) =>
    toStrip({
      image,
      area: {
        x: cuts[iPiece] ?? line.x,
        y: line.y,
        width: right - (cuts[iPiece] ?? line.x),
        height: line.height
      }
    })
  );
}
