<script lang="ts">
  import BarPreview from "@/overlays/circle/bar-preview.svelte";
  import CircleAction from "@/overlays/circle/circle-action.svelte";
  import { CopyLabel } from "@/overlays/circle/gesture/gesture.ts";
  import { OverlayGlyph } from "@/overlays/glyphs.ts";
  import { SelectKey } from "@/overlays/region/select-keys.ts";
  import { CircleKeyCombination, keyName } from "@/overlays/window/hotkeys.ts";
  import "@gemini-live/pill/theme.css";
  import { ProgressRing, StackPanel, TextBlock } from "winui-svelte/components";
  import type { PointerEvent } from "winui-svelte/input";

  interface Props {
    // What the window says over the picture (reading, no text found); undefined says nothing
    hint: string | undefined;
    // Shows the reading spinner beside the hint
    isReading: boolean;
    // Done has something to take only once words are picked
    isDoneEnabled: boolean;
    // The picked words, as Done would copy them, shown above the buttons
    preview: string | undefined;
    // Done has copied them: the button says so for a moment before the window closes
    isCopied: boolean;
    // Cancel: close with nothing taken
    oncancel: () => void;
    // Done: take what is picked and close
    ondone: () => void;
  }

  const { hint, isReading, isDoneEnabled, preview, isCopied, oncancel, ondone }: Props = $props();

  const CANCEL_LABEL = "Cancel";
  const DONE_LABEL = "Done";
  const SPACING = 10;
  const BAR_SPACING = 12;
</script>

{#if hint !== undefined}
  <border class="circle-hint region-text-hint" isHitTestVisible={false}>
    <StackPanel orientation="Horizontal" spacing={SPACING}>
      {#if isReading}
        <ProgressRing class="region-text-progress" isActive />
      {/if}
      <TextBlock class="circle-hint-text" verticalAlignment="Center">{hint}</TextBlock>
    </StackPanel>
  </border>
{/if}

<!-- A press on the bar's own surface must not start a pick under it -->
<border
  class="circle-bar region-text-bar"
  onpointerdown={(event: PointerEvent) => event.stopPropagation()}
  role="presentation"
>
  <StackPanel orientation="Vertical">
    <BarPreview text={preview} />
    <StackPanel orientation="Horizontal" spacing={BAR_SPACING}>
      <CircleAction
        isLabelled={false}
        isPrimary={false}
        label={CANCEL_LABEL}
        onpress={oncancel}
        shortcut={keyName(CircleKeyCombination.escape)}
      >
        {#snippet icon()}
          <TextBlock class="circle-icon region-text-icon">{OverlayGlyph.close}</TextBlock>
        {/snippet}
      </CircleAction>
      <CircleAction
        isDisabled={!isDoneEnabled}
        isLabelled
        isPrimary
        label={isCopied ? CopyLabel.COPIED : DONE_LABEL}
        onpress={ondone}
        shortcut={SelectKey.DONE}
      />
    </StackPanel>
  </StackPanel>
</border>

<style>
  .region-text-hint {
    align-self: start;
    justify-self: center;
    margin-top: 12px;
    padding: 10px 18px;
  }

  .region-text-bar {
    align-self: end;
    justify-self: center;
    margin-bottom: 10px;
    padding: 8px;
  }

  .region-text-progress {
    width: 20px;
    height: 20px;
  }

  .region-text-icon {
    font-family: "Material Symbols Rounded";
    font-size: 18px;
  }
</style>
