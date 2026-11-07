import CircleOverlay from "@/overlays/circle/circle-overlay.svelte";
import { createCircleController } from "@/overlays/circle/controller.ts";
import type { CircleView } from "@/overlays/circle/controller.ts";
import { CircleHint, GestureEventKind } from "@/overlays/circle/gesture/gesture.ts";
import type { GestureEvent } from "@/overlays/circle/gesture/gesture.ts";
import FocusChip from "@/overlays/focus/focus-chip.svelte";
import { borderBounds } from "@/overlays/focus/focus-layout.ts";
import { bringToFront } from "@/overlays/focus/foreground.ts";
import ShareBorder from "@/overlays/focus/share-border.svelte";
import type { Clipboard, CursorApi, ForegroundApi, OverlayLog } from "@/overlays/ports.ts";
import type { AttachChip, CircleOutcome, OpenCircle } from "@/overlays/protocol.ts";
import type { Size } from "@/overlays/shapes.ts";
import { createFrameBatcher } from "@/overlays/window/frame-batcher.ts";
import { createCopyKey, createFocusEscapeKey, createOverlayKeys, holdCircleKey } from "@/overlays/window/hotkeys.ts";
import type { RegisterHotkey } from "@/overlays/window/hotkeys.ts";
import type { OverlayWindowEvents, OverlayWindowHost } from "@/overlays/window/window-link.ts";
import type { ComponentProps } from "svelte";
import { mountControl } from "winui-svelte";

export interface OverlayWindowDeps {
  register: RegisterHotkey;
  foreground: ForegroundApi;
  cursor: CursorApi;
  clipboard: Clipboard;
  log: OverlayLog;
  // Debug runs leave the overlays visible to screenshots
  isDebugging: boolean;
  requestFrame: (callback: () => void) => void;
  setTimer: (options: {
    milliseconds: number;
    onTick: () => void;
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
      copyText: text => deps.clipboard.writeText(text),
      holdCopyKey: isHeld => copyKey.hold(isHeld),
      close,
      setTimer: deps.setTimer,
      now: deps.now,
      log: deps.log
    },
    onView
  });
}

function monitorBounds({ x, y, width, height }: OpenCircle["monitor"]) {
  return {
    x,
    y,
    width,
    height
  };
}

function circleOverlayProps({ options, deps, dispatch, onsized, ondeactivated }: {
  options: OpenCircle;
  deps: OverlayWindowDeps;
  dispatch: (event: GestureEvent) => void;
  onsized: (size: Size) => void;
  ondeactivated: () => void;
}) {
  const props: ComponentProps<typeof CircleOverlay> = {
    bounds: monitorBounds(options.monitor),
    still: Buffer.from(options.stillJpegBase64, "base64"),
    view: undefined,
    isExcludedFromCapture: !deps.isDebugging,
    dispatch,
    onsized,
    ondeactivated,
    onready: (handle: bigint) => bringToFront({
      api: deps.foreground,
      hwnd: handle
    })
  };
  return props;
}

function openCircleWindow({ options, events, deps }: {
  options: OpenCircle;
  events: OverlayWindowEvents;
  deps: OverlayWindowDeps;
}) {
  const answer = Promise.withResolvers<CircleOutcome>();
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
  const overlay = mountControl({
    component: CircleOverlay,
    props: circleOverlayProps({
      options,
      deps,
      dispatch,
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
          close,
          onView: view => batcher.push(view)
        });
        keys.hold(true);
      },
      ondeactivated: () => controller?.deactivated()
    })
  });

  // The keys go back before the answer, so the caller can take Esc for itself the moment it
  // hears it; the window is gone by then too
  function close(outcome: CircleOutcome) {
    keys.hold(false);
    copyKey.hold(false);
    controller?.dispose();
    overlay.unmount();
    answer.resolve(outcome);
  }

  return answer.promise;
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
