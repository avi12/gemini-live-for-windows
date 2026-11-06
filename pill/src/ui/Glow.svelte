<script lang="ts">
  import { view } from "@/lib/view.svelte.ts";
  import { GlowMode } from "@/protocol/view.ts";
  import { emphasizedDecelerate } from "@/ui/easing.ts";
  import { Motion } from "@/ui/motion.ts";
  import type { Snippet } from "svelte";
  import { linear } from "svelte/easing";
  import { Tween } from "svelte/motion";
  import { mediaQuery } from "winui-svelte/window";

  const { children }: { children: Snippet } = $props();

  const REST_OPACITY = 0.35;
  const STEADY_OPACITY = 0.75;
  const BREATHE_LOW = 0.5;
  const BREATHE_HIGH = 1;
  const BREATHE_MILLISECONDS = 1400;
  const LEVEL_FLOOR = 0.45;
  const LEVEL_BOOST = 3;
  const GEMINI_GAIN = 0.55;
  const USER_GAIN = 0.35;
  const QUIET_LEVEL = 0.02;

  const reducedMotion = mediaQuery("(prefers-reduced-motion: reduce)");

  let followedOpacity = $state(REST_OPACITY);

  const isBreathingMode = $derived(view.glow.mode === GlowMode.breathe);
  const isBreathing = $derived(isBreathingMode && !reducedMotion.matches && view.isShown);
  const isFollowing = $derived(view.glow.mode === GlowMode.level);

  const opacity = $derived.by(() => {
    if (!view.isShown) {
      return 0;
    }

    if (isFollowing) {
      return followedOpacity;
    }

    if (isBreathingMode) {
      return STEADY_OPACITY;
    }

    return REST_OPACITY;
  });

  const shownOpacity = new Tween(0);

  // The blurred band is drawn as a sprite of its own, which does not take the pill's fade, so it
  // follows the pill's enter and exit itself, on the same curves
  const timing = $derived.by(() => {
    if (!view.isShown) {
      return {
        duration: Motion.exitMilliseconds,
        easing: linear
      };
    }

    if (isFollowing) {
      return {
        duration: Motion.followMilliseconds,
        easing: linear
      };
    }

    return {
      duration: Motion.enterMilliseconds,
      easing: emphasizedDecelerate
    };
  });

  $effect(() => {
    void shownOpacity.set(opacity, timing);
  });

  $effect(() => {
    const { level, isUser } = view.glow;
    if (!isFollowing) {
      return;
    }

    const isUserQuiet = isUser && level < QUIET_LEVEL;
    if (isUserQuiet) {
      return;
    }

    const gain = isUser ? USER_GAIN : GEMINI_GAIN;
    followedOpacity = LEVEL_FLOOR + Math.min(1, level * LEVEL_BOOST) * gain;
  });

  function breathe(node: HTMLElement) {
    if (!isBreathing) {
      return;
    }

    const animation = node.animate(
      [{ opacity: BREATHE_LOW }, { opacity: BREATHE_HIGH }],
      {
        duration: BREATHE_MILLISECONDS,
        iterations: Infinity,
        direction: "alternate",
        easing: "ease-in-out"
      }
    );
    return () => animation.cancel();
  }
</script>

<grid class="glow-and-pill">
  <grid class="live-glow-peak">
    <border style:opacity={shownOpacity.current} class="glow" {@attach breathe}></border>
  </grid>
  {@render children()}
</grid>

<style>
  .glow-and-pill {
    display: grid;
  }

  .glow {
    margin-top: 36px;
    margin-right: 8px;
    margin-bottom: -6px;
    margin-left: 8px;
    border-radius: 34px;
    background-image: linear-gradient(to right, #4285f4 0%, #b36bf0 40%, #f06292 70%, #fbbc04 100%);
    filter: blur(24px);
  }
</style>
