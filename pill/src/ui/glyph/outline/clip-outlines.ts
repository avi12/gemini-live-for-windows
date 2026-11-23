import { pointBetween } from "./geometry.ts";
import type { Outline, Point } from "./geometry.ts";

// A half-plane, the points where `weightX·x + weightY·y + offset >= 0`
export interface HalfPlane {
  weightX: number;
  weightY: number;
  offset: number;
}

function sideOf({ point: [x, y], plane }: { point: Point; plane: HalfPlane }) {
  return plane.weightX * x + plane.weightY * y + plane.offset;
}

// The outline's part inside one half-plane (Sutherland-Hodgman); the winding is kept, so holes stay holes
function clipToPlane({ outline, plane }: { outline: Outline; plane: HalfPlane }) {
  const kept: Outline = [];
  for (const [index, point] of outline.entries()) {
    const previous = outline.at(index - 1) ?? point;
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
        pointBetween({
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
