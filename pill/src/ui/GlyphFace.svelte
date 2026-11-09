<script lang="ts">
  import "./theme.css";
  import type { GlyphButtonKind } from "@/ui/glyph/glyph-button.ts";
  import GlyphIcon from "@/ui/glyph/GlyphIcon.svelte";
  import type { Glyph } from "@/ui/glyph/glyphs.ts";

  interface Props {
    glyph: Glyph;
    glyphSize: number;
    kind: GlyphButtonKind;
    isMuted: boolean;
  }

  const props: Props = $props();
</script>

<grid class="face">
  <border class="muted-layer" class:shown={props.isMuted}></border>
  <stack-panel class="glyphs">
    <GlyphIcon glyph={props.glyph} glyphSize={props.glyphSize} isBouncing isMuted={props.isMuted} kind={props.kind} />
  </stack-panel>
</grid>

<style>
  .face {
    display: grid;
  }

  .muted-layer {
    border-radius: 20px;
    background-color: var(--live-muted);
    opacity: 0;
    transition: opacity 200ms;
  }

  .muted-layer.shown {
    opacity: 1;
  }

  .glyphs {
    display: flex;
    flex-direction: row;
    align-self: center;
    justify-self: center;
  }
</style>
