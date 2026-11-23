import type { WindowHandle } from "winui-svelte/components";

import { clipPillWindow } from "@/lib/pill-window.ts";
import { collapse } from "@/ui/fold/collapse.svelte.ts";
import { PillPart, placeOf } from "@/ui/window/places.svelte.ts";
import { regionOf } from "@/ui/window/window-region.ts";

/**
 * Keeps the window clipped to the part that shows (see `regionOf`), sending a region only when it
 * changes. Call it while a component initializes.
 *
 * @param options - The window's handle, and whether the entrance is over: the orb's place is measured
 * through the entrance's rise and scale, so a clip taken then misses the orb where it settles and the
 * window takes no click on it.
 */
export function clipToShownPart({
  handle,
  isEntered
}: {
  handle: () => WindowHandle | undefined;
  isEntered: () => boolean;
}) {
  let sentClip = JSON.stringify(null);

  function shownRegion() {
    const pill = placeOf(PillPart.PILL);
    const card = placeOf(PillPart.CARD);
    const root = placeOf(PillPart.ROOT);
    const windowHandle = handle();
    const isMeasured = isEntered() && pill !== undefined && root !== undefined && windowHandle !== undefined;
    if (!isMeasured) {
      return null;
    }

    return regionOf({
      pill,
      card,
      root,
      scale: windowHandle.scale,
      client: windowHandle.appWindow.clientSize,
      isOrb: collapse.isCollapsed && !collapse.isGliding
    });
  }

  $effect(() => {
    const region = shownRegion();
    const key = JSON.stringify(region);
    if (key === sentClip) {
      return;
    }

    sentClip = key;
    void clipPillWindow(region);
  });
}
