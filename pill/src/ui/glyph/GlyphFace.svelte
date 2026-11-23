<script lang="ts">
  import type { GlyphButtonKind } from "@/ui/glyph/glyph-button.ts";
  import GlyphIcon from "@/ui/glyph/GlyphIcon.svelte";
  import type { Glyph } from "@/ui/glyph/glyphs.ts";
  import { Motion } from "@/ui/motion/motion.ts";
  import type { Snippet } from "svelte";
  import { fade } from "svelte/transition";

  interface Props {
    // A font glyph; or `icon`, drawn in its place
    glyph?: Glyph | undefined;
    icon?: Snippet | undefined;
    glyphSize: number;
    kind: GlyphButtonKind;
    isMuted: boolean;
  }

  const props: Props = $props();
</script>

<grid class="face">
  {#if props.isMuted}
    <border class="live-muted-fill muted-layer"transition:fade={{ duration: Motion.STANDARD_MILLISECONDS }}></border>
  {/if}
  <stack-panel class="glyphs">
    {#if props.icon !== undefined}
      {@render props.icon()}
    {:else if props.glyph !== undefined}
      <GlyphIcon glyph={props.glyph} glyphSize={props.glyphSize} isBouncing isMuted={props.isMuted} kind={props.kind} />
    {/if}
  </stack-panel>
</grid>

<style>
  .face {
    display: grid;
  }

  .muted-layer {
    border-radius: 20px;
  }

  .glyphs {
    display: flex;
    flex-direction: row;
    align-self: center;
    justify-self: center;
  }
</style>
