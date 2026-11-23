// Material Symbols path data as polygons and back. The spec draws its icons on a 960-unit grid,
// `viewBox="0 -960 960 960"`, so y runs from -960 at the top to 0 at the bottom.

export type Point = readonly [number, number];
export type Outline = Point[];

export const ICON_GRID = 960;

const CURVE_STEPS = 8;
// Below this area (grid units squared) an outline is the spec's empty bookkeeping move, not a shape
const MIN_AREA = 1;
const COMMAND = /[a-z]/i;
const TOKEN = /[a-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

export function lerp({ from, to, progress }: { from: Point; to: Point; progress: number }) {
  const point: Point = [from[0] + (to[0] - from[0]) * progress, from[1] + (to[1] - from[1]) * progress];
  return point;
}

export function signedArea(outline: Outline) {
  let twice = 0;
  for (const [i, [x, y]] of outline.entries()) {
    const [nextX, nextY] = outline[(i + 1) % outline.length] ?? [x, y];
    twice += x * nextY - nextX * y;
  }

  return twice / 2;
}

function quadratic({ from, control, to, outline }: { from: Point; control: Point; to: Point; outline: Outline }) {
  for (let step = 1; step <= CURVE_STEPS; step += 1) {
    const progress = step / CURVE_STEPS;
    const towardControl = lerp({
      from,
      to: control,
      progress
    });
    const fromControl = lerp({
      from: control,
      to,
      progress
    });
    outline.push(
      lerp({
        from: towardControl,
        to: fromControl,
        progress
      })
    );
  }
}

function mirrored({ at, control }: { at: Point; control: Point | undefined }) {
  if (control === undefined) {
    return at;
  }

  const reflected: Point = [2 * at[0] - control[0], 2 * at[1] - control[1]];
  return reflected;
}

/**
 * The path's outlines as polygons, curves flattened. Covers the commands Material Symbols use: moves,
 * lines and quadratic curves, absolute and relative.
 *
 * @param data - Path data on the spec's grid.
 * @returns One polygon per closed outline, empty ones left out.
 */
export function parseOutlines(data: string) {
  const tokens = data.match(TOKEN) ?? [];
  const outlines: Outline[] = [];
  let outline: Outline = [];
  // Where the pen stands: the current point
  let pen: Point = [0, 0];
  let start: Point = [0, 0];
  let lastControl: Point | undefined;
  let command = "";
  let index = 0;

  function next() {
    const value = Number(tokens[index]);
    index += 1;
    return value;
  }

  function pointAfter(isRelative: boolean) {
    const x = next();
    const y = next();
    const point: Point = isRelative ? [pen[0] + x, pen[1] + y] : [x, y];
    return point;
  }

  function close() {
    if (outline.length > 0) {
      outlines.push(outline);
    }

    outline = [];
  }

  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (COMMAND.test(token)) {
      command = token;
      index += 1;
    }

    const isRelative = command === command.toLowerCase();
    const kind = command.toUpperCase();
    let control: Point | undefined;
    switch (kind) {
      case "M":
        close();
        pen = pointAfter(isRelative);
        start = pen;
        outline.push(pen);
        // Pairs after a move are lines
        command = isRelative ? "l" : "L";
        break;
      case "L":
        pen = pointAfter(isRelative);
        outline.push(pen);
        break;
      case "H": {
        const x = next();
        pen = [isRelative ? pen[0] + x : x, pen[1]];
        outline.push(pen);
        break;
      }
      case "V": {
        const y = next();
        pen = [pen[0], isRelative ? pen[1] + y : y];
        outline.push(pen);
        break;
      }
      case "Q":
      case "T": {
        control =
          kind === "Q"
            ? pointAfter(isRelative)
            : mirrored({
                at: pen,
                control: lastControl
              });
        const to = pointAfter(isRelative);
        quadratic({
          from: pen,
          control,
          to,
          outline
        });
        pen = to;
        break;
      }
      case "Z":
        close();
        pen = start;
        break;
      default:
        throw new Error(`path command ${command} is not supported`);
    }

    // A smooth curve mirrors the control point of the curve right before it
    lastControl = control;
  }

  close();
  return outlines.filter(shape => Math.abs(signedArea(shape)) >= MIN_AREA);
}

/**
 * Path data in pixels for outlines on the spec's grid, filled by the nonzero rule (the `F1`), as the
 * spec's own fonts are: an outline running the other way round is a hole.
 *
 * @param options - The outlines, and the icon's size in pixels.
 * @returns Path data.
 */
export function pathDataOf({ outlines, size }: { outlines: readonly Outline[]; size: number }) {
  const unit = size / ICON_GRID;
  const figures = outlines
    .filter(outline => outline.length > 2)
    .map(outline => {
      const points = outline.map(([x, y]) => `${(x * unit).toFixed(2)},${((y + ICON_GRID) * unit).toFixed(2)}`);
      return `M${points.join(" L")} Z`;
    });
  return `F1 ${figures.join(" ")}`;
}

// A half-plane, the points where `a·x + b·y + c >= 0`
export interface HalfPlane {
  a: number;
  b: number;
  c: number;
}

function sideOf({ point: [x, y], plane }: { point: Point; plane: HalfPlane }) {
  return plane.a * x + plane.b * y + plane.c;
}

// The outline's part inside one half-plane (Sutherland-Hodgman); the winding is kept, so holes stay holes
function clipToPlane({ outline, plane }: { outline: Outline; plane: HalfPlane }) {
  const kept: Outline = [];
  for (const [i, point] of outline.entries()) {
    const previous = outline.at(i - 1) ?? point;
    const side = sideOf({
      point,
      plane
    });
    const previousSide = sideOf({
      point: previous,
      plane
    });
    const isCrossing = side >= 0 !== previousSide >= 0;
    if (isCrossing) {
      kept.push(
        lerp({
          from: previous,
          to: point,
          progress: previousSide / (previousSide - side)
        })
      );
    }

    if (side >= 0) {
      kept.push(point);
    }
  }

  return kept;
}

/**
 * The outlines' part inside a convex region, the meet of the given half-planes.
 *
 * @param options - The outlines, and the half-planes that bound the region.
 * @returns The clipped outlines; each keeps its winding.
 */
export function clipToRegion({ outlines, region }: { outlines: readonly Outline[]; region: readonly HalfPlane[] }) {
  return outlines.map(outline => {
    let clipped = outline;
    for (const plane of region) {
      clipped = clipToPlane({
        outline: clipped,
        plane
      });
    }

    return clipped;
  });
}
