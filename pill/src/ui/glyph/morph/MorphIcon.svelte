<script lang="ts">
  import "@/ui/theme.css";
  import { emphasizedDecelerate } from "@/ui/motion/easing.ts";
  import { Motion } from "@/ui/motion/motion.ts";
  import { untrack } from "svelte";
  import { Tween } from "svelte/motion";
  import { Path } from "winui-svelte/components";

  interface Props {
    // Which of its two icons it shows: it morphs from one to the other when this changes
    isSecond: boolean;
    // Draws any moment between the two icons, 0 the first and 1 the second, as path data in pixels
    pathData: (options: { progress: number; size: number }) => string;
    size: number;
    // A `live-path-*` class of theme.css, for the fill
    class: string;
  }

  const { isSecond, pathData, size, class: fillClass }: Props = $props();

  const target = $derived(isSecond ? 1 : 0);
  // Born at rest on its icon, then glides to the other on a change
  const progress = new Tween(untrack(() => target), {
    duration: Motion.ICON_MORPH_MILLISECONDS,
    easing: emphasizedDecelerate
  });

  $effect(() => {
    void progress.set(target);
  });

  const data = $derived(
    pathData({
      progress: progress.current,
      size
    })
  );
</script>

<Path class={fillClass} {data} height={size} width={size} />
