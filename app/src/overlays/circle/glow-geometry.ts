import type { Rect } from "@/overlays/shapes.ts";

// Google's four colours run round the selection's edge, one for each side, meeting at the corners
export const GlowSide = {
  TOP: "top",
  RIGHT: "right",
  BOTTOM: "bottom",
  LEFT: "left"
} as const;
export type GlowSide = (typeof GlowSide)[keyof typeof GlowSide];

// Google's four colours, and for each side the way its gradient runs (on the side's own box, from 0
// to 1). Going clockwise a side holds its own colour for most of its length, then turns into the next
// side's colour, so two neighbouring sides meet in the same colour and no other colour appears
const GOOGLE_BLUE = "#4285f4";
const GOOGLE_RED = "#ea4335";
const GOOGLE_YELLOW = "#fbbc04";
const GOOGLE_GREEN = "#34a853";
const HOLD_UNTIL = 0.6;

type GoogleColor = typeof GOOGLE_BLUE | typeof GOOGLE_RED | typeof GOOGLE_YELLOW | typeof GOOGLE_GREEN;

function gradientStops({ own, next }: { own: GoogleColor; next: GoogleColor }) {
  return [
    {
      color: own,
      offset: 0
    },
    {
      color: own,
      offset: HOLD_UNTIL
    },
    {
      color: next,
      offset: 1
    }
  ];
}

export const GLOW_GRADIENTS = {
  [GlowSide.TOP]: {
    start: {
      x: 0,
      y: 0.5
    },
    end: {
      x: 1,
      y: 0.5
    },
    stops: gradientStops({
      own: GOOGLE_RED,
      next: GOOGLE_YELLOW
    })
  },
  [GlowSide.RIGHT]: {
    start: {
      x: 0.5,
      y: 0
    },
    end: {
      x: 0.5,
      y: 1
    },
    stops: gradientStops({
      own: GOOGLE_YELLOW,
      next: GOOGLE_GREEN
    })
  },
  [GlowSide.BOTTOM]: {
    start: {
      x: 1,
      y: 0.5
    },
    end: {
      x: 0,
      y: 0.5
    },
    stops: gradientStops({
      own: GOOGLE_GREEN,
      next: GOOGLE_BLUE
    })
  },
  [GlowSide.LEFT]: {
    start: {
      x: 0.5,
      y: 1
    },
    end: {
      x: 0.5,
      y: 0
    },
    stops: gradientStops({
      own: GOOGLE_BLUE,
      next: GOOGLE_RED
    })
  }
};

const GLOW_REACH = 30;
const GLOW_STEPS = 12;
const GLOW_LAYER_OPACITY = 0.12;
export const GLOW_LAYERS = Array.from({ length: GLOW_STEPS }, (_unused, step) => ({
  width: Math.round(GLOW_REACH * (1 - step / GLOW_STEPS)),
  opacity: GLOW_LAYER_OPACITY
}));

// The corner brackets: thick white arcs on the four corners, with a short arm along each edge
const BRACKET_ARM = 12;

interface Point {
  x: number;
  y: number;
}

function pointText({ x, y }: Point) {
  return `${x},${y}`;
}

function arcTo({ radius, to }: { radius: number; to: Point }) {
  return `A ${radius},${radius} 0 0 1 ${pointText(to)}`;
}

// The path of each side of a rounded rectangle, from the middle of one corner's arc to the middle of
// the next, so that two sides meet in the middle of a corner and end there in the same colour
export function glowSidePaths({ rect, radius }: { rect: Rect; radius: number }) {
  const { x, y, width, height } = rect;
  const left = x;
  const top = y;
  const right = x + width;
  const bottom = y + height;
  function side({ from, to, through }: { from: Point; to: Point; through: readonly [Point, Point] }) {
    return [
      `M ${pointText(from)}`,
      arcTo({
        radius,
        to: through[0]
      }),
      `L ${pointText(through[1])}`,
      arcTo({
        radius,
        to
      })
    ].join(" ");
  }

  const reach = radius * (1 - Math.SQRT1_2);
  const topLeft = {
    x: left + reach,
    y: top + reach
  };
  const topRight = {
    x: right - reach,
    y: top + reach
  };
  const bottomRight = {
    x: right - reach,
    y: bottom - reach
  };
  const bottomLeft = {
    x: left + reach,
    y: bottom - reach
  };
  return {
    [GlowSide.TOP]: side({
      from: topLeft,
      through: [
        {
          x: left + radius,
          y: top
        },
        {
          x: right - radius,
          y: top
        }
      ],
      to: topRight
    }),
    [GlowSide.RIGHT]: side({
      from: topRight,
      through: [
        {
          x: right,
          y: top + radius
        },
        {
          x: right,
          y: bottom - radius
        }
      ],
      to: bottomRight
    }),
    [GlowSide.BOTTOM]: side({
      from: bottomRight,
      through: [
        {
          x: right - radius,
          y: bottom
        },
        {
          x: left + radius,
          y: bottom
        }
      ],
      to: bottomLeft
    }),
    [GlowSide.LEFT]: side({
      from: bottomLeft,
      through: [
        {
          x: left,
          y: bottom - radius
        },
        {
          x: left,
          y: top + radius
        }
      ],
      to: topLeft
    })
  } satisfies Record<GlowSide, string>;
}

// The rectangle a stroke of `width` must follow so that it lies wholly outside `rect`, touching it
export function outsetRect({ rect, radius, width }: { rect: Rect; radius: number; width: number }) {
  const half = width / 2;
  return {
    rect: {
      x: rect.x - half,
      y: rect.y - half,
      width: rect.width + width,
      height: rect.height + width
    },
    radius: radius + half
  };
}

// One path of four corners, each an arc with an arm running out along both edges
export function bracketPath({ rect, radius }: { rect: Rect; radius: number }) {
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const arm = BRACKET_ARM;
  return [
    `M ${left},${top + radius + arm} L ${left},${top + radius} A ${radius},${radius} 0 0 1 ${left + radius},${top} L ${left + radius + arm},${top}`,
    `M ${right - radius - arm},${top} L ${right - radius},${top} A ${radius},${radius} 0 0 1 ${right},${top + radius} L ${right},${top + radius + arm}`,
    `M ${right},${bottom - radius - arm} L ${right},${bottom - radius} A ${radius},${radius} 0 0 1 ${right - radius},${bottom} L ${right - radius - arm},${bottom}`,
    `M ${left + radius + arm},${bottom} L ${left + radius},${bottom} A ${radius},${radius} 0 0 1 ${left},${bottom - radius} L ${left},${bottom - radius - arm}`
  ].join(" ");
}
