import type { OcrLine } from "@/overlays/ports.ts";
import {
  addPoints,
  boundsOf,
  distanceBetween,
  inflateRect,
  intersectRects,
  rectBottom,
  rectContains,
  rectCorners,
  rectFromPoints,
  rectOfSize,
  rectRight,
  rectsTouch,
  subtractPoints
} from "@/overlays/shapes.ts";
import type { Point, Rect, Size, Vector } from "@/overlays/shapes.ts";

// Circle to Search's pure geometry, in the overlay's DIPs: how a loop becomes a selection, how a
// corner or the whole selection follows the pointer, the brackets' shape, where the action bar
// goes, and how the selection maps onto the frozen still's pixels. Ported from CircleGeometry.cs.

export const BarSide = {
  below: "below",
  right: "right",
  left: "left",
  above: "above",
  inside: "inside"
} as const;
type BarSide = typeof BarSide[keyof typeof BarSide];

export interface CornerGrip {
  readonly anchor: Point;
  // Plus or minus one per axis: which way from the anchor the grabbed corner lies
  readonly direction: Vector;
}

export interface TextWord {
  readonly text: string;
  readonly bounds: Rect;
  // The word's line, counted from the top
  readonly line: number;
}

// A pointer this close to a word still counts as on it, so the gaps in a line don't drop a drag
const WORD_SLOP = 3;
// A loop's bounding box grows by this, so the loop's own line doesn't clip what it circled
const SELECTION_PADDING = 16;
// A stroke narrower or shorter than this was a click or a slip, not a circle
const MIN_STROKE = 10;
const MIN_SELECTION = 20;
// How close to a corner a press grabs it for resizing
const CORNER_REACH = 28;
// The cutout and the brackets share this radius, so the brackets hug the clear hole exactly
const SELECTION_RADIUS = 24;
const BRACKET_ARM = 44;
// The action bar sits this far off the selection, and never closer than the margin to the edge
const BAR_GAP = 12;
const BAR_SCREEN_MARGIN = 16;

const PATH_DECIMALS = 3;

function formatNumber(value: number) {
  return Number(value.toFixed(PATH_DECIMALS));
}

function formatPoint(point: Point) {
  return `${formatNumber(point.x)},${formatNumber(point.y)}`;
}

function bracketArm(area: Rect) {
  return Math.min(BRACKET_ARM, Math.min(area.width, area.height) / 2);
}

export function cornerRadius(area: Rect) {
  return Math.min(SELECTION_RADIUS, bracketArm(area));
}

// The selection a finished loop makes: its padded bounding box, kept on the screen; undefined
// when the loop was too small to be a circle
export function loopSelection({ loop, screen }: {
  loop: Iterable<Point>;
  screen: Size;
}) {
  const drawn = boundsOf(loop);
  const isLoopEmpty = drawn === undefined;
  if (isLoopEmpty) {
    return undefined;
  }

  const isTooSmall = drawn.width < MIN_STROKE || drawn.height < MIN_STROKE;
  if (isTooSmall) {
    return undefined;
  }

  return intersectRects({
    first: inflateRect({
      rect: drawn,
      amount: SELECTION_PADDING
    }),
    second: rectOfSize(screen)
  });
}

// The selection dragged so `grip` (where in it the drag took hold) sits under `pointer`, its size
// unchanged and never past the screen's edge
export function moved({ selection, grip, pointer, screen }: {
  selection: Rect;
  grip: Vector;
  pointer: Point;
  screen: Size;
}) {
  const target = subtractPoints({
    first: pointer,
    second: grip
  });
  const farthestX = Math.max(0, screen.width - selection.width);
  const farthestY = Math.max(0, screen.height - selection.height);
  return {
    x: Math.min(Math.max(target.x, 0), farthestX),
    y: Math.min(Math.max(target.y, 0), farthestY),
    width: selection.width,
    height: selection.height
  };
}

// The corner of the selection within reach of the point, if any
export function nearestCorner({ selection, point }: {
  selection: Rect;
  point: Point;
}) {
  let nearest: Point | undefined;
  let nearestDistance = Infinity;
  for (const corner of rectCorners(selection)) {
    const distance = distanceBetween({
      first: corner,
      second: point
    });
    const isNearer = distance < nearestDistance;
    if (isNearer) {
      nearest = corner;
      nearestDistance = distance;
    }
  }

  const isInReach = nearestDistance <= CORNER_REACH;
  if (!isInReach) {
    return undefined;
  }

  return nearest;
}

// Whether the corner resizes along the falling diagonal (top-left and bottom-right) rather than
// the rising one, for the cursor to match
export function isFallingCorner({ selection, corner }: {
  selection: Rect;
  corner: Point;
}) {
  const isLeft = corner.x === selection.x;
  const isTop = corner.y === selection.y;
  return isLeft === isTop;
}

