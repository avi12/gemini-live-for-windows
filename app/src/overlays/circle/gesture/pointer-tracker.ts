import { PointerType } from "winui-svelte/input";

const PRIMARY_BUTTON = 0;
const SECONDARY_BUTTON = 2;

export const PressVerdict = {
  start: "start",
  cancel: "cancel",
  ignore: "ignore"
} as const;

interface PressReport {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
}

// Follows only the first pointer of a gesture: a second finger, a palm or a pen that lands while
// one is down is ignored, and only a mouse's right button cancels (a pen's barrel button and
// eraser report as buttons too, and must not close the overlay)
export function createPointerTracker() {
  let activeId: number | undefined;

  return {
    get isActive() {
      return activeId !== undefined;
    },
    press({ pointerId, pointerType, button }: PressReport) {
      const isBusy = activeId !== undefined;
      if (isBusy) {
        return PressVerdict.ignore;
      }

      const isMouse = pointerType === PointerType.mouse;
      const isCancel = isMouse && button === SECONDARY_BUTTON;
      if (isCancel) {
        return PressVerdict.cancel;
      }

      const isDrawing = button === PRIMARY_BUTTON;
      if (!isDrawing) {
        return PressVerdict.ignore;
      }

      activeId = pointerId;
      return PressVerdict.start;
    },
    // A move belongs to the gesture when it is the tracked pointer's, or when none is down (hover)
    isFollowed(pointerId: number) {
      return activeId === undefined || activeId === pointerId;
    },
    // True when the tracked pointer ended; any other pointer's end is not the gesture's
    release(pointerId: number) {
      const isTracked = activeId === pointerId;
      if (!isTracked) {
        return false;
      }

      activeId = undefined;
      return true;
    }
  };
}
