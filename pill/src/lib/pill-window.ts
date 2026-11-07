import type { WindowHandle } from "winui-svelte/components";

let current: WindowHandle | undefined;

// The pill's own window, for the host that needs it (the app's UI worker moves and raises it)
export function setPillWindow(handle: WindowHandle | undefined) {
  current = handle;
}

export function pillWindow() {
  return current;
}
