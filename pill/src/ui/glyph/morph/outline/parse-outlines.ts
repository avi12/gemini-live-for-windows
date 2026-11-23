import { pointBetween, signedArea } from "./geometry.ts";
import type { Outline, Point } from "./geometry.ts";

const CURVE_STEPS = 8;
// Below this area (grid units squared) an outline is the spec's empty bookkeeping move, not a shape
const MIN_AREA = 1;
const COMMAND = /[a-z]/i;
const TOKEN = /[a-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

function quadratic({ from, control, to, outline }: { from: Point; control: Point; to: Point; outline: Outline }) {
  for (let step = 1; step <= CURVE_STEPS; step += 1) {
    const progress = step / CURVE_STEPS;
    const towardControl = pointBetween({
      from,
      to: control,
      progress
    });
    const fromControl = pointBetween({
      from: control,
      to,
      progress
    });
    outline.push(
      pointBetween({
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
