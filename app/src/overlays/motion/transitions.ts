import { emphasizedDecelerate, linearEase, OverlayMotion, standardEase } from "@/overlays/motion/motion.ts";

// Svelte transitions for the overlays, on the emphasized curves (Motion.Enter in the C#). Never the
// transform shorthand: translate and scale are their own properties. With reduced motion the
// duration is zero, so every move lands on its final value at once.

export const TransformOrigin = {
  BOTTOM: "center bottom",
  TOP: "center top"
} as const;
export type TransformOrigin = (typeof TransformOrigin)[keyof typeof TransformOrigin];

function duration({ milliseconds, isReduced }: { milliseconds: number; isReduced: boolean }) {
  return isReduced ? 0 : milliseconds;
}

// Fades in while rising `rise` px into place and growing from `scaleFrom`, about `origin`
export function riseIn({
  rise,
  scaleFrom = 1,
  isReduced,
  origin = TransformOrigin.BOTTOM
}: {
  rise: number;
  scaleFrom?: number;
  isReduced: boolean;
  origin?: TransformOrigin;
}) {
  return (_node: unknown) => ({
    duration: duration({
      milliseconds: OverlayMotion.ENTER_MILLISECONDS,
      isReduced
    }),
    css(progress: number) {
      const eased = emphasizedDecelerate(progress);
      const scale = scaleFrom + (1 - scaleFrom) * eased;
      return `opacity: ${eased}; translate: 0 ${(1 - eased) * rise}px; scale: ${scale}; transform-origin: ${origin}`;
    }
  });
}

// The way out of `riseIn`: fades while sinking `rise` px and shrinking to `scaleTo`, so a set of
// buttons flies out as the next one flies in
export function riseOut({
  rise,
  scaleTo = 1,
  isReduced,
  origin = TransformOrigin.BOTTOM
}: {
  rise: number;
  scaleTo?: number;
  isReduced: boolean;
  origin?: TransformOrigin;
}) {
  return (_node: unknown) => ({
    duration: duration({
      milliseconds: OverlayMotion.EXIT_MILLISECONDS,
      isReduced
    }),
    css(progress: number) {
      const eased = standardEase(progress);
      const scale = scaleTo + (1 - scaleTo) * eased;
      return `opacity: ${eased}; translate: 0 ${(1 - eased) * rise}px; scale: ${scale}; transform-origin: ${origin}`;
    }
  });
}

// A white sheen that starts at `from` and fades to nothing
export function sheenIn({ from, isReduced }: { from: number; isReduced: boolean }) {
  return (_node: unknown) => ({
    duration: duration({
      milliseconds: OverlayMotion.ENTER_MILLISECONDS,
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
      milliseconds: OverlayMotion.EXIT_MILLISECONDS,
      isReduced
    }),
    css(progress: number) {
      return `opacity: ${linearEase(progress)}`;
    }
  });
}
