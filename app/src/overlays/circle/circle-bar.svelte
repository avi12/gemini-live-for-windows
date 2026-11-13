<script lang="ts">
  import { barPlacement, BarSide } from "@/overlays/circle/gesture/geometry.ts";
  import { riseIn } from "@/overlays/motion/transitions.ts";
  import type { Rect, Size } from "@/overlays/shapes.ts";
  import "@gemini-live/pill/theme.css";
  import type { Snippet } from "svelte";
  import { elementSize } from "winui-svelte";
  import { StackPanel } from "winui-svelte/components";
  import type { PointerEvent } from "winui-svelte/input";
  import { mediaQuery } from "winui-svelte/window";

  interface Props {
    selection: Rect;
    screen: Size;
    children: Snippet;
  }

  const { selection, screen, children }: Props = $props();

  // How far the bar's entrance travels: up into place below or inside the selection, down into
  // place above it, and no slide beside it (a vertical rise there would read as drifting)
  const BAR_RISE = 24;
  const BAR_SCALE_FROM = 0.94;
  const BUTTON_GAP = 8;
  const SIDE_RISE = {
    [BarSide.BELOW]: BAR_RISE,
    [BarSide.INSIDE]: BAR_RISE,
    [BarSide.ABOVE]: -BAR_RISE,
    [BarSide.LEFT]: 0,
    [BarSide.RIGHT]: 0
  } as const;

  const bar = elementSize();
  const reducedMotion = mediaQuery("(prefers-reduced-motion: reduce)");

  const placement = $derived(
    barPlacement({
      selection,
      bar: {
        width: bar.desiredWidth,
        height: bar.desiredHeight
      },
      screen
    })
  );

  const enter = $derived(
    riseIn({
      rise: SIDE_RISE[placement.side],
      scaleFrom: BAR_SCALE_FROM,
      isReduced: reducedMotion.matches
    })
  );
</script>

<!-- A press on the bar's own surface (between buttons) must not start a new loop under it -->
<border
  style:left="{placement.origin.x}px"
  style:top="{placement.origin.y}px"
  class="circle-bar circle-bar-frame"
  {@attach bar.attach}
  onpointerdown={(event: PointerEvent) => event.stopPropagation()}
  role="presentation"
  in:enter
>
  <StackPanel orientation="Horizontal" spacing={BUTTON_GAP}>
    {@render children()}
  </StackPanel>
</border>

<style>
  .circle-bar-frame {
    position: absolute;
    padding: 8px;
  }
</style>
