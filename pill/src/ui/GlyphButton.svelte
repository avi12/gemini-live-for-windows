<script lang="ts">
  import { GlyphButtonKind } from "@/ui/glyph-button.ts";
  import GlyphFace from "@/ui/GlyphFace.svelte";
  import type { Glyph } from "@/ui/glyphs.ts";
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
    isSpaced?: boolean;
    isHitTestVisible?: boolean;
    hasChevron?: boolean;
    onpress?: () => void;
    flyout?: Snippet | undefined;
  }

  const props: Props = $props();

  const isShare = $derived(props.kind === GlyphButtonKind.share);

  const buttonClass = $derived.by(() => {
    if (isShare) {
      return ["live-share-button", props.isSpaced === true && "live-spaced"];
    }

    return ["live-round-button", props.isSpaced === true && "live-spaced"];
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
    hasChevron={props.hasChevron === true}
    isMuted={props.isMuted === true}
    kind={props.kind}
  />
</Button>
