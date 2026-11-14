import type { Point } from "@/overlays/shapes.ts";

interface PointerReport {
  readonly clientX: number;
  readonly clientY: number;
}

interface CoalescingPointerEvent extends PointerReport {
  getCoalescedEvents(): readonly PointerReport[];
}

// Where a pointer is, in the window's own coordinates. Every gesture point comes from `client`:
// the circle's down, move and hover all use the one coordinate space
export function pointerPoint({ clientX, clientY }: PointerReport) {
  return {
    x: clientX,
    y: clientY
  } satisfies Point;
}

// The path a move took since the last event, oldest first, or just the event when the platform
// did not fold any
export function movePoints(event: CoalescingPointerEvent) {
  const coalesced = event.getCoalescedEvents();
  const reports = coalesced.length > 0 ? coalesced : [event];
  return reports.map(pointerPoint);
}
