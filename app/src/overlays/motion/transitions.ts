import { emphasizedDecelerate, linearEase, OverlayMotion, standardEase } from "@/overlays/motion/motion.ts";

// Svelte transitions for the overlays, on the emphasized curves (Motion.Enter in the C#). Never the
// transform shorthand: translate and scale are their own properties. With reduced motion the
// duration is zero, so every move lands on its final value at once.

export const TransformOrigin = {
  bottom: "center bottom",
  top: "center top",
  center: "center center"
} as const;
export type TransformOrigin = typeof TransformOrigin[keyof typeof TransformOrigin];

function duration({ milliseconds, isReduced }: {
  milliseconds: number;
  isReduced: boolean;
}) {
  return isReduced ? 0 : milliseconds;
}

// Fades in while rising `rise` px into place and growing from `scaleFrom`, about `origin`
export function riseIn({ rise, scaleFrom = 1, isReduced, origin = TransformOrigin.bottom }: {
  rise: number;
  scaleFrom?: number;
  isReduced: boolean;
  origin?: TransformOrigin;
}) {
  return (_node: unknown) => ({
    duration: duration({
      milliseconds: OverlayMotion.enterMilliseconds,
      isReduced
    }),
    css(progress: number) {
      const eased = emphasizedDecelerate(progress);
      const scale = scaleFrom + (1 - scaleFrom) * eased;
      return `opacity: ${eased}; translate: 0 ${(1 - eased) * rise}px; scale: ${scale}; transform-origin: ${origin}`;
    }
  });
}

// The selection's brackets settle in from slightly larger, about the selection's centre
export function settleIn({ scaleFrom, isReduced }: {
  scaleFrom: number;
  isReduced: boolean;
}) {
  return riseIn({
    rise: 0,
    scaleFrom,
    isReduced,
    origin: TransformOrigin.center
  });
}

// A white sheen that starts at `from` and fades to nothing
export function sheenIn({ from, isReduced }: {
  from: number;
  isReduced: boolean;
}) {
  return (_node: unknown) => ({
    duration: duration({
      milliseconds: OverlayMotion.enterMilliseconds,
      isReduced
    }),
    css(progress: number) {
      return `opacity: ${from * (1 - standardEase(progress))}`;
    }
  });
}

export function fadeOut({ isReduced }: { isReduced: boolean }) {
  return (_node: unknown) => ({
    duration: duration({
      milliseconds: OverlayMotion.exitMilliseconds,
      isReduced
    }),
    css(progress: number) {
      return `opacity: ${linearEase(progress)}`;
    }
  });
}
