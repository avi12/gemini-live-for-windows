// The fold button's two icons, Material Symbols Outlined `close_fullscreen` (shown while the pill is
// open, to fold it) and `open_in_full` (shown on the orb, to unfold it), on the 960-unit grid of the
// spec's 24 px icons. Each is two arrows. `open_in_full` is one outline in the spec, cut here into its
// two arrows at the middle of the shaft, so that both icons have two outlines of nine points each and a
// point of one has a partner in the other: the morph moves every point to its partner.
//
// Each outline runs: corner of the arrow's bracket, end of its first arm, the arm's inner point, where
// the shaft joins that arm, the shaft's two end points, where the shaft joins the other arm, that
// arm's inner point, end of that arm.

import { ICON_GRID } from "./outline/geometry.ts";
import type { Point } from "./outline/geometry.ts";

// Points run down the screen here, from 0 at the top, unlike the spec's path data
type Outline = readonly Point[];

export const CLOSE_FULLSCREEN: readonly Outline[] = [
  [
    [480, 480],
    [480, 800],
    [400, 800],
    [400, 616],
    [136, 880],
    [80, 824],
    [344, 560],
    [160, 560],
    [160, 480]
  ],
  [
    [480, 480],
    [480, 160],
    [560, 160],
    [560, 344],
    [824, 80],
    [880, 136],
    [616, 400],
    [800, 400],
    [800, 480]
  ]
];

// Each arrow of one icon is, within a few units, the other's arrow turned half round about its own
// middle: so the morph turns each arrow half round while it moves the last few units, and every point's
// partner is the one the half turn brings it to. Straight-line moves alone would pass every arrow
// through a flat line halfway.
export const OPEN_IN_FULL: readonly Outline[] = [
  [
    [120, 840],
    [120, 520],
    [200, 520],
    [200, 704],
    [452, 452],
    [508, 508],
    [256, 760],
    [440, 760],
    [440, 840]
  ],
  [
    [840, 120],
    [840, 440],
    [760, 440],
    [760, 256],
    [508, 508],
    [452, 452],
    [704, 200],
    [520, 200],
    [520, 120]
  ]
];

function middleOf(outline: Outline) {
  const pointsX = outline.map(([x]) => x);
  const pointsY = outline.map(([, y]) => y);
  return {
    x: (Math.min(...pointsX) + Math.max(...pointsX)) / 2,
    y: (Math.min(...pointsY) + Math.max(...pointsY)) / 2
  };
}

// `point` turned by `angle` (radians, clockwise on screen) about `middle`
function turned({
  point: [x, y],
  middle,
  angle
}: {
  point: Point;
  middle: {
    x: number;
    y: number;
  };
  angle: number;
}) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const deltaX = x - middle.x;
  const deltaY = y - middle.y;
  return [middle.x + deltaX * cos - deltaY * sin, middle.y + deltaX * sin + deltaY * cos] as const;
}

/**
 * The icon part-way between the two, as path data in pixels.
 *
 * @param options - How far from `close_fullscreen` (0) to `open_in_full` (1), and the icon's size in pixels.
 * @returns Path data for the interpolated outlines.
 */
export function foldPathData({ progress, size }: { progress: number; size: number }) {
  const unit = size / ICON_GRID;

  return CLOSE_FULLSCREEN.map((outline, outlineIndex) => {
    const middle = middleOf(outline);
    const points = outline.map((point, pointIndex) => {
      const [toX, toY] = OPEN_IN_FULL[outlineIndex]?.[pointIndex] ?? point;
      // Where the whole half turn alone takes the point, and what is left from there to its partner
      const [endX, endY] = turned({
        point,
        middle,
        angle: Math.PI
      });
      const [x, y] = turned({
        point,
        middle,
        angle: Math.PI * progress
      });
      const shownX = x + (toX - endX) * progress;
      const shownY = y + (toY - endY) * progress;
      return `${(shownX * unit).toFixed(2)},${(shownY * unit).toFixed(2)}`;
    });
    return `M${points.join(" L")} Z`;
  }).join(" ");
}
