// The overlay windows' entry on the UI worker: everything that must run after `runOnUiThread`, on
// the thread whose message pump hears the hotkeys. The controller's side is `index.ts`.

export { createCursorApi, createForegroundApi } from "@/overlays/win32-api.ts";
export { createOverlayWindowHost } from "@/overlays/window-host.ts";
export type { OverlayWindowDeps } from "@/overlays/window-host.ts";
export { serveOverlayWindows } from "@/overlays/window-link.ts";
export type { OverlayWindowEvents, OverlayWindowHost } from "@/overlays/window-link.ts";

// winui-svelte's registerHotkey, loaded on demand so the thread's apartment comes first. It throws
// a HotkeyError when another app owns the combination
export async function loadRegisterHotkey() {
  const { registerHotkey } = await import("winui-svelte/app/hotkeys");
  return registerHotkey;
}

// The web pointer events the overlay windows' raw elements take. Call once on the UI worker before
// the first overlay is mounted
export async function prepareOverlayWindows() {
  const { registerControls } = await import("winui-svelte");
  const { enableInputEvents } = await import("winui-svelte/input");
  const border = await import("winui-svelte/bindings/microsoft/ui/xaml/controls/Border");
  const grid = await import("winui-svelte/bindings/microsoft/ui/xaml/controls/Grid");

  registerControls({
    ...border,
    ...grid
  });
  enableInputEvents();
}
