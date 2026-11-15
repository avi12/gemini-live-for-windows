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
    // A view over the same memory: Buffer.from(bytes) would copy the whole still first
    stillJpegBase64: Buffer.from(frozen.jpeg.buffer, frozen.jpeg.byteOffset, frozen.jpeg.byteLength).toString("base64"),
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
  log,
  isCancelRequested,
  onFrozen
}: {
  screen: CircleScreen;
  openOverlay: (options: OpenCircle) => Promise<CircleOutcome>;
  setCircling: (isCircling: boolean) => void;
  monitor: Monitor;
  isAskOnRelease: boolean;
  log: OverlayLog;
  // Win+Alt+C pressed while the display was still being captured: there is no window to close yet
  isCancelRequested: () => boolean;
  onFrozen: (frozen: FrozenScreen | undefined) => void;
}) {
  // Captured before the window exists, so the still is the screen as the user last saw it
  const frozen = await screen.freeze(monitor);
  if (isCancelRequested()) {
    return undefined;
  }

  onFrozen(frozen);
  setCircling(true);
  // Not held in a variable: the base64 string is as big as the still and only the call needs it
  const outcome = await openOverlay(
    openOptions({
      monitor,
      frozen,
      isAskOnRelease
    })
  );
  setCircling(false);

  if (outcome.isCancelled) {
    onFrozen(undefined);

    const hasFailed = outcome.error !== undefined;
    if (hasFailed) {
      log.write(`circle: the overlay failed: ${outcome.error}`);
    }

    return undefined;
  }

  const crop = await screen.crop({
    frozen,
    region: outcome.region
  });
  onFrozen(undefined);
  return {
    action: outcome.action,
    crop,
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
  closeOverlay,
  setCircling,
  log
}: {
  screen: CircleScreen;
  openOverlay: (options: OpenCircle) => Promise<CircleOutcome>;
  // Closes the open overlay as a cancel
  closeOverlay: () => void;
  setCircling: (isCircling: boolean) => void;
  log: OverlayLog;
}) {
  let isOpen = false;
  let isCancelRequested = false;
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
    isCancelRequested = false;
    try {
      return await circleMonitor({
        screen,
        openOverlay,
        setCircling,
        monitor,
        isAskOnRelease,
        log,
        isCancelRequested: () => isCancelRequested,
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

  // Backs out of Circle to Search: the open overlay closes and the selection is discarded; select
  // resolves undefined, so nothing else changes
  function cancel() {
    if (!isOpen) {
      return;
    }

    isCancelRequested = true;
    closeOverlay();
  }

  // OCR of the still the open overlay shows, inside `region` (its pixels) or all of it
  async function readText(region: Region | null) {
    return readFrozen({
      screen,
      frozen: frozenNow,
      region
    });
  }

  // The sharp crop of the still the open overlay shows, or undefined when none is open
  async function crop(region: Region) {
    const frozen = frozenNow;
    const isMissing = frozen === undefined;
    if (isMissing) {
      return undefined;
    }

    return screen.crop({
      frozen,
      region
    });
  }

  // The sharp crop of `region` (the display's pixels) of the screen as it is now
  async function cropLive({ monitor, region }: { monitor: Monitor; region: Region }) {
    const frozen = await screen.freeze(monitor);
    return screen.crop({
      frozen,
      region
    });
  }

  // The sharp crop and the words of `region` (the display's pixels) of the screen as it is now, from
  // one capture so the words sit exactly on the picture
  async function grabLive({ monitor, region }: { monitor: Monitor; region: Region }) {
    const frozen = await screen.freeze(monitor);
    return {
      crop: await screen.crop({
        frozen,
        region
      }),
      lines: await screen.readText({
        frozen,
        region
      })
    };
  }

  // The decoded text of each QR code inside `region` of the still the open overlay shows
  async function scanCodes(region: Region) {
    const frozen = frozenNow;
    const isMissing = frozen === undefined;
    if (isMissing) {
      return [];
    }

    return screen.scanCodes({
      frozen,
      region
    });
  }

  return {
    get isOpen() {
      return isOpen;
    },
    select,
    cancel,
    readText,
    crop,
    cropLive,
    grabLive,
    scanCodes
  };
}
