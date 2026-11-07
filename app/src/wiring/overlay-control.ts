import { monitorName } from "@/contracts/monitor.ts";
import { openFile } from "@/core/shell/open-external.ts";
import { errorMessage } from "@/lib/error-message.ts";
import type { Media } from "@/media/media.ts";
import { createLensSearch } from "@/overlays/circle/lens-search.ts";
import { createCircleSession } from "@/overlays/circle/session.ts";
import { connectOverlayWindows } from "@/overlays/controller-link.ts";
import { CircleAction } from "@/overlays/protocol.ts";
import { createScreenFocus } from "@/overlays/screen-focus.ts";
import type { PillController } from "@/pill/controller.ts";
import type { ScreenFocusOptions, ScreenFocusPort } from "@/pill/ports.ts";
import type { Transport } from "winui-svelte/state/host";

function toCircleText(lines: Awaited<ReturnType<ReturnType<typeof createCircleSession>["readText"]>>) {
  return lines.map(line => ({
    words: line.words.map(word => ({
      text: word.text,
      bounds: {
        ...word.bounds
      }
    }))
  }));
}

// Freezes the display under the pointer for the user to circle something, then sends the crop
// on: to Lens, or to Gemini as what it sees, starting a conversation if none is running
async function runCircle({ media, controller, session, lens, log }: {
  media: Pick<Media, "monitors">;
  controller: () => Pick<PillController, "focusRegion" | "isRunning">;
  session: ReturnType<typeof createCircleSession>;
  lens: ReturnType<typeof createLensSearch>;
  log: (message: string) => void;
}) {
  try {
    const monitor = media.monitors.underCursor();
    const { isRunning } = controller();
    log(`circle on ${monitorName(monitor)}${isRunning ? " (Live running)" : ""}`);
    // While Live runs, the loop itself is the request: no buttons, it focuses on release
    const selection = await session.select({
      monitor,
      isAskOnRelease: isRunning
    });
    if (!selection) {
      return;
    }

    const isLens = selection.action === CircleAction.lens;
    if (isLens) {
      await lens.search(selection.crop);
      return;
    }

    await controller().focusRegion({
      monitor: selection.monitor,
      region: selection.region
    });
  } catch (error) {
    log(`circle: ${errorMessage(error)}`);
  }
}

// The main thread's side of Circle to Search and the share border: the windows and hotkeys run on
// the UI worker, so this turns what they report into the pill controller's calls and back
export function createOverlayControl({ transport, media, controller, log }: {
  transport: Transport;
  media: Pick<Media, "circleScreen" | "monitors">;
  // The controller is built over the focus this creates, so it is reached on demand
  controller: () => Pick<PillController, "focusRegion" | "isRunning">;
  log: (message: string) => void;
}) {
  const overlayLog = { write: log };
  let focus: ReturnType<typeof createScreenFocus> | undefined;

  const link = connectOverlayWindows({
    transport,
    log: overlayLog,
    events: {
      focusEscapePressed: () => focus?.events.escapePressed(),
      chipDismissed: () => focus?.events.chipDismissed(),
      chipDragStarted: () => focus?.events.chipDragStarted(),
      chipDragged: travelled => focus?.events.chipDragged(travelled),
      circleKeyPressed: () => void circle(),
      readCircleText: async ({ region }) => toCircleText(await session.readText(region))
    }
  });
  const session = createCircleSession({
    screen: media.circleScreen,
    openOverlay: link.openCircle,
    setCircling: isCircling => focus?.setCircling(isCircling),
    log: overlayLog
  });
  const lens = createLensSearch({
    opener: {
      openFile
    },
    log: overlayLog
  });

  function circle() {
    return runCircle({
      media,
      controller,
      session,
      lens,
      log
    });
  }

  function createFocus({ currentEngine }: ScreenFocusOptions) {
    focus = createScreenFocus({
      windows: link.windows,
      currentEngine,
      log: overlayLog
    });
    const port: ScreenFocusPort = focus;
    return port;
  }

  return {
    createFocus,
    close: () => link.close()
  };
}
