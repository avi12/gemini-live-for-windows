<script lang="ts">
  import CircleCancel from "@/overlays/circle/circle-cancel.svelte";
  import { barPlacement, BarSide } from "@/overlays/circle/gesture/geometry.ts";
  import { riseIn, riseOut } from "@/overlays/motion/transitions.ts";
  import type { Rect, Size } from "@/overlays/shapes.ts";
  import "@gemini-live/pill/theme.css";
  import type { Snippet } from "svelte";
  import { elementSize } from "winui-svelte";
  import { StackPanel } from "winui-svelte/components";
  import { FocusNavigationDirection } from "winui-svelte/enums";
  import { moveFocus } from "winui-svelte/input";
  import type { KeyboardEvent, PointerEvent } from "winui-svelte/input";
  import { mediaQuery } from "winui-svelte/window";

  interface Props {
    selection: Rect;
    screen: Size;
    // The X after the actions: closes the overlay and drops the selection
    oncancel: () => void;
    children: Snippet;
  }

  const { selection, screen, oncancel, children }: Props = $props();

  // How far the bar's entrance travels: up into place below or inside the selection, down into
  // place above it, and no slide beside it (a vertical rise there would read as drifting)
  const BAR_RISE = 24;
  const BAR_SCALE_FROM = 0.94;
  // The pill's own spacing between its round buttons and from its edge
  const BUTTON_GAP = 12;
  const SIDE_RISE = {
    [BarSide.below]: BAR_RISE,
    [BarSide.inside]: BAR_RISE,
    [BarSide.above]: -BAR_RISE,
    [BarSide.left]: 0,
    [BarSide.right]: 0
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

  const ARROW_DIRECTIONS = new Map([
    ["ArrowLeft", FocusNavigationDirection.Left],
    ["ArrowRight", FocusNavigationDirection.Right]
  ]);

  // Tab walks the buttons by itself; the arrows do too, as in a toolbar
  function onarrow(event: KeyboardEvent) {
    const direction = ARROW_DIRECTIONS.get(event.key);
    const isOtherKey = direction === undefined;
    if (isOtherKey) {
      return;
    }

    event.preventDefault();
    moveFocus({
      direction,
      within: event.currentTarget
    });
  }

  const leave = $derived(
    riseOut({
      rise: -SIDE_RISE[placement.side],
      scaleTo: BAR_SCALE_FROM,
      isReduced: reducedMotion.matches
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
  onkeydown={onarrow}
  onpointerdown={(event: PointerEvent) => event.stopPropagation()}
  role="presentation"
  in:enter
  out:leave
>
  <StackPanel orientation="Horizontal" spacing={BUTTON_GAP}>
    {@render children()}
    <CircleCancel onpress={oncancel} />
  </StackPanel>
</border>

<style>
  .circle-bar-frame {
    position: absolute;
    padding: 18px;
  }
</style>
