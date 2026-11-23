import type { ComponentProps } from "svelte";
import { mountControl } from "winui-svelte";

import FocusChip from "@/overlays/focus/focus-chip.svelte";
import { borderBounds } from "@/overlays/focus/focus-layout.ts";
import ShareBorder from "@/overlays/focus/share-border.svelte";
import type { CursorApi, OverlayLog } from "@/overlays/ports.ts";
import { createFocusEscapeKey } from "@/overlays/window/hotkeys.ts";
import type { RegisterHotkey } from "@/overlays/window/hotkeys.ts";
import type { OverlayWindowEvents, OverlayWindowHost } from "@/overlays/window/window-link.ts";

export interface OverlayWindowDeps {
  register: RegisterHotkey;
  cursor: CursorApi;
  log: OverlayLog;
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
    ondragged: events.chipDragged
  };
  return mountControl({
    component: FocusChip,
    props
  });
}

// The windows themselves, on the UI worker after the message pump started: the share border and the
// focus chip, their global hotkey, and the glue between them and the pure logic. The controller
// reaches it over the overlay link (window-link.ts)
export function createOverlayWindowHost({ events, deps }: { events: OverlayWindowEvents; deps: OverlayWindowDeps }) {
  const { register, cursor, log } = deps;

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
    attachChip: options => chip.set({ attached: options }),
    hideChip: () => chip.set({ attached: undefined }),
    holdFocusEscape: isHeld => focusEscape.hold(isHeld)
  } satisfies OverlayWindowHost;
}
