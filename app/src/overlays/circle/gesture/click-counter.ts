import { distanceBetween } from "@/overlays/shapes.ts";
import type { Point } from "@/overlays/shapes.ts";

// WinUI's pointer events carry no click count, so presses are counted here with Windows' default
// double-click time (GetDoubleClickTime) and distance (SM_CXDOUBLECLK)
export const MULTI_CLICK_MILLISECONDS = 500;
export const MULTI_CLICK_DISTANCE = 4;

export function createClickCounter() {
  let count = 0;
  let lastTime = -Infinity;
  let lastPoint: Point | undefined;

  // The number of presses in a row this one makes: 1 for a lone press, 2 for a double, 3 a triple
  function press({ point, time }: { point: Point; time: number }) {
    const isQuick = time - lastTime <= MULTI_CLICK_MILLISECONDS;
    const isNear =
      lastPoint !== undefined &&
      distanceBetween({
        first: lastPoint,
        second: point
      }) <= MULTI_CLICK_DISTANCE;
    const isContinuing = isQuick && isNear;
    count = isContinuing ? count + 1 : 1;
    lastTime = time;
    lastPoint = point;
    return count;
  }

  return { press };
}
