import { monitorName } from "@/contracts/monitor.ts";
import { errorMessage } from "@/lib/error-message.ts";
import type { Media } from "@/media/media.ts";
import { circlePhase, circleToggle, CircleToggleAction } from "@/overlays/circle/circle-toggle.ts";
import type { createCircleSession } from "@/overlays/circle/session.ts";
import type { PillController } from "@/pill/controller.ts";
import type { SearchChoice } from "@/wiring/main-thread/search-choice.ts";

export type CircleEntryController = Pick<
  PillController,
  "focusActiveDisplay" | "focusRegion" | "isRegionFocused" | "isRunning"
>;

export interface CircleEntryMedia {
  readonly monitors: Pick<Media["monitors"], "active">;
}

export type CircleEntrySession = Pick<ReturnType<typeof createCircleSession>, "cancel" | "isOpen" | "select">;

// Freezes the display under the pointer for the user to circle something, then sends the crop to
// Gemini as what it sees, starting a conversation if none is running. A reverse image search is
// answered while the overlay is still up (see searchCircle), so it can say when it fails
async function startCircle({ media, controller, session, searchChoice, log }: {
  media: CircleEntryMedia;
  controller: () => CircleEntryController;
  session: CircleEntrySession;
  searchChoice: SearchChoice;
  log: (message: string) => void;
}) {
  try {
    const monitor = media.monitors.active();
    const { isRunning } = controller();
    log(`circle on ${monitorName(monitor)}${isRunning ? " (Live running)" : ""}`);
    // While Live runs, the loop itself is the request: no buttons, it focuses on release
    const selection = await session.select({
      monitor,
      isAskOnRelease: isRunning,
      preferredSearch: searchChoice.current()
    });
    if (!selection) {
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

// The one entry Win+Alt+C and the pill's button share, a toggle: it closes the overlay when it is
// open, else hands Gemini the whole active display back while it watches a circled region, else
// starts Circle to Search
export function createCircleEntry({ media, controller, session, searchChoice, log }: {
  media: CircleEntryMedia;
  controller: () => CircleEntryController;
  session: CircleEntrySession;
  searchChoice: SearchChoice;
  log: (message: string) => void;
}) {
  return async function circle() {
    const phase = circlePhase({
      isOverlayOpen: session.isOpen,
      isRegionFocused: controller().isRegionFocused
    });
    const action = circleToggle(phase);
    log(`circle toggle: ${phase} -> ${action}`);

    switch (action) {
      case CircleToggleAction.cancelOverlay:
        session.cancel();
        return;
      case CircleToggleAction.focusWholeDisplay:
        controller().focusActiveDisplay();
        return;
      case CircleToggleAction.startCircle:
        await startCircle({
          media,
          controller,
          session,
          searchChoice,
          log
        });
        return;
    }
  };
}
