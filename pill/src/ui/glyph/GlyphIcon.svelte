<script lang="ts">
  import { GlyphButtonKind } from "@/ui/glyph/glyph-button.ts";
  import type { Glyph } from "@/ui/glyph/glyphs.ts";
  import { isAnimatable } from "@/ui/motion/animatable.ts";
  import { Motion } from "@/ui/motion/motion.ts";
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

  const iconClass = $derived.by(() => {
    if (props.isMuted) {
      return "live-icon live-glyph-muted";
    }

    const isAccent = props.kind === GlyphButtonKind.ACCENT;
    if (isAccent) {
      return "live-icon live-glyph-accent";
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
      [{ scale: 1 }, { scale: Motion.BOUNCE_SCALE }, { scale: 1 }],
      { duration: Motion.BOUNCE_MILLISECONDS * 2 }
    );
    return () => animation.cancel();
  }
</script>

<FontIcon class={iconClass} {@attach bounce} fontSize={props.glyphSize} glyph={props.glyph} />
