import { errorMessage } from "@/lib/error-message.ts";
import CircleOverlay from "@/overlays/circle/circle-overlay.svelte";
import { createCircleController } from "@/overlays/circle/controller.ts";
import type { CircleView } from "@/overlays/circle/controller.ts";
import { CircleHint, GestureEventKind } from "@/overlays/circle/gesture/gesture.ts";
import type { GestureEvent } from "@/overlays/circle/gesture/gesture.ts";
import FocusChip from "@/overlays/focus/focus-chip.svelte";
import { borderBounds } from "@/overlays/focus/focus-layout.ts";
import ShareBorder from "@/overlays/focus/share-border.svelte";
import type { Clipboard, CursorApi, OverlayLog } from "@/overlays/ports.ts";
import type { AttachChip, CircleOutcome, OpenCircle } from "@/overlays/protocol.ts";
import type { Size } from "@/overlays/shapes.ts";
import { createCircleLifecycle } from "@/overlays/window/circle-lifecycle.ts";
import { displayIdOf } from "@/overlays/window/display-id.ts";
import type { DisplayAreaEntry } from "@/overlays/window/display-id.ts";
import { createFrameBatcher } from "@/overlays/window/frame-batcher.ts";
import { createCopyKey, createFocusEscapeKey, createOverlayKeys, holdCircleKey } from "@/overlays/window/hotkeys.ts";
import type { RegisterHotkey } from "@/overlays/window/hotkeys.ts";
import type { OverlayWindowEvents, OverlayWindowHost } from "@/overlays/window/window-link.ts";
import type { ComponentProps } from "svelte";
import { mountControl } from "winui-svelte";

export interface OverlayWindowDeps {
  register: RegisterHotkey;
  // Raises a window past Windows' foreground lock; whether it ended in front
  bringToFront: (hwnd: bigint) => boolean;
  // The displays Windows lists now, with the ids a window can be sent to
  displayAreas: () => readonly DisplayAreaEntry[];
  cursor: CursorApi;
  clipboard: Clipboard;
  log: OverlayLog;
  // Debug runs leave the overlays visible to screenshots
  isDebugging: boolean;
  requestFrame: (callback: () => void) => void;
  // Runs the callback once after the delay; the returned function cancels it
  schedule: (options: {
    callback: () => void;
    milliseconds: number;
  }) => () => void;
  now: () => number;
}

function mountShareBorder(isExcludedFromCapture: boolean) {
  const props: ComponentProps<typeof ShareBorder> = {
    bounds: undefined,
    isRegion: false,
    isExcludedFromCapture
  };
  return mountControl({
    component: ShareBorder,
    props
  });
}

function mountFocusChip({ isExcludedFromCapture, cursor, events }: {
  isExcludedFromCapture: boolean;
  cursor: CursorApi;
  events: OverlayWindowEvents;
}) {
  const props: ComponentProps<typeof FocusChip> = {
    attached: undefined,
    isExcludedFromCapture,
    cursorPosition: cursor.cursorPosition,
    ondismissed: events.chipDismissed,
    ondragstarted: events.chipDragStarted,
    ondragged: events.chipDragged
  };
  return mountControl({
    component: FocusChip,
    props
  });
}

function createCircleKeys({ register, log, dispatch }: {
  register: RegisterHotkey;
  log: OverlayLog;
  dispatch: (event: GestureEvent) => void;
}) {
  const keys = createOverlayKeys({
    register,
    log,
    onEscape: () => dispatch({ kind: GestureEventKind.escape }),
    onFinish: action => dispatch({
      kind: GestureEventKind.finish,
      action
    }),
    onSelectText: () => dispatch({ kind: GestureEventKind.selectText })
  });
  const copyKey = createCopyKey({
    register,
    onPressed: () => dispatch({ kind: GestureEventKind.copy }),
    log
  });
  return {
    keys,
    copyKey
  };
}

function startCircleController({ size, options, deps, events, copyKey, close, onView }: {
  size: Size;
  options: OpenCircle;
  deps: OverlayWindowDeps;
  events: OverlayWindowEvents;
  copyKey: ReturnType<typeof createCopyKey>;
  close: (outcome: CircleOutcome) => void;
  onView: (view: CircleView) => void;
}) {
  return createCircleController({
    window: size,
    still: {
      width: options.stillWidth,
      height: options.stillHeight
    },
    isAskOnRelease: options.isAskOnRelease,
    hintText: options.isAskOnRelease ? CircleHint.circleToAsk : CircleHint.circle,
    world: {
      readText: region => events.readCircleText({ region }),
      searchImage: options => events.searchCircle(options),
      copyText: text => deps.clipboard.writeText(text),
      holdCopyKey: isHeld => copyKey.hold(isHeld),
      close,
      now: deps.now,
      log: deps.log
    },
    onView
  });
}

