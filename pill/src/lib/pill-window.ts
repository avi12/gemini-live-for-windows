import { PillActionKind } from "@gemini-live/protocol/view";
import type { PillRegion, WindowClipper } from "@gemini-live/protocol/view";
import type { WindowHandle } from "winui-svelte/components";

import { sendAction } from "@/lib/view.svelte.ts";

let current: WindowHandle | undefined;
let clipper: WindowClipper | undefined;

// The pill's own window, for the host that needs it (the app's UI worker moves and raises it)
export function setPillWindow(handle: WindowHandle | undefined) {
  current = handle;
}

export function pillWindow() {
  return current;
}

// A host on the pill's own thread hands its clipper over at mount
export function setWindowClipper(clip: WindowClipper | undefined) {
  clipper = clip;
}

/**
 * Clips the pill's window to `region`, or shows all of it for null. With a clipper on this thread it
 * happens at once; otherwise the host is asked, which takes a trip through its main thread (the
 * unfold waited most of a second on that before it could start).
 *
 * @param region - The part to show, or null for the whole window.
 */
export async function clipPillWindow(region: PillRegion | null) {
  const hwnd = current?.appWindow.id.value;
  const clip = clipper;
  const isLocal = clip !== undefined && hwnd !== undefined;
  if (isLocal) {
    clip({
      hwnd,
      region
    });
    return;
  }

  await sendAction({
    kind: PillActionKind.CLIP_TO,
    region
  });
}
