// The overlay windows' start on the UI worker: everything that must run after `runOnUiThread`, on the
// thread whose message pump drives the windows. The controller's side is `controller-link.ts`.

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
