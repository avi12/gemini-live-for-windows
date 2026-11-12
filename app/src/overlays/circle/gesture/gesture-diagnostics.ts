import { GestureEventKind } from "@/overlays/circle/gesture/gesture.ts";
import type { GestureEvent } from "@/overlays/circle/gesture/gesture.ts";
import type { OverlayLog } from "@/overlays/ports.ts";
import type { Size } from "@/overlays/shapes.ts";

// What a bug report needs to tell "no pointer input" from "input but nothing drawn": once per
// gesture, the press, the window's measured size and the first point of the stroke
export function createGestureDiagnostics({ log, size }: {
  log: OverlayLog;
  // The window's measured size, undefined until it reported one
  size: () => Size | undefined;
}) {
  let isAwaitingFirstPoint = false;

  return function observe(event: GestureEvent) {
    const isPress = event.kind === GestureEventKind.pointerDown;
    if (isPress) {
      isAwaitingFirstPoint = true;
      const measured = size();
      const sizeText = measured === undefined ? "not measured" : `${measured.width}x${measured.height}`;
      log.write(`circle: pointer down at ${event.point.x},${event.point.y}, window ${sizeText}`);
      return;
    }

    const isFirstMove = isAwaitingFirstPoint && event.kind === GestureEventKind.pointerMove;
    if (isFirstMove) {
      isAwaitingFirstPoint = false;
      log.write(`circle: first stroke point ${event.point.x},${event.point.y}`);
    }
  };
}
