<script lang="ts">
  import { voice } from "@/lib/voice-level.svelte.ts";
  import { Motion } from "@/ui/motion/motion.ts";
  import { linear } from "svelte/easing";
  import { Tween } from "svelte/motion";
  import { mediaQuery } from "winui-svelte/window";

  const BAR_COUNT = 12;
  const REST_HEIGHT = 4;
  const PEAK_HEIGHT = 40;
  const LEVEL_BOOST = 3;
  const IDLE_ACTIVITY = 0.1;
  const TICK_MILLISECONDS = 60;
  const PHASE_STEP = 0.45;
  const PHASE_SPREAD = 0.8;
  const SHIMMER_FLOOR = 0.55;
  const TAPER = 0.55;
  const HALF_BAR = 0.5;

  const reducedMotion = mediaQuery("(prefers-reduced-motion: reduce)");

  const envelope = Array.from({ length: BAR_COUNT }, (_, iBar) => {
    const centered = (iBar + HALF_BAR) / BAR_COUNT * 2 - 1;
    return 1 - TAPER * centered * centered;
  });

  const smoothLevel = new Tween(0);
  let phase = $state(0);

  const activity = $derived(IDLE_ACTIVITY + (1 - IDLE_ACTIVITY) * smoothLevel.current);

  const heights = $derived(
    envelope.map((weight, iBar) => {
      const shimmer = SHIMMER_FLOOR + (1 - SHIMMER_FLOOR) * Math.abs(Math.sin(phase + iBar * PHASE_SPREAD));
      return REST_HEIGHT + (PEAK_HEIGHT - REST_HEIGHT) * weight * activity * shimmer;
    })
  );

  $effect(() => {
    void smoothLevel.set(Math.min(1, voice.level * LEVEL_BOOST), {
      duration: Motion.FOLLOW_MILLISECONDS,
      easing: linear
    });
  });

  $effect(() => {
    if (reducedMotion.matches) {
      return;
    }

    const timer = setInterval(() => {
      phase += PHASE_STEP;
    }, TICK_MILLISECONDS);
    return () => clearInterval(timer);
  });
</script>

<stack-panel class="wave">
  {#each heights as height, iBar (iBar)}
    <border style:height="{height}px" class="live-wave-bar"></border>
  {/each}
</stack-panel>

<style>
  .wave {
    display: flex;
    flex-direction: row;
    gap: 4px;
    align-items: center;
    align-self: center;
    justify-self: center;
  }
</style>