export function grabCorner({ selection, corner }: {
  selection: Rect;
  corner: Point;
}) {
  const anchor = {
    x: selection.x + rectRight(selection) - corner.x,
    y: selection.y + rectBottom(selection) - corner.y
  };
  return {
    anchor,
    direction: {
      x: Math.sign(corner.x - anchor.x),
      y: Math.sign(corner.y - anchor.y)
    }
  };
}

// Where the grabbed edge lands on one axis: at least the minimum size away from the anchor on its
// own side, and on screen
function reach({ anchor, pointer, direction, limit }: {
  anchor: number;
  pointer: number;
  direction: number;
  limit: number;
}) {
  const extent = Math.max(MIN_SELECTION, (pointer - anchor) * direction);
  return Math.min(Math.max(anchor + extent * direction, 0), limit);
}

// The selection with the grabbed corner at the pointer, never past the minimum size and never off
// the screen
export function followCorner({ grip, pointer, screen }: {
  grip: CornerGrip;
  pointer: Point;
  screen: Size;
}) {
  const left = reach({
    anchor: grip.anchor.x,
    pointer: pointer.x,
    direction: grip.direction.x,
    limit: screen.width
  });
  const top = reach({
    anchor: grip.anchor.y,
    pointer: pointer.y,
    direction: grip.direction.y,
    limit: screen.height
  });
  return rectFromPoints({
    first: grip.anchor,
    second: {
      x: left,
      y: top
    }
  });
}

// The two edge directions each corner's bracket runs along, in rectCorners' order
const BRACKET_DIRECTIONS = [
  {
    across: {
      x: 1,
      y: 0
    },
    down: {
      x: 0,
      y: 1
    }
  },
  {
    across: {
      x: -1,
      y: 0
    },
    down: {
      x: 0,
      y: 1
    }
  },
  {
    across: {
      x: -1,
      y: 0
    },
    down: {
      x: 0,
      y: -1
    }
  },
  {
    across: {
      x: 1,
      y: 0
    },
    down: {
      x: 0,
      y: -1
    }
  }
] as const;

function offsetAlong({ corner, direction, distance }: {
  corner: Point;
  direction: Point;
  distance: number;
}) {
  return addPoints({
    first: corner,
    second: {
      x: direction.x * distance,
      y: direction.y * distance
    }
  });
}

function bracketFigure({ corner, across, down, arm, radius }: {
  corner: Point;
  across: Point;
  down: Point;
  arm: number;
  radius: number;
}) {
  // Turning from "across" to "down" bends one way at two corners and the other way at two; the
  // sign of their cross product says which, in screen (y down) coordinates. 0 is
  // counterclockwise, 1 is clockwise.
  const cross = across.x * down.y - across.y * down.x;
  const sweep = cross > 0 ? 0 : 1;
  const start = offsetAlong({
    corner,
    direction: across,
    distance: arm
  });
  const bendIn = offsetAlong({
    corner,
    direction: across,
    distance: radius
  });
  const bendOut = offsetAlong({
    corner,
    direction: down,
    distance: radius
  });
  const end = offsetAlong({
    corner,
    direction: down,
    distance: arm
  });
  const radiusText = formatNumber(radius);
  return `M${formatPoint(start)} L${formatPoint(bendIn)} A${radiusText},${radiusText} 0 0 ${sweep} ${formatPoint(bendOut)} L${formatPoint(end)}`;
}

// A rounded L at each corner of the area as SVG/XAML path data: along one edge, round the corner
// on the cutout's own radius, and down the other
export function brackets(area: Rect) {
  const arm = bracketArm(area);
  const radius = cornerRadius(area);
  const [topLeft, topRight, bottomRight, bottomLeft] = rectCorners(area);
  const [topLeftWay, topRightWay, bottomRightWay, bottomLeftWay] = BRACKET_DIRECTIONS;
  const placed = [
    {
      corner: topLeft,
      ...topLeftWay
    },
    {
      corner: topRight,
      ...topRightWay
    },
    {
      corner: bottomRight,
      ...bottomRightWay
    },
    {
      corner: bottomLeft,
      ...bottomLeftWay
    }
  ];
  const figures = placed.map(({ corner, across, down }) => bracketFigure({
    corner,
    across,
    down,
    arm,
    radius
  }));
  return figures.join(" ");
}

