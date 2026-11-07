// The motion half of the overlays' design (Design/Motion.cs and CubicBezierEase.cs): Material 3's
// durations and easing curves, and the moves every overlay surface is built from.

export const OverlayMotion = {
  enterMilliseconds: 400,
  exitMilliseconds: 260,
  standardMilliseconds: 200,
  travelMilliseconds: 350,
  // Material 3 Expressive's spatial spring overshoots by this much and settles
  springOvershoot: 0.15
} as const;

interface BezierPoints {
  readonly firstControlX: number;
  readonly firstControlY: number;
  readonly secondControlX: number;
  readonly secondControlY: number;
}

// The weights of a cubic Bezier curve and of its slope
const CUBIC_WEIGHT = 3;
const SLOPE_WEIGHT = 6;
const NEWTON_STEPS = 8;
const NEWTON_TOLERANCE = 1e-6;
const BISECT_STEPS = 24;

function coordinate({ first, second, t }: {
  first: number;
  second: number;
  t: number;
}) {
  const inverse = 1 - t;
  return CUBIC_WEIGHT * inverse * inverse * t * first + CUBIC_WEIGHT * inverse * t * t * second + t * t * t;
}

function slope({ first, second, t }: {
  first: number;
  second: number;
  t: number;
}) {
  const inverse = 1 - t;
  return CUBIC_WEIGHT * inverse * inverse * first
    + SLOPE_WEIGHT * inverse * t * (second - first)
    + CUBIC_WEIGHT * t * t * (1 - second);
}

function newtonSolve({ x, first, second }: {
  x: number;
  first: number;
  second: number;
}) {
  let t = x;
  for (let iStep = 0; iStep < NEWTON_STEPS; iStep += 1) {
    const error = coordinate({
      first,
      second,
      t
    }) - x;
    const isSolved = Math.abs(error) < NEWTON_TOLERANCE;
    if (isSolved) {
      return t;
    }

    const derivative = slope({
      first,
      second,
      t
    });
    const isFlat = derivative === 0;
    if (isFlat) {
      return undefined;
    }

    t -= error / derivative;
  }

  return undefined;
}

function bisectSolve({ x, first, second }: {
  x: number;
  first: number;
  second: number;
}) {
  let low = 0;
  let high = 1;
  let t = x;
  for (let iStep = 0; iStep < BISECT_STEPS; iStep += 1) {
    const isBelow = coordinate({
      first,
      second,
      t
    }) < x;
    if (isBelow) {
      low = t;
    } else {
      high = t;
    }

    t = (low + high) / 2;
  }

  return t;
}

// A CSS cubic-bezier easing from its two control points: progress in, eased progress out
export function cubicBezier({ firstControlX, firstControlY, secondControlX, secondControlY }: BezierPoints) {
  function solveT(x: number) {
    const options = {
      x,
      first: firstControlX,
      second: secondControlX
    };
    return newtonSolve(options) ?? bisectSolve(options);
  }

  return (progress: number) => {
    const isBefore = progress <= 0;
    if (isBefore) {
      return 0;
    }

    const isAfter = progress >= 1;
    if (isAfter) {
      return 1;
    }

    return coordinate({
      first: firstControlY,
      second: secondControlY,
      t: solveT(progress)
    });
  };
}

// For things entering: fast start, long gentle settle
export const emphasizedDecelerate = cubicBezier({
  firstControlX: 0.05,
  firstControlY: 0.7,
  secondControlX: 0.1,
  secondControlY: 1
});

// For state changes on something that stays
export const standardEase = cubicBezier({
  firstControlX: 0.2,
  firstControlY: 0,
  secondControlX: 0,
  secondControlY: 1
});

// Even progress, for a fade that must stay visible for its whole run
export const linearEase = cubicBezier({
  firstControlX: 0,
  firstControlY: 0,
  secondControlX: 1,
  secondControlY: 1
});

// Overshoots a little and settles, for something that travels to a new spot (WPF's BackEase,
// EaseOut, amplitude 0.15)
export function springEase(progress: number) {
  const inverse = 1 - progress;
  return 1 - (inverse * inverse * inverse - OverlayMotion.springOvershoot * inverse * Math.sin(inverse * Math.PI));
}
