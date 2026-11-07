import type { ForegroundApi } from "@/overlays/ports.ts";

// Makes the window the foreground one even where Windows' foreground lock would refuse. A hotkey's
// window shows only after the user lets go of the keys, and those releases went to the app in
// front, so it - not us - owns the last input and a plain SetForegroundWindow is ignored. Sharing
// that app's input state for the call lets the switch through (Overlay.BringToFront in the C#).
export function bringToFront({ api, hwnd }: {
  api: ForegroundApi;
  hwnd: bigint;
}) {
  const ours = api.currentThreadId();
  const theirs = api.threadIdOf(api.foregroundWindow());
  const isOtherThread = theirs !== 0 && theirs !== ours;
  const isAttached = isOtherThread && api.attachThreadInput({
    ours,
    theirs,
    isAttached: true
  });
  try {
    api.bringWindowToTop(hwnd);
    api.setForegroundWindow(hwnd);
  } finally {
    if (isAttached) {
      api.attachThreadInput({
        ours,
        theirs,
        isAttached: false
      });
    }
  }
}