// The cutout as XAML path data: the whole screen with the selection (rounded) cut out of it,
// even-odd, so the selection always stays clear. Without a selection, just the screen
export function scrimPath({ screen, selection }: {
  screen: Size;
  selection: Rect | undefined;
}) {
  const full = `M0,0 H${formatNumber(screen.width)} V${formatNumber(screen.height)} H0 Z`;
  const isBarePath = selection === undefined;
  if (isBarePath) {
    return `F0 ${full}`;
  }

  const radius = cornerRadius(selection);
  const left = selection.x;
  const top = selection.y;
  const right = rectRight(selection);
  const bottom = rectBottom(selection);
  const arc = `A${formatNumber(radius)},${formatNumber(radius)} 0 0 1`;
  const hole = [
    `M${formatNumber(left + radius)},${formatNumber(top)}`,
    `H${formatNumber(right - radius)}`,
    `${arc} ${formatNumber(right)},${formatNumber(top + radius)}`,
    `V${formatNumber(bottom - radius)}`,
    `${arc} ${formatNumber(right - radius)},${formatNumber(bottom)}`,
    `H${formatNumber(left + radius)}`,
    `${arc} ${formatNumber(left)},${formatNumber(bottom - radius)}`,
    `V${formatNumber(top + radius)}`,
    `${arc} ${formatNumber(left + radius)},${formatNumber(top)}`,
    "Z"
  ].join(" ");
  return `F0 ${full} ${hole}`;
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

// The selection in the still's physical pixels, kept inside the still. The window spans the
// monitor in DIPs and the still in pixels, so their ratio is the monitor's DPI scale
export function pixelRegion({ selection, window, still }: {
  selection: Rect;
  window: Size;
  still: Size;
}) {
  const scaleX = still.width / window.width;
  const scaleY = still.height / window.height;
  const left = Math.floor(selection.x * scaleX);
  const top = Math.floor(selection.y * scaleY);
  const right = Math.ceil(rectRight(selection) * scaleX);
  const bottom = Math.ceil(rectBottom(selection) * scaleY);
  return intersectRects({
    first: {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    },
    second: rectOfSize(still)
  });
}

// Every word in reading order (line by line), mapped from the still's pixels to the window's DIPs:
// the inverse of pixelRegion's scale
export function textWords({ lines, still, window }: {
  lines: readonly OcrLine[];
  still: Size;
  window: Size;
}) {
  const scaleX = window.width / still.width;
  const scaleY = window.height / still.height;
  const words: TextWord[] = [];
  for (const [iLine, line] of lines.entries()) {
    for (const word of line.words) {
      words.push({
        text: word.text,
        bounds: {
          x: word.bounds.x * scaleX,
          y: word.bounds.y * scaleY,
          width: word.bounds.width * scaleX,
          height: word.bounds.height * scaleY
        },
        line: iLine
      });
    }
  }

  return words;
}

// The index of the word under the point, or -1 when it is over none
export function wordAt({ words, point }: {
  words: readonly TextWord[];
  point: Point;
}) {
  for (const [iWord, word] of words.entries()) {
    const isOnWord = rectContains({
      rect: inflateRect({
        rect: word.bounds,
        amount: WORD_SLOP
      }),
      point
    });
    if (isOnWord) {
      return iWord;
    }
  }

  return -1;
}

// The words from `first` to `second` inclusive, whichever comes first in reading order: what
// dragging from one word to another selects
export function wordsBetween({ first, second }: {
  first: number;
  second: number;
}) {
  const start = Math.min(first, second);
  const count = Math.abs(second - first) + 1;
  return Array.from({ length: count }, (_, offset) => start + offset);
}

// Every word touching the area: what a rubber band selects
export function wordsIn({ words, area }: {
  words: readonly TextWord[];
  area: Rect;
}) {
  const indexes: number[] = [];
  for (const [iWord, word] of words.entries()) {
    const isTouched = rectsTouch({
      first: word.bounds,
      second: area
    });
    if (isTouched) {
      indexes.push(iWord);
    }
  }

  return indexes;
}

// All the words on the same line as the word at `index`
export function wordsOnLine({ words, index }: {
  words: readonly TextWord[];
  index: number;
}) {
  const line = words[index]?.line;
  const indexes: number[] = [];
  for (const [iWord, word] of words.entries()) {
    const isOnLine = word.line === line;
    if (isOnLine) {
      indexes.push(iWord);
    }
  }

  return indexes;
}

// The picked words as text: spaces between words, a newline wherever the line changes. The words
// are already in reading order, right-to-left lines included
export function joinWords({ words, picked }: {
  words: readonly TextWord[];
  picked: readonly number[];
}) {
  const textByLine = new Map<number, string[]>();
  for (const index of picked) {
    const word = words[index];
    const isMissing = word === undefined;
    if (isMissing) {
      continue;
    }

    const lineWords = textByLine.get(word.line) ?? [];
    lineWords.push(word.text);
    textByLine.set(word.line, lineWords);
  }

  return [...textByLine.values()].map(lineWords => lineWords.join(" ")).join("\n");
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
