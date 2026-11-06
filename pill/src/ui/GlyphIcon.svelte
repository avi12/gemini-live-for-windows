<script lang="ts">
  import { isAnimatable } from "@/ui/animatable.ts";
  import { GlyphButtonKind } from "@/ui/glyph-button.ts";
  import type { Glyph } from "@/ui/glyphs.ts";
  import { Motion } from "@/ui/motion.ts";
  import { FontIcon } from "winui-svelte/components";

  interface Props {
    glyph: Glyph;
    glyphSize: number;
    kind: GlyphButtonKind;
    isMuted: boolean;
    isBouncing: boolean;
  }

  const props: Props = $props();

  let shownGlyph: Glyph | undefined;

  const isShare = $derived(props.kind === GlyphButtonKind.share);

  const iconClass = $derived.by(() => {
    if (props.isMuted) {
      return "live-icon live-glyph-muted";
    }

    if (isShare) {
      return "live-icon live-glyph-share";
    }

    return "live-icon live-glyph-round";
  });

  function bounce(node: object) {
    const { glyph } = props;
    const isGlyphChanged = shownGlyph !== undefined && shownGlyph !== glyph;
    shownGlyph = glyph;

    const isStatic = !isGlyphChanged || !props.isBouncing || !isAnimatable(node);
    if (isStatic) {
      return;
    }

    const animation = node.animate(
      [{ scale: 1 }, { scale: Motion.bounceScale }, { scale: 1 }],
      { duration: Motion.bounceMilliseconds * 2 }
    );
    return () => animation.cancel();
  }
</script>

<FontIcon class={iconClass} {@attach bounce} fontSize={props.glyphSize} glyph={props.glyph} />
