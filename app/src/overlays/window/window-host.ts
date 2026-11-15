import type { BrowserCookie } from "@gemini-live/protocol/link";
import type { ComponentProps } from "svelte";
import { mountControl } from "winui-svelte";

import type { Monitor } from "@/contracts/monitor.ts";
import { errorMessage } from "@/lib/error-message.ts";
import type { ChipAction } from "@/overlays/circle/chips/chip.ts";
import CircleOverlay from "@/overlays/circle/circle-overlay.svelte";
import { createCircleController } from "@/overlays/circle/controller.ts";
import type { CircleView } from "@/overlays/circle/controller.ts";
import { createGestureDiagnostics } from "@/overlays/circle/gesture/gesture-diagnostics.ts";
import { CircleHint, GestureEventKind } from "@/overlays/circle/gesture/gesture.ts";
import type { GestureEvent } from "@/overlays/circle/gesture/gesture.ts";
import { SEARCH_ENGINES, SearchDestination } from "@/overlays/circle/search-engines.ts";
import FocusChip from "@/overlays/focus/focus-chip.svelte";
import { borderBounds } from "@/overlays/focus/focus-layout.ts";
import ShareBorder from "@/overlays/focus/share-border.svelte";
import type { Clipboard, CursorApi, OverlayLog } from "@/overlays/ports.ts";
import { isSearchAction } from "@/overlays/protocol.ts";
import type { AttachChip, CircleOutcome, OpenCircle, SearchAction, SearchCircle } from "@/overlays/protocol.ts";
import SearchRegion from "@/overlays/region/search-region.svelte";
import type { ResultsTarget } from "@/overlays/results/results-layout.ts";
import ResultsPanel from "@/overlays/results/results-panel.svelte";
import type { Rect, Size } from "@/overlays/shapes.ts";
import { createCircleLifecycle } from "@/overlays/window/circle-lifecycle.ts";
import { displayIdOf } from "@/overlays/window/display-id.ts";
import type { DisplayAreaEntry } from "@/overlays/window/display-id.ts";
import { createFrameBatcher } from "@/overlays/window/frame-batcher.ts";
import { createCopyKey, createFocusEscapeKey, createOverlayKeys, holdCircleKey } from "@/overlays/window/hotkeys.ts";
import type { RegisterHotkey } from "@/overlays/window/hotkeys.ts";
import type { OverlayWindowEvents, OverlayWindowHost } from "@/overlays/window/window-link.ts";

export interface OverlayWindowDeps {
  register: RegisterHotkey;
  // Raises a window past Windows' foreground lock; whether it ended in front
  bringToFront: (hwnd: bigint) => boolean;
  // The displays Windows lists now, with the ids a window can be sent to
  displayAreas: () => readonly DisplayAreaEntry[];
  cursor: CursorApi;
  clipboard: Clipboard;
  // Opens an address in the app Windows has for it; whether Windows started one
  launchUri: (uri: string) => Promise<boolean>;
  // The Google account's cookies, which the results panel signs in with
  loadCookies: () => Promise<readonly BrowserCookie[]>;
  log: OverlayLog;
  requestFrame: (callback: () => void) => void;
  // Runs the callback once after the delay; the returned function cancels it
  schedule: (options: { callback: () => void; milliseconds: number }) => () => void;
  now: () => number;
}

function mountShareBorder() {
  const props: ComponentProps<typeof ShareBorder> = {
    bounds: undefined,
    isRegion: false
  };
  return mountControl({
    component: ShareBorder,
    props
  });
}

function mountFocusChip({ cursor, events }: { cursor: CursorApi; events: OverlayWindowEvents }) {
  const props: ComponentProps<typeof FocusChip> = {
    attached: undefined,
    cursorPosition: cursor.cursorPosition,
    ondismissed: events.chipDismissed,
    ondragstarted: events.chipDragStarted,
    ondragged: events.chipDragged,
    onselecttext: events.chipSelectTextPressed
  };
  return mountControl({
    component: FocusChip,
    props
  });
}

function mountResultsPanel({ deps, onclosed }: { deps: OverlayWindowDeps; onclosed: () => void }) {
  const props: ComponentProps<typeof ResultsPanel> = {
    target: undefined,
    loadCookies: deps.loadCookies,
    onopenbrowser(url) {
      void deps.launchUri(url);
    },
    oncopyurl(url) {
      void deps.clipboard.writeText(url);
    },
    ondismissed: onclosed,
    onfailed: message => deps.log.write(`results: ${message}`)
  };
  return mountControl({
    component: ResultsPanel,
    props
  });
}

// What the overlay hands the windows once it has searched: a page that goes in the results panel,
// or a searched region that stays as a frame beside it
interface Presenter {
  page: (target: ResultsTarget) => void;
  search: (found: { url: string; search: SearchCircle; options: OpenCircle }) => void;
}

