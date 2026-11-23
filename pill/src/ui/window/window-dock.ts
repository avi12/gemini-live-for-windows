import type { WindowHandle } from "winui-svelte/components";
import { DockDisplay, WindowAnchor } from "winui-svelte/window";

import { view } from "@/lib/view.svelte.ts";

const DOCK_INSET = 6;

/**
 * Docks the window in the bottom right corner of the display the pill is on, above other windows.
 *
 * @param handle - The window, once it exists.
 * @returns Whether it was docked: not before the window exists.
 */
export function dockPillWindow(handle: WindowHandle | undefined) {
  if (!handle) {
    return false;
  }

  // Moved onto the pill's display first, so docking to the current display lands there
  const target = view.displays.find(display => display.id === view.pillDisplay);
  if (target) {
    handle.appWindow.move({
      x: target.x + DOCK_INSET,
      y: target.y + DOCK_INSET
    });
  }

  handle.dock({
    anchor: WindowAnchor.bottomRight,
    inset: DOCK_INSET,
    display: DockDisplay.current
  });
  handle.presenter.isAlwaysOnTop = true;
  return true;
}
