import type { Transport } from "winui-svelte/state/host";

import { connectOverlayWindows } from "@/overlays/controller-link.ts";
import { createScreenFocus } from "@/overlays/focus/screen-focus.ts";
import type { ScreenFocusOptions, ScreenFocusPort } from "@/pill/ports.ts";

// The main thread's side of the share border and the focus chip: the windows and hotkeys run on the
// UI worker, so this turns what they report into the screen focus's calls and back
export function createOverlayControl({ transport, log }: { transport: Transport; log: (message: string) => void }) {
  const overlayLog = { write: log };
  let focus: ReturnType<typeof createScreenFocus> | undefined;

  const link = connectOverlayWindows({
    transport,
    log: overlayLog,
    events: {
      focusEscapePressed: () => focus?.events.escapePressed(),
      chipDismissed: () => focus?.events.chipDismissed(),
      chipDragStarted: () => focus?.events.chipDragStarted(),
      chipDragged: travelled => focus?.events.chipDragged(travelled)
    }
  });

  function createFocus(options: ScreenFocusOptions) {
    focus = createScreenFocus({
      windows: link.windows,
      currentEngine: options.currentEngine,
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