function mountSearchRegion({ cursor, onchanged }: { cursor: CursorApi; onchanged: (region: Rect) => void }) {
  const props: ComponentProps<typeof SearchRegion> = {
    target: undefined,
    cursorPosition: cursor.cursorPosition,
    onchanged
  };
  return mountControl({
    component: SearchRegion,
    props
  });
}

function createCircleKeys({
  register,
  log,
  dispatch
}: {
  register: RegisterHotkey;
  log: OverlayLog;
  dispatch: (event: GestureEvent) => void;
}) {
  const keys = createOverlayKeys({
    register,
    log,
    onEscape: () => dispatch({ kind: GestureEventKind.ESCAPE }),
    onFinish: action =>
      dispatch({
        kind: GestureEventKind.FINISH,
        action
      }),
    onSelectText: () => dispatch({ kind: GestureEventKind.SELECT_TEXT })
  });
  const copyKey = createCopyKey({
    register,
    onPressed: () => dispatch({ kind: GestureEventKind.COPY }),
    log
  });
  return {
    keys,
    copyKey
  };
}

function startCircleController({
  size,
  options,
  deps,
  events,
  present,
  copyKey,
  close,
  onView
}: {
  size: Size;
  options: OpenCircle;
  deps: OverlayWindowDeps;
  events: OverlayWindowEvents;
  present: Presenter;
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
    hintText: options.isAskOnRelease ? CircleHint.CIRCLE_TO_ASK : CircleHint.CIRCLE,
    world: {
      readText: region => events.readCircleText({ region }),
      async searchImage(search) {
        const url = await events.searchCircle(search);
        const isFound = url !== "";
        if (!isFound) {
          return false;
        }

        const isBrowserSearch =
          isSearchAction(search.action) && SEARCH_ENGINES[search.action].destination === SearchDestination.BROWSER;
        if (isBrowserSearch) {
          return deps.launchUri(url);
        }

        present.search({
          url,
          search,
          options
        });
        return true;
      },
      scanCodes: region => events.scanCircleCodes({ region }),
      // A web page opens in the results panel; a message or a phone number goes to the app Windows has
      async openUri(uri) {
        const isWebPage = uri.startsWith("https:") || uri.startsWith("http:");
        if (!isWebPage) {
          return deps.launchUri(uri);
        }

        present.page({
          url: uri,
          monitor: options.monitor
        });
        return true;
      },
      schedule: deps.schedule,
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
function raise({ hwnd, deps }: { hwnd: bigint; deps: OverlayWindowDeps }) {
  try {
    const isInFront = deps.bringToFront(hwnd);
    if (!isInFront) {
      deps.log.write("circle: Windows kept another window in front");
    }
  } catch (error) {
    deps.log.write(`circle: could not bring the overlay to the front: ${errorMessage(error)}`);
  }
}

function circleOverlayProps({
  session,
  displayId,
  still,
  deps,
  dispatch,
  onchip,
  onsized,
  ondeactivated,
  onfailed
}: {
  session: number;
  displayId: bigint;
  still: Uint8Array;
  deps: OverlayWindowDeps;
  dispatch: (event: GestureEvent) => void;
  onchip: (action: ChipAction) => void;
  onsized: (size: Size) => void;
  ondeactivated: () => void;
  onfailed: (error: string) => void;
}) {
  const props: ComponentProps<typeof CircleOverlay> = {
    session,
    displayId,
    still,
    view: undefined,
    dispatch,
    onchip,
    onsized,
    ondeactivated,
    onready: hwnd =>
      raise({
        hwnd,
        deps
      }),
    onfailed
  };
  return props;
}

const NO_SESSION = 0;
const NO_STILL = new Uint8Array();
const NO_DISPLAY = 0n;

// The circle overlay's window, made once and left hidden until a use asks for it: a window made at the
// moment of the key press flashes white for a moment as it first appears
function mountCircleOverlay(deps: OverlayWindowDeps) {
  return mountControl({
    component: CircleOverlay,
    props: circleOverlayProps({
      session: NO_SESSION,
      displayId: NO_DISPLAY,
      still: NO_STILL,
      deps,
      dispatch: () => undefined,
      onchip: () => undefined,
      onsized: () => undefined,
      ondeactivated: () => undefined,
      onfailed: () => undefined
    })
  });
}

type CircleOverlayControl = ReturnType<typeof mountCircleOverlay>;

function openCircleWindow({
  options,
  session,
  overlay,
  events,
  deps,
  present,
  onCloseable
}: {
  options: OpenCircle;
  // The number of this use, above 0
  session: number;
  overlay: CircleOverlayControl;
  events: OverlayWindowEvents;
  deps: OverlayWindowDeps;
  present: Presenter;
  // Hands over the way to close this overlay as a cancel
  onCloseable: (close: () => void) => void;
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
  let windowSize: Size | undefined;
  const observe = createGestureDiagnostics({
    log: deps.log,
    size: () => windowSize
  });

  function dispatch(event: GestureEvent) {
    observe(event);
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
    // The window stays, hidden and empty, for the next use
    unmount: () =>
      overlay.set({
        session: NO_SESSION,
        still: NO_STILL,
        view: undefined
      }),
    schedule: deps.schedule
  });
  overlay.set(
    circleOverlayProps({
      session,
      displayId,
      // Decoded once, into the bytes the Image takes
      still: Buffer.from(options.stillJpegBase64, "base64"),
      deps,
      dispatch,
      onchip: action => controller?.pressChip(action),
      onfailed: lifecycle.fail,
      onsized(size: Size) {
        windowSize = size;
        const isStarted = controller !== undefined;
        if (isStarted) {
          return;
        }

        controller = startCircleController({
          size,
          options,
          deps,
          events,
          present,
          copyKey,
          close: lifecycle.close,
          onView: view => batcher.push(view)
        });
        keys.hold(true);
        lifecycle.started();

        const { textRegion } = options;
        if (textRegion !== null) {
          // The region's physical pixels on the still, as the overlay's own DIPs
          controller.dispatch({
            kind: GestureEventKind.SELECT_TEXT,
            area: {
              x: (textRegion.x * size.width) / options.stillWidth,
              y: (textRegion.y * size.height) / options.stillHeight,
              width: (textRegion.width * size.width) / options.stillWidth,
              height: (textRegion.height * size.height) / options.stillHeight
            }
          });
        }
      },
      ondeactivated: () => controller?.deactivated()
    })
  );

  onCloseable(() => lifecycle.close({ isCancelled: true }));
  return lifecycle.answer;
}

// The windows themselves, on the UI worker after the message pump started: the share border, the
// focus chip and the circle overlay, their global hotkeys, and the glue between them and the pure
// logic. The controller reaches it over the overlay link (window-link.ts)
export function createOverlayWindowHost({ events, deps }: { events: OverlayWindowEvents; deps: OverlayWindowDeps }) {
  const { register, cursor, log } = deps;

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
  const border = mountShareBorder();
  const chip = mountFocusChip({
    cursor,
    events
  });

  const results = mountResultsPanel({
    deps,
    onclosed: hideResults
  });
  // The action the region frame searches with again each time it is moved or resized
  const searchAgain: {
    action: SearchAction | undefined;
    monitor: Monitor | undefined;
  } = {
    action: undefined,
    monitor: undefined
  };
  const searchRegionFrame = mountSearchRegion({
    cursor,
    onchanged(region) {
      void researchRegion(region);
    }
  });
  const circleOverlay = mountCircleOverlay(deps);
  let circleSessions = NO_SESSION;
  let closeOpenCircle: (() => void) | undefined;

  function showResults(target: ResultsTarget) {
    results.set({ target });
  }

  function hideResults() {
    results.set({ target: undefined });
    searchRegionFrame.set({ target: undefined });
  }

  // A page opened from the circle, not a search of a region: no frame goes with it
  function showPage(target: ResultsTarget) {
    searchRegionFrame.set({ target: undefined });
    showResults(target);
  }

  // The circle closes, and its region stays as a frame on the live screen, with the results beside it
  function presentSearch({ url, search, options }: { url: string; search: SearchCircle; options: OpenCircle }) {
    showResults({
      url,
      monitor: options.monitor
    });
    searchAgain.action = isSearchAction(search.action) ? search.action : undefined;
    searchAgain.monitor = options.monitor;
    const scale = options.monitor.width / options.stillWidth;
    searchRegionFrame.set({
      target: {
        monitor: options.monitor,
        region: {
          x: options.monitor.x + Math.round(search.region.x * scale),
          y: options.monitor.y + Math.round(search.region.y * scale),
          width: Math.round(search.region.width * scale),
          height: Math.round(search.region.height * scale)
        }
      }
    });
  }

  async function researchRegion(region: Rect) {
    const { action, monitor } = searchAgain;
    const isSearchable = action !== undefined && monitor !== undefined;
    if (!isSearchable) {
      return;
    }

    const url = await events.searchRegion({
      action,
      monitor,
      region: {
        x: region.x - monitor.x,
        y: region.y - monitor.y,
        width: region.width,
        height: region.height
      }
    });
    const isFound = url !== "";
    if (isFound) {
      showResults({
        url,
        monitor
      });
    }
  }

  async function openCircle(options: OpenCircle) {
    hideResults();
    circleSessions += 1;
    const outcome = await openCircleWindow({
      options,
      session: circleSessions,
      overlay: circleOverlay,
      events,
      deps,
      present: {
        page: showPage,
        search: presentSearch
      },
      onCloseable(close) {
        closeOpenCircle = close;
      }
    });
    closeOpenCircle = undefined;
    return outcome;
  }

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
    openCircle,
    closeCircle: () => closeOpenCircle?.()
  } satisfies OverlayWindowHost;
}
