export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Vector = Point;

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect extends Point, Size {}

const ORIGIN: Point = {
  x: 0,
  y: 0
};

export function rectFromPoints({ first, second }: {
  first: Point;
  second: Point;
}) {
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(first.x - second.x),
    height: Math.abs(first.y - second.y)
  };
}

export function rectOfSize(size: Size) {
  return {
    ...ORIGIN,
    ...size
  };
}

export function rectRight(rect: Rect) {
  return rect.x + rect.width;
}

export function rectBottom(rect: Rect) {
  return rect.y + rect.height;
}

export function rectCorners(rect: Rect) {
  const right = rectRight(rect);
  const bottom = rectBottom(rect);
  return [
    {
      x: rect.x,
      y: rect.y
    },
    {
      x: right,
      y: rect.y
    },
    {
      x: right,
      y: bottom
    },
    {
      x: rect.x,
      y: bottom
    }
  ] as const;
}

export function inflateRect({ rect, amount }: {
  rect: Rect;
  amount: number;
}) {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2
  };
}

// Edges touching count as an overlap (a zero-size result), as WPF's Rect.Intersect does
export function intersectRects({ first, second }: {
  first: Rect;
  second: Rect;
}) {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(rectRight(first), rectRight(second));
  const bottom = Math.min(rectBottom(first), rectBottom(second));
  const isOverlapping = right >= left && bottom >= top;
  if (!isOverlapping) {
    return undefined;
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

export function boundsOf(points: Iterable<Point>) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const point of points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }

  const isEmpty = left > right;
  if (isEmpty) {
    return undefined;
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

export function rectContains({ rect, point }: {
  rect: Rect;
  point: Point;
}) {
  const isInsideX = point.x >= rect.x && point.x <= rectRight(rect);
  const isInsideY = point.y >= rect.y && point.y <= rectBottom(rect);
  return isInsideX && isInsideY;
}

export function rectsTouch({ first, second }: {
  first: Rect;
  second: Rect;
}) {
  return intersectRects({
    first,
    second
  }) !== undefined;
}

export function distanceBetween({ first, second }: {
  first: Point;
  second: Point;
}) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export function subtractPoints({ first, second }: {
  first: Point;
  second: Point;
}) {
  return {
    x: first.x - second.x,
    y: first.y - second.y
  };
}

export function addPoints({ first, second }: {
  first: Point;
  second: Point;
}) {
  return {
    x: first.x + second.x,
    y: first.y + second.y
  };
}
