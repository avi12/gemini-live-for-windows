import { bringToFront } from "@/overlays/foreground.ts";
import type { ForegroundApi, OverlayLog } from "@/overlays/ports.ts";

// Gives the keyboard back to the app the user was in when the pill opened. The pill never takes
// focus itself, but Win+C passes the foreground through Windows' own Copilot focus frame and then
// to the window we registered for the key; so the foreground is followed as it changes, and the
// last real app is put back in front when Windows leaves it on one of those, the desktop or
// nothing. An app the user switched to meanwhile is left alone.
//
// dynwinrt delivers no native callbacks, so SetWinEventHook is out of reach and the foreground is
// polled on the UI worker instead.

// How often the foreground window is read. Short enough to see every app the user settles in
// before pressing the key, long enough that an idle app wakes a handful of times a second
export const FOREGROUND_POLL_MILLISECONDS = 150;

// How long Windows gets to finish handing the foreground over before it is judged
export const SETTLE_MILLISECONDS = 120;

const IGNORED_WINDOW_CLASSES: ReadonlySet<string> = new Set([
  "Progman",
  "WorkerW",
  "Shell_TrayWnd",
  "Shell_SecondaryTrayWnd",
  "CopilotKeyPressFocusFrame"
]);

const NO_WINDOW = 0n;

export type StartPolling = (options: {
  onTick: () => void;
  milliseconds: number;
}) => () => void;

function createRealWindowCheck({ api, ownProcessId, ownWindows }: {
  api: ForegroundApi;
  ownProcessId: number;
  ownWindows: () => readonly bigint[];
}) {
  return (hwnd: bigint) => {
    const isExcluded = hwnd === NO_WINDOW || ownWindows().includes(hwnd);
    if (isExcluded) {
      return false;
    }

    const isOurs = api.processIdOf(hwnd) === ownProcessId;
    return !isOurs && !IGNORED_WINDOW_CLASSES.has(api.classNameOf(hwnd));
  };
}

export function createPreviousApp({ api, startPolling, delay, ownProcessId, ownWindows, log }: {
  api: ForegroundApi;
  startPolling: StartPolling;
  delay: (milliseconds: number) => Promise<void>;
  ownProcessId: number;
  // Windows of the app that belong to a child process or to no process id check (the pill's)
  ownWindows: () => readonly bigint[];
  log: OverlayLog;
}) {
  let lastApp = NO_WINDOW;
  const isReal = createRealWindowCheck({
    api,
    ownProcessId,
    ownWindows
  });

  function note(hwnd: bigint) {
    if (isReal(hwnd)) {
      lastApp = hwnd;
    }
  }

  function restore() {
    const previous = lastApp;
    const isGone = previous === NO_WINDOW || !api.isWindow(previous);
    const isRealAppInFront = isReal(api.foregroundWindow());
    const isNothingToRestore = isGone || isRealAppInFront;
    if (isNothingToRestore) {
      return;
    }

    bringToFront({
      api,
      hwnd: previous
    });
    log.write("focus: back to the app that was in front");
  }

  note(api.foregroundWindow());
  const stopPolling = startPolling({
    onTick: () => note(api.foregroundWindow()),
    milliseconds: FOREGROUND_POLL_MILLISECONDS
  });

  // While the pill is up, brings the last real app back in front if Windows left the foreground
  // on a window of ours or the desktop; waits a moment for Windows to finish handing it over
  async function settle() {
    await delay(SETTLE_MILLISECONDS);
    restore();
  }

  return {
    settle,
    restore,
    dispose: stopPolling
  };
}
