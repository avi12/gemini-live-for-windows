<script lang="ts">
  import { CHIP_ACTION_LABELS, CHIP_TITLES, chipActions } from "@/overlays/circle/chips/chip.ts";
  import type { Chip, ChipAction } from "@/overlays/circle/chips/chip.ts";
  import { riseIn } from "@/overlays/motion/transitions.ts";
  import type { Rect } from "@/overlays/shapes.ts";
  import "@gemini-live/pill/theme.css";
  import { Button, StackPanel, TextBlock } from "winui-svelte/components";
  import type { PointerEvent } from "winui-svelte/input";
  import { mediaQuery } from "winui-svelte/window";

  interface Props {
    // The selection the chips sit in, at its top left
    selection: Rect;
    chips: readonly Chip[];
    onpress: (action: ChipAction) => void;
  }

  const { selection, chips, onpress }: Props = $props();

  const CHIP_RISE = 12;
  const CHIP_GAP = 8;
  const LINE_GAP = 4;
  const CHIP_SCALE_FROM = 0.96;
  const reducedMotion = mediaQuery("(prefers-reduced-motion: reduce)");
  const enter = $derived(
    riseIn({
      rise: CHIP_RISE,
      scaleFrom: CHIP_SCALE_FROM,
      isReduced: reducedMotion.matches
    })
  );
</script>

<!-- A press on a chip's own surface must not start a new loop under it -->
<border
  style:left="{selection.x}px"
  style:top="{selection.y}px"
  class="circle-chips"
  onpointerdown={(event: PointerEvent) => event.stopPropagation()}
  role="presentation"
>
  <StackPanel orientation="Vertical" spacing={CHIP_GAP}>
    {#each chips as chip (chip.id)}
      <border class="circle-bar circle-chip" in:enter>
        <StackPanel orientation="Vertical" spacing={LINE_GAP}>
          <TextBlock class="circle-chip-title" text={CHIP_TITLES[chip.kind]} />
          <TextBlock class="circle-chip-label" text={chip.label} textTrimming="CharacterEllipsis" />
          <StackPanel orientation="Horizontal" spacing={CHIP_GAP}>
            {#each chipActions(chip) as action (action.kind)}
              <Button class="circle-action circle-chip-button" onclick={() => onpress(action)}>
                <TextBlock text={CHIP_ACTION_LABELS[action.kind]} />
              </Button>
            {/each}
          </StackPanel>
        </StackPanel>
      </border>
    {/each}
  </StackPanel>
</border>

<style>
  .circle-chips {
    position: absolute;
    max-width: 360px;
    margin: 8px;
  }

  .circle-chip {
    padding: 10px 14px;
    border-radius: 16px;
  }

  .circle-chip-title {
    font-size: 12px;
    opacity: 0.7;
  }

  .circle-chip-label {
    font-size: 14px;
  }

  .circle-chip-button {
    height: 32px;
    padding: 0 14px;
    border-width: 0;
    border-radius: 16px;
    font-size: 14px;
  }
</style>
