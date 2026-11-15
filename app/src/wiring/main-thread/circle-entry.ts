import { monitorName } from "@/contracts/monitor.ts";
import type { Monitor } from "@/contracts/monitor.ts";
import { errorMessage } from "@/lib/error-message.ts";
import type { Media } from "@/media/media.ts";
import { circlePhase, circleToggle, CircleToggleAction } from "@/overlays/circle/circle-toggle.ts";
import type { createCircleSession } from "@/overlays/circle/session.ts";
import type { PillController } from "@/pill/controller.ts";

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
export async function startCircle({
  media,
  controller,
  session,
  log,
  monitor = media.monitors.active(),
  isSelectingText = false
}: {
  media: CircleEntryMedia;
  controller: () => CircleEntryController;
  session: CircleEntrySession;
  log: (message: string) => void;
  // The display to freeze: the active one unless the caller names one
  monitor?: Monitor;
  // Opens straight into picking words off the screen, as the overlay's Select text does
  isSelectingText?: boolean;
}) {
  try {
    const { isRunning } = controller();
    log(
      `circle on ${monitorName(monitor)}${isRunning ? " (Live running)" : ""}${isSelectingText ? " (select text)" : ""}`
    );
    // While Live runs, the loop itself is the request: no buttons, it focuses on release
    const selection = await session.select({
      monitor,
      isAskOnRelease: isRunning && !isSelectingText,
      isSelectingText
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
export function createCircleEntry({
  media,
  controller,
  session,
  log
}: {
  media: CircleEntryMedia;
  controller: () => CircleEntryController;
  session: CircleEntrySession;
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
      case CircleToggleAction.CANCEL_OVERLAY:
        session.cancel();
        return;
      case CircleToggleAction.FOCUS_WHOLE_DISPLAY:
        controller().focusActiveDisplay();
        return;
      case CircleToggleAction.START_CIRCLE:
        await startCircle({
          media,
          controller,
          session,
          log
        });
        return;
    }
  };
}
