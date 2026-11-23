import { clipPillWindow } from "@/lib/pill-window.ts";
import { announceFold } from "@/ui/fold-listeners.ts";
import { Motion } from "@/ui/motion/motion.ts";

// The width the unfolded pill and the caption card above it share, and so the window's width; every
// other width is the content's own
export const PILL_WIDTH = 468;

// A switch that needs no glide (the width did not change) still ends, by this long after the click
const GLIDE_GUARD_MILLISECONDS = Motion.UNFOLD_MILLISECONDS + 120;

// Whether the pill is folded down to its compact form: just an orb that unfolds it.
// The window never changes size for a fold (a resize blanks it for a frame): once the orb has settled
// the window is clipped to it, so the space beside it shows what is beneath and takes no clicks.
// `isGliding` is the capsule on its way, when the window must show all of itself.
export const collapse = $state({
  isCollapsed: false,
  isGliding: false
});

// What the latest click asked for, and which click that was: rapid clicks each flip what is wanted at
// once, and only the latest one's work (and timer) take effect
let isFoldWanted = false;
let latestClick = 0;

export async function toggleCollapse() {
  isFoldWanted = !isFoldWanted;
  latestClick += 1;
  const click = latestClick;
  const isUnfolding = !isFoldWanted;

  // Only the orb at rest is clipped; the window shows all of itself again before the capsule starts
  // to grow into it
  const isClipped = collapse.isCollapsed && !collapse.isGliding;
  if (isUnfolding && isClipped) {
    await clipPillWindow(null);
  }

  const isOvertaken = click !== latestClick;
  if (isOvertaken) {
    return;
  }

  collapse.isGliding = true;
  collapse.isCollapsed = isFoldWanted;
  announceFold(isFoldWanted);

  setTimeout(() => {
    if (click === latestClick) {
      collapse.isGliding = false;
    }
  }, GLIDE_GUARD_MILLISECONDS);
}
