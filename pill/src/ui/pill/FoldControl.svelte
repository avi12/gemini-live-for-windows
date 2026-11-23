<script lang="ts">
  import { view } from "@/lib/view.svelte.ts";
  import { collapse, toggleCollapse } from "@/ui/fold/collapse.svelte.ts";
  import { GlyphButtonKind } from "@/ui/glyph/glyph-button.ts";
  import GlyphButton from "@/ui/glyph/GlyphButton.svelte";
  import { foldPathData } from "@/ui/glyph/morph/fold-icon.ts";
  import { micPathData } from "@/ui/glyph/morph/mic-icon.ts";
  import MorphIcon from "@/ui/glyph/morph/MorphIcon.svelte";
  import { Motion } from "@/ui/motion/motion.ts";
  import { PillPart } from "@/ui/window/places.svelte.ts";
  import { fade } from "svelte/transition";
  import { Path } from "winui-svelte/components";

  interface Props {
    glyphSize: number;
  }

  const { glyphSize }: Props = $props();

  const MUTED_BADGE_ICON_SIZE = 14;

  const foldLabel = $derived.by(() => {
    if (collapse.isCollapsed) {
      return "Expand";
    }

    return "Collapse";
  });
</script>

<!-- One button for both forms, so its icon can glide from one to the other: inside either face it
     would be rebuilt by the swap and start at its end shape -->
<grid class="fold">
  <GlyphButton
    column={0}
    {glyphSize}
    kind={GlyphButtonKind.ROUND}
    label={foldLabel}
    onpress={toggleCollapse}
    part={PillPart.COLLAPSE}
    toolTip={foldLabel}
  >
    {#snippet icon()}
      <MorphIcon class="live-path-round" isSecond={collapse.isCollapsed} pathData={foldPathData} size={glyphSize} />
    {/snippet}
  </GlyphButton>
  {#if collapse.isCollapsed && view.isMuted}
    <grid
      class="live-muted-fill muted-badge"
      isHitTestVisible={false}
      transition:fade={{ duration: Motion.STANDARD_MILLISECONDS }}
    >
      <Path
        class="live-path-muted badge-icon"
        data={micPathData({ progress: 1, size: MUTED_BADGE_ICON_SIZE })}
        height={MUTED_BADGE_ICON_SIZE}
        width={MUTED_BADGE_ICON_SIZE}
      />
    </grid>
  {/if}
</grid>

<style>
  /* On the capsule's right end, over whichever face shows, at the same place in both */
  .fold {
    align-self: center;
    justify-self: end;
    margin-right: 18px;
  }

  /* The orb has no mic button to show the mute, so a small badge on its corner does */
  .muted-badge {
    align-self: start;
    justify-self: start;
    width: 22px;
    height: 22px;
    margin-top: -8px;
    margin-left: -8px;
    border-radius: 11px;
  }

  .badge-icon {
    align-self: center;
    justify-self: center;
  }
</style>
