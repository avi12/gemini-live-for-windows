<script lang="ts">
  import { Glyph } from "@/ui/glyph/glyphs.ts";
  import type { PillLink } from "@gemini-live/protocol/view";
  import { FontIcon, Image } from "winui-svelte/components";

  interface Props {
    link: PillLink;
  }

  const { link }: Props = $props();

  const ICON_SIZE = 18;

  // A page whose icon could not be had wears the generic link icon, as a search page wears its own
  const failure: { isFailed: boolean } = $state({ isFailed: false });

  const glyph = $derived(link.isSearch ? Glyph.SEARCH : Glyph.LINK);
  const isGlyphShown = $derived(link.isSearch || failure.isFailed);

  // A chip is reused for another link while the tray updates
  $effect(() => {
    void link.faviconUri;
    failure.isFailed = false;
  });
</script>

{#if isGlyphShown}
  <FontIcon class="live-icon live-primary-text link-icon-glyph" fontSize={ICON_SIZE} {glyph} />
{:else}
  <Image
    class="link-icon-image"
    height={ICON_SIZE}
    onimagefailed={() => {
      failure.isFailed = true;
    }}
    source={link.faviconUri}
    stretch="Uniform"
    width={ICON_SIZE}
  />
{/if}

<style>
  .link-icon-glyph,
  .link-icon-image {
    align-self: center;
  }
</style>
