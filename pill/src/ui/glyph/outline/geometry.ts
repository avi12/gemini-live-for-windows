// Material Symbols path data as polygons. The spec draws its icons on a 960-unit grid,
// `viewBox="0 -960 960 960"`, so y runs from -960 at the top to 0 at the bottom.

export type Point = readonly [number, number];
export type Outline = Point[];

export const ICON_GRID = 960;

// The point `progress` of the way from `from` to `to`
export function pointBetween({ from, to, progress }: { from: Point; to: Point; progress: number }) {
  const point: Point = [from[0] + (to[0] - from[0]) * progress, from[1] + (to[1] - from[1]) * progress];
  return point;
}

// Positive for one winding, negative for the other: the nonzero fill draws an outline that runs the
// other way round from the one around it as a hole
export function signedArea(outline: Outline) {
  let twice = 0;
  for (const [index, [x, y]] of outline.entries()) {
    const [nextX, nextY] = outline[(index + 1) % outline.length] ?? [x, y];
    twice += x * nextY - nextX * y;
  }

  return twice / 2;
}
