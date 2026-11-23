const NEWTON_STEPS = 8;
const BISECT_STEPS = 24;
const SLOPE_FLOOR = 1e-6;
const SOLVE_TOLERANCE = 1e-5;
const CUBIC_FACTOR = 3;

interface Axis {
  readonly first: number;
  readonly second: number;
}

function polynomialOf(axis: Axis) {
  const linear = CUBIC_FACTOR * axis.first;
  const quadratic = CUBIC_FACTOR * (axis.second - axis.first) - linear;
  const cubic = 1 - linear - quadratic;
  return {
    linear,
    quadratic,
    cubic
  };
}

function coordinateOf({ progress, axis }: { progress: number; axis: Axis }) {
  const { linear, quadratic, cubic } = polynomialOf(axis);
  return ((cubic * progress + quadratic) * progress + linear) * progress;
}

function slopeOf({ progress, axis }: { progress: number; axis: Axis }) {
  const { linear, quadratic, cubic } = polynomialOf(axis);
  return (CUBIC_FACTOR * cubic * progress + 2 * quadratic) * progress + linear;
}

function bisect({ time, axis }: { time: number; axis: Axis }) {
  let low = 0;
  let high = 1;
  let progress = time;
  for (let iStep = 0; iStep < BISECT_STEPS; iStep++) {
    const error =
      coordinateOf({
        progress,
        axis
      }) - time;
    const isSolved = Math.abs(error) < SOLVE_TOLERANCE;
    if (isSolved) {
      return progress;
    }

    const isTooHigh = error > 0;
    if (isTooHigh) {
      high = progress;
    } else {
      low = progress;
    }

    progress = (low + high) / 2;
  }

  return progress;
}

function curveProgressOf({ time, axis }: { time: number; axis: Axis }) {
  let progress = time;
  for (let iStep = 0; iStep < NEWTON_STEPS; iStep++) {
    const slope = slopeOf({
      progress,
      axis
    });
    const isFlat = Math.abs(slope) < SLOPE_FLOOR;
    if (isFlat) {
      return bisect({
        time,
        axis
      });
    }

    const error =
      coordinateOf({
        progress,
        axis
      }) - time;
    progress -= error / slope;
  }

  return progress;
}

// CSS's cubic-bezier(x1, y1, x2, y2) as an easing function. WinUI ignores a cubic-bezier in a
// stylesheet, so these curves run through Svelte's transitions instead.
function cubicBezier({ horizontal, vertical }: { horizontal: Axis; vertical: Axis }) {
  return (time: number) => {
    const isEdge = time <= 0 || time >= 1;
    if (isEdge) {
      return time;
    }

    const progress = curveProgressOf({
      time,
      axis: horizontal
    });
    return coordinateOf({
      progress,
      axis: vertical
    });
  };
}

// A curve's control points as CSS, to hand the same curve to the platform's own animations
function cssOf({ horizontal, vertical }: { horizontal: Axis; vertical: Axis }) {
  return `cubic-bezier(${horizontal.first}, ${vertical.first}, ${horizontal.second}, ${vertical.second})`;
}

const EMPHASIZED_DECELERATE_CURVE = {
  horizontal: {
    first: 0.05,
    second: 0.1
  },
  vertical: {
    first: 0.7,
    second: 1
  }
} as const;

export const emphasizedDecelerate = cubicBezier(EMPHASIZED_DECELERATE_CURVE);

export const emphasizedAccelerate = cubicBezier({
  horizontal: {
    first: 0.3,
    second: 0.8
  },
  vertical: {
    first: 0,
    second: 0.15
  }
});

// CSS's own `ease-out`, kept as its control points so the same curve can be handed to the platform
// (as CSS) and worked out here (to know where a running glide is)
const EASE_OUT_CURVE = {
  horizontal: {
    first: 0,
    second: 0.58
  },
  vertical: {
    first: 0,
    second: 1
  }
} as const;

export const easeOut = cubicBezier(EASE_OUT_CURVE);
export const EASE_OUT_CSS = cssOf(EASE_OUT_CURVE);
