import type { LiveEngine } from "@/contracts/live-engine.ts";
import { isSameDisplay, monitorName } from "@/contracts/monitor.ts";
import type { Monitor, Region } from "@/contracts/monitor.ts";
import { regionAfterDrag } from "@/overlays/focus/focus-layout.ts";
import type { OverlayLog } from "@/overlays/ports.ts";
import type { AttachChip, CoverBorder, HoldFocusEscape } from "@/overlays/protocol.ts";
import type { Point } from "@/overlays/shapes.ts";

// The windows ScreenFocus drives: the frame around the shared display or region, the chip that
// labels a circled region, and the Esc hotkey. They live on the UI worker; over the overlay
// protocol this is how the controller reaches them.
export interface FocusWindows {
  coverBorder(options: CoverBorder): void;
  hideBorder(): void;
  attachChip(options: AttachChip): void;
  hideChip(): void;
  holdEscape(options: HoldFocusEscape): void;
}

export type FocusEngine = Pick<LiveEngine, "monitor" | "region" | "share">;

function createFocusFrame(windows: FocusWindows) {
  function show({ monitor, region }: {
    monitor: Monitor;
    region: Region;
  }) {
    windows.coverBorder({
      monitor,
      region
    });
    windows.attachChip({
      monitor,
      region
    });
  }

  function cover(monitor: Monitor) {
    windows.coverBorder({
      monitor,
      region: null
    });
  }

  return {
    show,
    cover,
    hideBorder: () => windows.hideBorder()
  };
}

function createEscapeHold({ windows, currentEngine }: {
  windows: FocusWindows;
  currentEngine: () => FocusEngine | undefined;
}) {
  let isOverlayUp = false;

  // Holds Esc only while Gemini sees a circled region, and not while the circle overlay is up,
  // which needs Esc for its own cancel
  function update() {
    const isRegionWatched = currentEngine()?.region !== undefined;
    windows.holdEscape({ isHeld: isRegionWatched && !isOverlayUp });
  }

  return {
    update,
    // The circle overlay is up (or gone): it needs Esc for itself, so ours is let go of first
    setCircling(isCircling: boolean) {
      isOverlayUp = isCircling;
      update();
    }
  };
}

function createFocusDrag({ currentEngine, show }: {
  currentEngine: () => FocusEngine | undefined;
  show: ReturnType<typeof createFocusFrame>["show"];
}) {
  let dragStartRegion: Region | undefined;

  function started() {
    dragStartRegion = currentEngine()?.region;
  }

  function dragged(travelled: Point) {
    const engine = currentEngine();
    const start = dragStartRegion;
    const isNothingToDrag = engine === undefined || start === undefined;
    if (isNothingToDrag) {
      return;
    }

    const region = regionAfterDrag({
      start,
      travelled,
      monitor: engine.monitor
    });
    engine.region = region;
    show({
      monitor: engine.monitor,
      region
    });
  }

  return {
    started,
    dragged
  };
}

function createChangeListeners() {
  const listeners = new Set<() => void>();

  return {
    changed() {
      for (const listener of listeners) {
        listener();
      }
    },
    onChanged(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}

function createFocusActions({ windows, currentEngine, log, frame, escape, changed }: {
  windows: FocusWindows;
  currentEngine: () => FocusEngine | undefined;
  log: OverlayLog;
  frame: ReturnType<typeof createFocusFrame>;
  escape: ReturnType<typeof createEscapeHold>;
  changed: () => void;
}) {
  // Has Gemini watch only `region` of `monitor`, live
  function focusOn({ monitor, region }: {
    monitor: Monitor;
    region: Region;
  }) {
    const engine = currentEngine();
    const isEngineMissing = engine === undefined;
    if (isEngineMissing) {
      return;
    }

    if (!isSameDisplay({
      first: monitor,
      second: engine.monitor
    })) {
      engine.share(monitor);
    }

    engine.region = region;
    frame.show({
      monitor,
      region
    });
    escape.update();
    changed();
    log.write(`focused on ${region.width}×${region.height} of ${monitorName(monitor)}`);
  }

  // Hands Gemini back the whole shared display
  function unfocus() {
    const engine = currentEngine();
    const isRegionWatched = engine?.region !== undefined;
    if (isRegionWatched) {
      engine.region = undefined;
      frame.cover(engine.monitor);
      log.write("focus: whole display again");
    }

    windows.hideChip();
    escape.update();
    changed();
  }

  return {
    focusOn,
    unfocus
  };
}

// What Gemini's view looks like on screen: the frame around the shared display and, for a circled
// region, the chip that labels it (its X and Esc hand back the whole display; dragging it moves the
// region). It acts on whichever engine `currentEngine` returns (ScreenFocus.cs)
export function createScreenFocus({ windows, currentEngine, log }: {
  windows: FocusWindows;
  currentEngine: () => FocusEngine | undefined;
  log: OverlayLog;
}) {
  const { changed, onChanged } = createChangeListeners();
  const frame = createFocusFrame(windows);
  const escape = createEscapeHold({
    windows,
    currentEngine
  });
  const drag = createFocusDrag({
    currentEngine,
    show: frame.show
  });
  const { focusOn, unfocus } = createFocusActions({
    windows,
    currentEngine,
    log,
    frame,
    escape,
    changed
  });

  return {
    cover: frame.cover,
    hideBorder: frame.hideBorder,
    focusOn,
    unfocus,
    onChanged,
    setCircling: escape.setCircling,
    // What the windows report, wired by the overlay link
    events: {
      escapePressed: unfocus,
      chipDismissed: unfocus,
      chipDragStarted: drag.started,
      chipDragged: drag.dragged
    }
  };
}
