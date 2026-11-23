import { collapse } from "@/ui/fold/collapse.svelte.ts";
import { BUTTON_PARTS, PillPart, placeOf } from "@/ui/window/places.svelte.ts";
import type { Place } from "@/ui/window/places.svelte.ts";

/**
 * The window's drag region (the pill) and passthrough regions (its buttons). Applying the regions
 * costs milliseconds each time, and a glide moves the pill and its buttons on every frame: they are
 * held as they were while it runs (a click mid-glide does not matter) and follow the settled places
 * once it ends. Call it while a component initializes.
 *
 * @returns The regions, as getters.
 */
export function heldWindowRegions() {
  let dragRegions: Place[] = $state([]);
  let passthroughRegions: Place[] = $state([]);

  // Gliding is read first, so a held run does not read the places
  $effect(() => {
    if (collapse.isGliding) {
      return;
    }

    dragRegions = [placeOf(PillPart.PILL)].filter(place => place !== undefined);
    // A button of the face that is not shown is still built, at no size: it takes no clicks
    passthroughRegions = BUTTON_PARTS.map(part => placeOf(part)).filter(
      (place): place is Place => place !== undefined && place.width > 0 && place.height > 0
    );
  });

  return {
    get dragRegions() {
      return dragRegions;
    },
    get passthroughRegions() {
      return passthroughRegions;
    }
  };
}