// The overlay stays usable when Windows refuses the foreground: it is only a worse start
function raise({ hwnd, deps }: {
  hwnd: bigint;
  deps: OverlayWindowDeps;
}) {
  try {
    const isInFront = deps.bringToFront(hwnd);
    if (!isInFront) {
      deps.log.write("circle: Windows kept another window in front");
    }
  } catch (error) {
    deps.log.write(`circle: could not bring the overlay to the front: ${errorMessage(error)}`);
  }
}

function circleOverlayProps({ displayId, still, deps, dispatch, onsized, ondeactivated, onfailed }: {
  displayId: bigint;
  still: Uint8Array;
  deps: OverlayWindowDeps;
  dispatch: (event: GestureEvent) => void;
  onsized: (size: Size) => void;
  ondeactivated: () => void;
  onfailed: (error: string) => void;
}) {
  const props: ComponentProps<typeof CircleOverlay> = {
    displayId,
    still,
    view: undefined,
    isExcludedFromCapture: !deps.isDebugging,
    dispatch,
    onsized,
    ondeactivated,
    onready: hwnd => raise({
      hwnd,
      deps
    }),
    onfailed
  };
  return props;
}

function openCircleWindow({ options, events, deps }: {
  options: OpenCircle;
  events: OverlayWindowEvents;
  deps: OverlayWindowDeps;
}) {
  const displayId = displayIdOf({
    monitor: options.monitor,
    areas: deps.displayAreas()
  });
  const isDisplayMissing = displayId === undefined;
  if (isDisplayMissing) {
    return Promise.resolve({
      isCancelled: true,
      error: `no display at ${options.monitor.x},${options.monitor.y}`
    } satisfies CircleOutcome);
  }

  let controller: ReturnType<typeof createCircleController> | undefined;

  function dispatch(event: GestureEvent) {
    controller?.dispatch(event);
  }

  const { keys, copyKey } = createCircleKeys({
    register: deps.register,
    log: deps.log,
    dispatch
  });
  const batcher = createFrameBatcher<CircleView>({
    requestFrame: deps.requestFrame,
    apply: view => overlay.set({ view })
  });
  const lifecycle = createCircleLifecycle({
    releaseKeys() {
      keys.hold(false);
      copyKey.hold(false);
    },
    unmount: () => overlay.unmount(),
    schedule: deps.schedule
  });
  const overlay = mountControl({
    component: CircleOverlay,
    props: circleOverlayProps({
      displayId,
      // Decoded once, into the bytes the Image takes
      still: Buffer.from(options.stillJpegBase64, "base64"),
      deps,
      dispatch,
      onfailed: lifecycle.fail,
      onsized(size: Size) {
        const isStarted = controller !== undefined;
        if (isStarted) {
          return;
        }

        controller = startCircleController({
          size,
          options,
          deps,
          events,
          copyKey,
          close: lifecycle.close,
          onView: view => batcher.push(view)
        });
        keys.hold(true);
        lifecycle.started();
      },
      ondeactivated: () => controller?.deactivated()
    })
  });

  return lifecycle.answer;
}

// The windows themselves, on the UI worker after the message pump started: the share border, the
// focus chip and the circle overlay, their global hotkeys, and the glue between them and the pure
// logic. The controller reaches it over the overlay link (window-link.ts)
export function createOverlayWindowHost({ events, deps }: {
  events: OverlayWindowEvents;
  deps: OverlayWindowDeps;
}) {
  const { register, cursor, log, isDebugging } = deps;
  const isExcludedFromCapture = !isDebugging;

  holdCircleKey({
    register,
    onPressed: events.circleKeyPressed,
    log
  });
  const focusEscape = createFocusEscapeKey({
    register,
    onPressed: events.focusEscapePressed,
    log
  });
  const border = mountShareBorder(isExcludedFromCapture);
  const chip = mountFocusChip({
    isExcludedFromCapture,
    cursor,
    events
  });

  function attachChip(options: AttachChip) {
    chip.set({ attached: options });
  }

  return {
    coverBorder({ monitor, region }) {
      border.set({
        bounds: borderBounds({
          monitor,
          region
        }),
        isRegion: region !== null
      });
    },
    hideBorder: () => border.set({ bounds: undefined }),
    attachChip,
    hideChip: () => chip.set({ attached: undefined }),
    holdFocusEscape: isHeld => focusEscape.hold(isHeld),
    openCircle: options => openCircleWindow({
      options,
      events,
      deps
    })
  } satisfies OverlayWindowHost;
}
