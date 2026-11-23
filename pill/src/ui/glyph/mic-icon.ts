import { clipToRegion } from "./outline/clip-outlines.ts";
import type { HalfPlane } from "./outline/clip-outlines.ts";
import { ICON_GRID, signedArea } from "./outline/geometry.ts";
import type { Outline, Point } from "./outline/geometry.ts";
import { parseOutlines } from "./outline/parse-outlines.ts";
import { pathDataOf } from "./outline/path-data.ts";

// Material Symbols Rounded `mic` turning into `mic_off` the way Material's own animated mic does: the
// slash draws in from the top left, and right behind its tip the mic is cut away where `mic_off` has
// its gaps. Each frame is computed, not stored: the mic is clipped against the moving cut, and the
// slash is a round-ended bar as long as the progress.

// `mic`, as the spec draws it (viewBox="0 -960 960 960"): the capsule, the stand, the capsule's hole
const MIC =
  "M395-435q-35-35-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35q-50 0-85-35Zm85-205Zm-40 480v-83q-92-13-157.5-78T203-479q-2-17 9-29t28-12q17 0 28.5 11.5T284-480q14 70 69.5 115T480-320q72 0 127-45.5T676-480q4-17 15.5-28.5T720-520q17 0 28 12t9 29q-14 91-79 157t-158 79v83q0 17-11.5 28.5T480-120q-17 0-28.5-11.5T440-160Zm68.5-331.5Q520-503 520-520v-240q0-17-11.5-28.5T480-800q-17 0-28.5 11.5T440-760v240q0 17 11.5 28.5T480-480q17 0 28.5-11.5Z";

// `mic_off`'s slash: a bar of round ends between these centres, as wide as twice the radius
const SLASH_START: Point = [112, -792];
const SLASH_END: Point = [792, -112];
const SLASH_RADIUS = 39.6;
const SLASH_LENGTH = Math.hypot(SLASH_END[0] - SLASH_START[0], SLASH_END[1] - SLASH_START[1]);
// How far from the slash's middle line, on its upper right side, `mic_off` ends what it keeps: the
// capsule only beyond its arch, the stand from the slash's edge to where its cut-off end starts
const CAPSULE_KEPT_FROM = 131.6;
const STAND_GAP_TO = 116;
// The slash's round start grows over the first part of the way, so nothing shows at rest
const DOT_GROWTH = 8;
const CAP_STEPS = 10;

const [capsule = [], stand = [], hole = []] = parseOutlines(MIC);
const body = [capsule, hole];
const IS_CLOCKWISE = signedArea(capsule) > 0;

const ALONG: Point = [Math.SQRT1_2, Math.SQRT1_2];
const ACROSS: Point = [Math.SQRT1_2, -Math.SQRT1_2];

// Points whose distance across the slash's middle line (towards its upper right) is at least `distance`,
// or at most it when `isBelow`
function across({ distance, isBelow }: { distance: number; isBelow: boolean }) {
  const sign = isBelow ? -1 : 1;
  const offset = -(ACROSS[0] * SLASH_START[0] + ACROSS[1] * SLASH_START[1]) - distance;
  return {
    weightX: sign * ACROSS[0],
    weightY: sign * ACROSS[1],
    offset: sign * offset
  } satisfies HalfPlane;
}

// Points at least `distance` along the slash from its start
function along(distance: number) {
  return {
    weightX: ALONG[0],
    weightY: ALONG[1],
    offset: -(ALONG[0] * SLASH_START[0] + ALONG[1] * SLASH_START[1]) - distance
  } satisfies HalfPlane;
}

// What is left of `outlines` once the band across the slash between `from` and `to` is cut away up to
// `reach` along it: the parts on either side of the band, and the band's part the cut has not reached
function cutBand({
  outlines,
  from,
  to,
  reach
}: {
  outlines: readonly Outline[];
  from: number;
  to: number;
  reach: number;
}) {
  return [
    ...clipToRegion({
      outlines,
      region: [
        across({
          distance: from,
          isBelow: true
        })
      ]
    }),
    ...clipToRegion({
      outlines,
      region: [
        across({
          distance: to,
          isBelow: false
        })
      ]
    }),
    ...clipToRegion({
      outlines,
      region: [
        across({
          distance: from,
          isBelow: false
        }),
        across({
          distance: to,
          isBelow: true
        }),
        along(reach)
      ]
    })
  ];
}

function slashUpTo(reach: number) {
  const radius = SLASH_RADIUS * Math.min(1, (reach / SLASH_LENGTH) * DOT_GROWTH);
  const tip: Point = [SLASH_START[0] + ALONG[0] * reach, SLASH_START[1] + ALONG[1] * reach];
  const angle = Math.atan2(ALONG[1], ALONG[0]);
  function cap({ centre, from }: { centre: Point; from: number }) {
    return Array.from({ length: CAP_STEPS + 1 }, (_, step) => {
      const turn = from + (Math.PI * step) / CAP_STEPS;
      const point: Point = [centre[0] + radius * Math.cos(turn), centre[1] + radius * Math.sin(turn)];
      return point;
    });
  }

  // Round the tip's end, then back round the start's
  const outline: Outline = [
    ...cap({
      centre: tip,
      from: angle - Math.PI / 2
    }),
    ...cap({
      centre: SLASH_START,
      from: angle + Math.PI / 2
    })
  ];
  const isSameWay = signedArea(outline) > 0 === IS_CLOCKWISE;
  return isSameWay ? outline : outline.reverse();
}

/**
 * `mic` (progress 0) through to `mic_off` (1), as path data in pixels.
 *
 * @param options - How far the slash has drawn in, and the icon's size in pixels.
 * @returns Path data, filled by the nonzero rule.
 */
export function micPathData({ progress, size }: { progress: number; size: number }) {
  const isAtRest = progress <= 0;
  if (isAtRest) {
    return pathDataOf({
      outlines: [...body, stand],
      size
    });
  }

  // The cut runs a round end's length ahead of the slash's middle line end, as far as the bar reaches
  const reach = SLASH_LENGTH * Math.min(1, progress);
  const cutReach = reach + SLASH_RADIUS;
  return pathDataOf({
    outlines: [
      ...cutBand({
        outlines: body,
        from: -ICON_GRID,
        to: CAPSULE_KEPT_FROM,
        reach: cutReach
      }),
      ...cutBand({
        outlines: [stand],
        from: SLASH_RADIUS,
        to: STAND_GAP_TO,
        reach: cutReach
      }),
      slashUpTo(reach)
    ],
    size
  });
}
