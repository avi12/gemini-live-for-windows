import { untrack } from "svelte";

import { collapse } from "@/ui/fold/collapse.svelte.ts";
import { onFoldChange } from "@/ui/fold/fold-listeners.ts";
import { isAnimatable } from "@/ui/motion/animatable.ts";
import { CAPSULE_EASING } from "@/ui/motion/glide-width.ts";
import { Motion } from "@/ui/motion/motion.ts";

// The conversation above the pill folds with it: on a fold it sinks and shrinks toward the orb at the
// right end while it fades, on an unfold it rises back out of it, on the capsule's own timing. The card
// stays in the layout either way, only unseen while folded.
const ORIGIN = "right bottom";

const SHOWN = {
  opacity: 1,
  translate: "0px 0px",
  scale: "1",
  transformOrigin: ORIGIN
};

const FOLDED = {
  opacity: 0,
  translate: `0px ${Motion.CARD_FOLD_DROP}px`,
  scale: String(Motion.CARD_FOLD_SCALE),
  transformOrigin: ORIGIN
};

/**
 * An attachment for the card's container that plays each fold and unfold, and owns the card's opacity
 * and pose: each animation holds its end (fill forwards) until the next one replaces it. A pose left to
 * the card's own style came back wrong: the animation gives back what the card held when it started,
 * which was the other form, and an unfolded card went unseen as its rise ended. The first run and a
 * rebuild take their form at once.
 *
 * A fold starts from the same listener as the capsule's glide, so both run on the same start time. Started
 * from an effect instead, it began after the pass that re-renders the pill, and a busy pass put the two
 * out of step.
 *
 * @returns The attachment.
 */
export function foldWithPill() {
  return (node: object) => {
    if (!isAnimatable(node)) {
      return;
    }

    // Untracked: the attachment is set up once, and each fold comes from the listener below
    let isShownFolded = untrack(() => collapse.isCollapsed);
    const atRest = isShownFolded ? FOLDED : SHOWN;
    let animation = node.animate([atRest, atRest], {
      duration: 0,
      fill: "forwards"
    });

    const stopFold = onFoldChange(isFolded => {
      // A click overtaken mid-way can repeat the state already shown, which must not replay it
      const isChanged = isFolded !== isShownFolded;
      if (!isChanged) {
        return;
      }

      isShownFolded = isFolded;
      animation.cancel();
      animation = node.animate(isFolded ? [SHOWN, FOLDED] : [FOLDED, SHOWN], {
        duration: isFolded ? Motion.FOLD_MILLISECONDS : Motion.UNFOLD_MILLISECONDS,
        // The capsule's own curve and length: on a faster-starting curve the card was fully there
        // while the capsule had barely begun to widen
        easing: CAPSULE_EASING,
        fill: "forwards"
      });
    });

    return () => {
      stopFold();
      animation.cancel();
    };
  };
}
