import { setWindowColorKey } from "@/win32/index.ts";
import type { WindowHandle } from "winui-svelte/components";
import { systemSettings } from "winui-svelte/window";

// What Windows paints where a window's transparent backdrop fails, as 0x00BBGGRR: opaque white in the
// light theme, opaque black in the dark one
const SURROUND_WHITE = 0x00ffffff;
const SURROUND_BLACK = 0x00000000;

/**
 * Keeps the plain colour around a window's drawing see-through, for as long as the window lives: a
 * window that should be clear around its shape (the pill, the focus chip) is otherwise a white or
 * black rectangle on systems where the transparent backdrop fails. Windows can drop the setting when
 * the window is shown or moved again, so it is set again on every change, and when the theme changes.
 *
 * @returns What stops keeping it.
 */
export function keepSurroundClear(handle: WindowHandle) {
  const { appWindow } = handle;
  const current: { color: number } = { color: SURROUND_WHITE };

  function apply() {
    setWindowColorKey({
      hwnd: appWindow.id.value,
      color: current.color
    });
  }

  const stopWatching = $effect.root(() => {
    const settings = systemSettings();
    $effect(() => {
      current.color = settings.isDarkTheme ? SURROUND_BLACK : SURROUND_WHITE;
      apply();
    });
  });
  const stopChanges = appWindow.onChanged(apply);
  return () => {
    stopChanges();
    stopWatching();
  };
}
