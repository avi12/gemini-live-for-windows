<script lang="ts">
  import { GlyphButtonKind } from "@/ui/glyph/glyph-button.ts";
  import type { Glyph } from "@/ui/glyph/glyphs.ts";
  import GlyphFace from "@/ui/GlyphFace.svelte";
  import { trackPart } from "@/ui/places.svelte.ts";
  import type { PillPart } from "@/ui/places.svelte.ts";
  import type { Snippet } from "svelte";
  import { Button } from "winui-svelte/components";

  interface Props {
    glyph: Glyph;
    glyphSize: number;
    kind: GlyphButtonKind;
    part: PillPart;
    column: number;
    label: string;
    toolTip?: string | undefined;
    isMuted?: boolean;
    isHitTestVisible?: boolean;
    onpress?: () => void;
    flyout?: Snippet | undefined;
  }

  const props: Props = $props();

  const buttonClass = $derived.by(() => {
    const isAccent = props.kind === GlyphButtonKind.accent;
    if (isAccent) {
      return "live-round-button live-accent-round";
    }

    return "live-round-button";
  });

  const flyoutProps = $derived(props.flyout === undefined ? {} : { flyout: props.flyout });

  function ignorePress() {}
</script>

<Button
  class={buttonClass}
  {@attach trackPart(props.part)}
  automationName={props.label}
  {...flyoutProps}
  gridColumn={props.column}
  horizontalContentAlignment="Stretch"
  isHitTestVisible={props.isHitTestVisible ?? true}
  onclick={props.onpress ?? ignorePress}
  toolTip={props.toolTip}
  verticalAlignment="Center"
  verticalContentAlignment="Stretch"
>
  <GlyphFace
    glyph={props.glyph}
    glyphSize={props.glyphSize}
    isMuted={props.isMuted === true}
    kind={props.kind}
  />
</Button>
