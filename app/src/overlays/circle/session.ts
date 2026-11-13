import type { Monitor, Region } from "@/contracts/monitor.ts";
import { errorMessage } from "@/lib/error-message.ts";
import type { CircleScreen, CropFrame, FrozenScreen, OverlayLog } from "@/overlays/ports.ts";
import type { CircleAction, CircleOutcome, OpenCircle } from "@/overlays/protocol.ts";

// What the user circled: the sharp crop (for Lens), where it is on the monitor in physical pixels
// (for Gemini to keep watching it live), the monitor, and what to do with it
export interface CircleSelection {
  readonly action: CircleAction;
  readonly crop: CropFrame;
  readonly region: Region;
  readonly monitor: Monitor;
}

function openOptions({
  monitor,
  frozen,
  isAskOnRelease
}: {
  monitor: Monitor;
  frozen: FrozenScreen;
  isAskOnRelease: boolean;
}) {
  return {
    monitor,
    stillJpegBase64: Buffer.from(frozen.jpeg).toString("base64"),
    stillWidth: frozen.width,
    stillHeight: frozen.height,
    isAskOnRelease
  } satisfies OpenCircle;
}

async function circleMonitor({
  screen,
  openOverlay,
  setCircling,
  monitor,
  isAskOnRelease,
  onFrozen
}: {
  screen: CircleScreen;
  openOverlay: (options: OpenCircle) => Promise<CircleOutcome>;
  setCircling: (isCircling: boolean) => void;
  monitor: Monitor;
  isAskOnRelease: boolean;
  onFrozen: (frozen: FrozenScreen) => void;
}) {
  // Captured before the window exists, so the still is the screen as the user last saw it
  const frozen = await screen.freeze(monitor);
  onFrozen(frozen);
  setCircling(true);
  const options = openOptions({
    monitor,
    frozen,
    isAskOnRelease
  });
  const outcome = await openOverlay(options);
  setCircling(false);

  if (outcome.isCancelled) {
    return undefined;
  }

  return {
    action: outcome.action,
    crop: await screen.crop({
      frozen,
      region: outcome.region
    }),
    region: outcome.region,
    monitor
  } satisfies CircleSelection;
}

async function readFrozen({
  screen,
  frozen,
  region
}: {
  screen: CircleScreen;
  frozen: FrozenScreen | undefined;
  region: Region | null;
}) {
  const isMissing = frozen === undefined;
  if (isMissing) {
    return [];
  }

  return screen.readText({
    frozen,
    region: region ?? undefined
  });
}

// Circle to Search from the controller's side (main thread): freezes the display, shows the
// overlay on the UI worker, and turns the answer into a crop. The Esc the screen focus holds is
// let go of first (`setCircling`), since the overlay needs Esc for its own cancel
export function createCircleSession({
  screen,
  openOverlay,
  setCircling,
  log
}: {
  screen: CircleScreen;
  openOverlay: (options: OpenCircle) => Promise<CircleOutcome>;
  setCircling: (isCircling: boolean) => void;
  log: OverlayLog;
}) {
  let isOpen = false;
  let frozenNow: FrozenScreen | undefined;

  // Freezes `monitor` and lets the user circle part of it; the selection, or undefined when they
  // cancel. The overlay is gone before this resolves, so whatever runs next sees the real screen
  // again. With `isAskOnRelease` (Gemini Live is already running) there are no buttons: the first
  // loop the user finishes is the answer, as askGemini
  async function select({ monitor, isAskOnRelease }: { monitor: Monitor; isAskOnRelease: boolean }) {
    if (isOpen) {
      return undefined;
    }

    isOpen = true;
    try {
      return await circleMonitor({
        screen,
        openOverlay,
        setCircling,
        monitor,
        isAskOnRelease,
        onFrozen(frozen) {
          frozenNow = frozen;
        }
      });
    } catch (error) {
      setCircling(false);
      log.write(`circle: ${errorMessage(error)}`);
      return undefined;
    } finally {
      isOpen = false;
      frozenNow = undefined;
    }
  }

  // OCR of the still the open overlay shows, inside `region` (its pixels) or all of it
  async function readText(region: Region | null) {
    return readFrozen({
      screen,
      frozen: frozenNow,
      region
    });
  }

  return {
    select,
    readText
  };
}
