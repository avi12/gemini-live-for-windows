import { emphasizedAccelerate, emphasizedDecelerate } from "@/ui/motion/easing.ts";
import { cubicOut } from "svelte/easing";

// Googlebook's pill motion (the WPF pill's Motion.cs, which matched it): it rises out of the
// taskbar on the emphasized decelerate curve, and leaves on the accelerate curve with a fade that
// stays linear, so it is visible the whole way down.
export const Motion = {
  enterMilliseconds: 400,
  exitMilliseconds: 260,
  standardMilliseconds: 200,
  swapOutMilliseconds: 100,
  followMilliseconds: 90,
  bounceMilliseconds: 100,
  menuExitMilliseconds: 120,
  staggerMilliseconds: 60,
  pillRise: 24,
  pillSink: 40,
  pillScale: 0.96,
  cardRise: 12,
  lineRise: 8,
  menuSink: 8,
  menuScale: 0.96,
  bounceScale: 0.9
} as const;

const SCALE_ORIGIN = "center bottom";
export const MENU_EXIT_STEPS = 8;

export function menuExitAt(progress: number) {
  const eased = emphasizedAccelerate(progress);
  return {
    opacity: 1 - progress,
    sink: eased * Motion.menuSink,
    scale: 1 + (Motion.menuScale - 1) * eased
  };
}

function riseInOf({ rise, scaleFrom }: {
  rise: number;
  scaleFrom: number;
}) {
  return (_node: Element) => ({
    duration: Motion.enterMilliseconds,
    css(progress: number) {
      const eased = emphasizedDecelerate(progress);
      const scale = scaleFrom + (1 - scaleFrom) * eased;
      return `opacity: ${eased}; translate: 0 ${(1 - eased) * rise}px; scale: ${scale}; transform-origin: ${SCALE_ORIGIN}`;
    }
  });
}

function sinkOutOf({ drop, scaleTo }: {
  drop: number;
  scaleTo: number;
}) {
  return (_node: Element) => ({
    duration: Motion.exitMilliseconds,
    css(progress: number, left: number) {
      const eased = emphasizedAccelerate(left);
      const scale = 1 + (scaleTo - 1) * eased;
      return `opacity: ${progress}; translate: 0 ${eased * drop}px; scale: ${scale}; transform-origin: ${SCALE_ORIGIN}`;
    }
  });
}

function liftOf({ rise }: { rise: number }) {
  return (_node: Element) => ({
    duration: Motion.standardMilliseconds,
    css(progress: number) {
      const eased = cubicOut(progress);
      return `opacity: ${progress}; translate: 0 ${(1 - eased) * rise}px`;
    }
  });
}

export const pillEnter = riseInOf({
  rise: Motion.pillRise,
  scaleFrom: Motion.pillScale
});

export const pillExit = sinkOutOf({
  drop: Motion.pillSink,
  scaleTo: Motion.pillScale
});

export const cardLift = liftOf({ rise: Motion.cardRise });

export const lineLift = liftOf({ rise: Motion.lineRise });
