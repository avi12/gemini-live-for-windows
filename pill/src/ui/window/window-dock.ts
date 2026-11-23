import type { WindowHandle } from "winui-svelte/components";
import { windowsDisplaySource } from "winui-svelte/devices/display";
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

/**
 * Calls `onChange` the moment a display is attached, detached, moved or resized (a new resolution, the
 * taskbar moving), so the pill goes back to its corner at once; the app's own display list follows a
 * couple of seconds later and docks it again, on its exact display.
 *
 * @param onChange - What to do on each change.
 * @returns A function that stops listening.
 */
export function followDisplayChanges(onChange: () => void) {
  // WinUI's display area watcher: an event per display added, removed or updated, no polling
  const stops = windowsDisplaySource().subscriptions.map(subscribe => subscribe(onChange));
  return () => {
    for (const stop of stops) {
      stop();
    }
  };
}
