<script lang="ts">
  import { view } from "@/lib/view.svelte.ts";
  import { voice } from "@/lib/voice-level.svelte.ts";
  import { emphasizedDecelerate } from "@/ui/motion/easing.ts";
  import { Motion } from "@/ui/motion/motion.ts";
  import { GlowMode } from "@gemini-live/protocol/view";
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

  const reducedMotion = mediaQuery("(prefers-reduced-motion: reduce)");

  const followedOpacity = $derived.by(() => {
    const gain = voice.isUser ? USER_GAIN : GEMINI_GAIN;
    return LEVEL_FLOOR + Math.min(1, voice.level * LEVEL_BOOST) * gain;
  });

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
  <border class="live-pill-base"></border>
  <grid style:opacity={shownOpacity.current} class="glow-layers" {@attach breathe}>
    <border class="live-glow"></border>
    <border class="live-glow-highlight"></border>
  </grid>
  {@render children()}
</grid>

<style>
  .glow-and-pill {
    display: grid;
  }

  .glow-and-pill > *,
  .glow-layers > * {
    grid-area: 1 / 1;
  }

  .glow-layers {
    display: grid;
  }
</style>
