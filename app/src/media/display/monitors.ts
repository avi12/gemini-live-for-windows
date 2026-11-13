import type { Monitor } from "@/contracts/monitor.ts";
import type { Clock } from "@/media/clock.ts";

import { displayNamed, haveDisplaysChanged, orderDisplays, reconcileDisplay } from "./monitor-layout.ts";
import type { RawDisplay } from "./monitor-structs.ts";

const DISPLAY_POLL_MILLISECONDS = 2000;
export const NO_DISPLAY_MESSAGE = "No display is attached";

// What Windows is asked: callbacks cannot reach JavaScript, so the real one (display-native.ts) lists
// devices and asks for their monitors instead of EnumDisplayMonitors.
export interface DisplayNative {
  listRawDisplays(): RawDisplay[];
  foregroundDisplayName(): string | undefined;
  cursorDisplayName(): string | undefined;
}

export function createMonitors({ native }: { native: DisplayNative }) {
  function all() {
    return orderDisplays(native.listRawDisplays());
  }

  function pick(deviceName: string | undefined) {
    const monitor = displayNamed({
      all: all(),
      deviceName
    });
    const isMonitorMissing = monitor === undefined;
    if (isMonitorMissing) {
      throw new Error(NO_DISPLAY_MESSAGE);
    }

    return monitor;
  }

  // The display under the pointer, where the pill, screen share and mouse gestures belong, whichever window
  // has focus; the foreground window's display when the pointer cannot be read
  function active() {
    return pick(native.cursorDisplayName() ?? native.foregroundDisplayName());
  }

  function reconcile({ current, display }: { current: readonly Monitor[]; display: Monitor }) {
    return reconcileDisplay({
      all: current,
      display,
      fallback: active
    });
  }

  return {
    all,
    active,
    reconcile
  };
}

export type Monitors = ReturnType<typeof createMonitors>;

// Displays are plugged and unplugged without any callback reaching us, so the list is read every couple
// of seconds and compared; `onChange` gets the new list only when something moved.
export function watchDisplays({
  monitors,
  clock,
  onChange,
  intervalMilliseconds = DISPLAY_POLL_MILLISECONDS
}: {
  monitors: Pick<Monitors, "all">;
  clock: Clock;
  onChange: (current: Monitor[]) => void;
  intervalMilliseconds?: number;
}) {
  let known = monitors.all();
  return clock.setInterval(() => {
    const current = monitors.all();
    if (
      !haveDisplaysChanged({
        before: known,
        after: current
      })
    ) {
      return;
    }

    known = current;
    onChange(current);
  }, intervalMilliseconds);
}
