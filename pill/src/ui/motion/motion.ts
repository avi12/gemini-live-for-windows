import { cubicOut } from "svelte/easing";

import { emphasizedAccelerate, emphasizedDecelerate } from "@/ui/motion/easing.ts";

// Googlebook's pill motion (the WPF pill's Motion.cs, which matched it): it rises out of the
// taskbar on the emphasized decelerate curve, and leaves on the accelerate curve with a fade that
// stays linear, so it is visible the whole way down.
export const Motion = {
  ENTER_MILLISECONDS: 400,
  EXIT_MILLISECONDS: 260,
  STANDARD_MILLISECONDS: 200,
  SWAP_OUT_MILLISECONDS: 100,
  FOLLOW_MILLISECONDS: 90,
  BOUNCE_MILLISECONDS: 100,
  MENU_EXIT_MILLISECONDS: 120,
  STAGGER_MILLISECONDS: 60,
  PILL_RISE: 24,
  PILL_SINK: 40,
  PILL_SCALE: 0.96,
  CARD_RISE: 12,
  LINE_RISE: 8,
  MENU_SINK: 8,
  MENU_SCALE: 0.96,
  BOUNCE_SCALE: 0.9
} as const;

const SCALE_ORIGIN = "center bottom";
export const MENU_EXIT_STEPS = 8;

export function menuExitAt(progress: number) {
  const eased = emphasizedAccelerate(progress);
  return {
    opacity: 1 - progress,
    sink: eased * Motion.MENU_SINK,
    scale: 1 + (Motion.MENU_SCALE - 1) * eased
  };
}

function riseInOf({ rise, scaleFrom }: { rise: number; scaleFrom: number }) {
  return (_node: Element) => ({
    duration: Motion.ENTER_MILLISECONDS,
    css(progress: number) {
      const eased = emphasizedDecelerate(progress);
      const scale = scaleFrom + (1 - scaleFrom) * eased;
      return `opacity: ${eased}; translate: 0 ${(1 - eased) * rise}px; scale: ${scale}; transform-origin: ${SCALE_ORIGIN}`;
    }
  });
}

function sinkOutOf({ drop, scaleTo }: { drop: number; scaleTo: number }) {
  return (_node: Element) => ({
    duration: Motion.EXIT_MILLISECONDS,
    css(progress: number, left: number) {
      const eased = emphasizedAccelerate(left);
      const scale = 1 + (scaleTo - 1) * eased;
      return `opacity: ${progress}; translate: 0 ${eased * drop}px; scale: ${scale}; transform-origin: ${SCALE_ORIGIN}`;
    }
  });
}

function liftOf({ rise }: { rise: number }) {
  return (_node: Element) => ({
    duration: Motion.STANDARD_MILLISECONDS,
    css(progress: number) {
      const eased = cubicOut(progress);
      return `opacity: ${progress}; translate: 0 ${(1 - eased) * rise}px`;
    }
  });
}

export const pillEnter = riseInOf({
  rise: Motion.PILL_RISE,
  scaleFrom: Motion.PILL_SCALE
});

export const pillExit = sinkOutOf({
  drop: Motion.PILL_SINK,
  scaleTo: Motion.PILL_SCALE
});

export const cardLift = liftOf({ rise: Motion.CARD_RISE });

export const lineLift = liftOf({ rise: Motion.LINE_RISE });
