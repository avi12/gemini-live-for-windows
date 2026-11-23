import { control } from "winui-svelte";

import { collapse } from "@/ui/collapse.svelte.ts";
import { onFoldChange } from "@/ui/fold-listeners.ts";
import { EASE_OUT_CSS, easeOut } from "@/ui/motion/easing.ts";
import { Motion } from "@/ui/motion/motion.ts";

// The curve the capsule glides on; the card above it folds on the same one, so the two move as one
export const CAPSULE_EASING = EASE_OUT_CSS;

// A change smaller than this is rounding, not content
const MINIMUM_CHANGE = 0.5;

interface Sized {
  actualWidth: number;
  onLayoutUpdated(callback: () => void): () => void;
}

interface Glide {
  cancel(): void;
  onfinish: (() => void) | null;
  oncancel: (() => void) | null;
}

interface Animatable {
  animate(keyframes: { width: string }[], options: { duration: number; easing: string }): Glide;
}

interface Run {
  glide: Glide;
  from: number;
  to: number;
  duration: number;
  startedAt: number;
}

// glideHeight for width. A fold or unfold starts its glide the moment it is asked for, toward the
// width the capsule had the last time it rested in that state, and from wherever the capsule is, so a
// click mid-glide turns it around smoothly and no frame shows the new width early. While a glide runs
// the element's measured width is the animation's, so layout is only read again once it ends: a
// change of content at rest (or a resting width that turned out different) glides by itself.
export function glideWidth() {
  return (node: Animatable) => {
    const attach = control<Sized>(element => {
      // The capsule's resting width in each state, folded or not, as last laid out
      const restingWidth = new Map<boolean, number>();
      let laidOut = element.actualWidth;
      let running: Run | null = null;

      // Where the running glide has the capsule now, worked out from the same curve it runs on
      function shownWidth() {
        if (!running) {
          return laidOut;
        }

        const progress = Math.min(1, (Date.now() - running.startedAt) / running.duration);
        return running.from + (running.to - running.from) * easeOut(progress);
      }

      function glideTo({ from, to }: { from: number; to: number }) {
        const duration = to < from ? Motion.FOLD_MILLISECONDS : Motion.UNFOLD_MILLISECONDS;
        const glide = node.animate([{ width: `${from}px` }, { width: `${to}px` }], {
          duration,
          easing: CAPSULE_EASING
        });

        // The new run is current before the old one is cancelled, so the old one's end is ignored
        const previous = running;
        const run: Run = {
          glide,
          from,
          to,
          duration,
          startedAt: Date.now()
        };
        running = run;
        laidOut = to;
        previous?.glide.cancel();

        function end() {
          const isCurrent = running === run;
          if (!isCurrent) {
            return;
          }

          running = null;
          collapse.isGliding = false;
          followLayout();
        }

        glide.onfinish = end;
        glide.oncancel = end;
      }

      function followLayout() {
        const isGliding = running !== null;
        if (isGliding) {
          return;
        }

        const next = element.actualWidth;
        restingWidth.set(collapse.isCollapsed, next);
        const isFirstLayout = laidOut <= 0;
        const isUnchanged = Math.abs(next - laidOut) < MINIMUM_CHANGE;
        if (isFirstLayout || isUnchanged) {
          laidOut = next;
          return;
        }

        glideTo({
          from: laidOut,
          to: next
        });
      }

      function onFold(isCollapsed: boolean) {
        const from = shownWidth();
        const to = restingWidth.get(isCollapsed);
        const isKnown = to !== undefined;
        if (isKnown) {
          glideTo({
            from,
            to
          });
          return;
        }

        // A state never seen at rest yet: layout gives its width, and the glide starts from here
        const glide = running?.glide;
        running = null;
        glide?.cancel();
        laidOut = from;
      }

      const stopLayout = element.onLayoutUpdated(followLayout);
      const stopFold = onFoldChange(onFold);

      return () => {
        stopLayout();
        stopFold();
        const glide = running?.glide;
        running = null;
        glide?.cancel();
        collapse.isGliding = false;
      };
    });

    return attach(node);
  };
}
