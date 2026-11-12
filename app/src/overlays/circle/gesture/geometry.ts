import { rectBottom, rectRight } from "@/overlays/shapes.ts";
import type { Rect, Size } from "@/overlays/shapes.ts";
import { DEFAULT_BRACKET_ARM, DEFAULT_SELECTION_RADIUS } from "winui-svelte/selection";

// Circle to Search's pure geometry, in the overlay's DIPs: where the action bar goes and the
// tint of the words. The selection itself (loop, move, resize, the mapping
// onto the still's pixels) is winui-svelte's. Ported from CircleGeometry.cs.

export const BarSide = {
  below: "below",
  right: "right",
  left: "left",
  above: "above",
  inside: "inside"
} as const;
type BarSide = typeof BarSide[keyof typeof BarSide];

// The action bar sits this far off the selection, and never closer than the margin to the edge
const BAR_GAP = 12;
const BAR_SCREEN_MARGIN = 16;

const PATH_DECIMALS = 3;

function formatNumber(value: number) {
  return Number(value.toFixed(PATH_DECIMALS));
}

// The corner the selection's flash rounds on: the cutout's own, as the library draws it
export function cornerRadius(area: Rect) {
  return Math.min(DEFAULT_SELECTION_RADIUS, DEFAULT_BRACKET_ARM, area.width / 2, area.height / 2);
}

function besidePlacement({ selection, bar, screen }: {
  selection: Rect;
  bar: Size;
  screen: Size;
}) {
  const centredY = selection.y + (selection.height - bar.height) / 2;
  const rightX = rectRight(selection) + BAR_GAP;
  const leftX = selection.x - BAR_GAP - bar.width;
  const isRoomRight = rightX + bar.width <= screen.width - BAR_SCREEN_MARGIN;
  const isRoomLeft = leftX >= BAR_SCREEN_MARGIN;
  const isInLeftHalf = selection.x + selection.width / 2 < screen.width / 2;
  const isRightChosen = isRoomRight && (isInLeftHalf || !isRoomLeft);
  if (isRightChosen) {
    return {
      side: BarSide.right,
      origin: {
        x: rightX,
        y: centredY
      }
    };
  }

  if (isRoomLeft) {
    return {
      side: BarSide.left,
      origin: {
        x: leftX,
        y: centredY
      }
    };
  }

  return undefined;
}

// The first spot barPlacement tries that has room, before clamping
function unclampedBarPlacement({ selection, bar, screen }: {
  selection: Rect;
  bar: Size;
  screen: Size;
}) {
  const centredX = selection.x + (selection.width - bar.width) / 2;
  const belowY = rectBottom(selection) + BAR_GAP;
  const isRoomBelow = belowY + bar.height <= screen.height - BAR_SCREEN_MARGIN;
  if (isRoomBelow) {
    return {
      side: BarSide.below,
      origin: {
        x: centredX,
        y: belowY
      }
    };
  }

  const beside = besidePlacement({
    selection,
    bar,
    screen
  });
  const isBeside = beside !== undefined;
  if (isBeside) {
    return beside;
  }

  const aboveY = selection.y - BAR_GAP - bar.height;
  const isRoomAbove = aboveY >= BAR_SCREEN_MARGIN;
  if (isRoomAbove) {
    return {
      side: BarSide.above,
      origin: {
        x: centredX,
        y: aboveY
      }
    };
  }

  return {
    side: BarSide.inside,
    origin: {
      x: centredX,
      y: rectBottom(selection) - BAR_GAP - bar.height
    }
  };
}

// Keeps a span of `length` starting at `start` inside the screen's margin on one axis; one too
// long to fit hugs the near margin
function onScreen({ start, length, limit }: {
  start: number;
  length: number;
  limit: number;
}) {
  const farthest = limit - BAR_SCREEN_MARGIN - length;
  return Math.max(BAR_SCREEN_MARGIN, Math.min(start, farthest));
}

// Where a bar-sized action bar goes for the selection, as its top-left corner. Tried in order:
// centred just below; beside it, vertically centred (on the right when the selection's centre is
// in the screen's left half, else on the left, then the other side); above it; and finally inside
// its bottom edge. Whatever wins is clamped fully on screen
export function barPlacement({ selection, bar, screen }: {
  selection: Rect;
  bar: Size;
  screen: Size;
}) {
  const { side, origin } = unclampedBarPlacement({
    selection,
    bar,
    screen
  });
  return {
    side,
    origin: {
      x: onScreen({
        start: origin.x,
        length: bar.width,
        limit: screen.width
      }),
      y: onScreen({
        start: origin.y,
        length: bar.height,
        limit: screen.height
      })
    }
  };
}

// The corner radius that keeps a word's tint from looking like a bare rectangle
export const WORD_RADIUS = 3;

// Rounded boxes for the rectangles as one path to fill: every word's tint is a single shape
export function roundedRectsPath({ rects, radius }: {
  rects: readonly Rect[];
  radius: number;
}) {
  const figures: string[] = [];
  for (const rect of rects) {
    const reach = Math.min(radius, rect.width / 2, rect.height / 2);
    const left = rect.x;
    const top = rect.y;
    const right = rectRight(rect);
    const bottom = rectBottom(rect);
    const arc = `A${formatNumber(reach)},${formatNumber(reach)} 0 0 1`;
    figures.push(
      [
        `M${formatNumber(left + reach)},${formatNumber(top)}`,
        `H${formatNumber(right - reach)}`,
        `${arc} ${formatNumber(right)},${formatNumber(top + reach)}`,
        `V${formatNumber(bottom - reach)}`,
        `${arc} ${formatNumber(right - reach)},${formatNumber(bottom)}`,
        `H${formatNumber(left + reach)}`,
        `${arc} ${formatNumber(left)},${formatNumber(bottom - reach)}`,
        `V${formatNumber(top + reach)}`,
        `${arc} ${formatNumber(left + reach)},${formatNumber(top)}`,
        "Z"
      ].join(" ")
    );
  }

  return `F1 ${figures.join(" ")}`;
}
