<script lang="ts">
  import "./theme.css";
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import { PillActionKind } from "@/protocol/view.ts";
  import { Glyph } from "@/ui/glyphs.ts";
  import { Motion } from "@/ui/motion.ts";
  import { scale } from "svelte/transition";
  import {
    Button,
    FontIcon,
    InlineUIContainer,
    MenuFlyout,
    MenuFlyoutItem,
    Paragraph,
    RichTextBlock,
    StackPanel,
    TextBlock
  } from "winui-svelte/components";
  import { clipboard } from "winui-svelte/data-transfer";

  const CHIP_ICON_SIZE = 18;
  const CHIP_SCALE_FROM = 0.9;
  const TRAY_GAP_BELOW_TRANSCRIPT = 10;

  const hasLines = $derived(view.lines.length > 0);

  const trayTop = $derived.by(() => {
    if (hasLines) {
      return TRAY_GAP_BELOW_TRANSCRIPT;
    }

    return 0;
  });

  function glyphOf(isSearch: boolean) {
    if (isSearch) {
      return Glyph.search;
    }

    return Glyph.link;
  }

  function open(uri: string) {
    sendAction({
      kind: PillActionKind.openLink,
      uri
    });
  }
</script>

<RichTextBlock style:margin-top="{trayTop}px" class="tray">
  <Paragraph>
    {#each view.links as link, iLink (link.id)}
      <InlineUIContainer>
        <border
          class="slot"
          in:scale={{
            start: CHIP_SCALE_FROM,
            delay: iLink * Motion.staggerMilliseconds,
            duration: Motion.standardMilliseconds
          }}
        >
          <Button
            class="live-chip chip"
            onclick={() => open(link.uri)}
            toolTip={link.address}
          >
            {#snippet contextFlyout()}
              <MenuFlyout placement="Top" shouldConstrainToRootBounds={false}>
                <MenuFlyoutItem onclick={() => open(link.uri)} text="Open link" />
                <MenuFlyoutItem onclick={() => clipboard.writeText(link.uri)} text="Copy link address" />
              </MenuFlyout>
            {/snippet}
            <StackPanel class="chip-face">
              <FontIcon class="live-icon chip-icon" fontSize={CHIP_ICON_SIZE} glyph={glyphOf(link.isSearch)} />
              <TextBlock class="live-label chip-title" textTrimming="CharacterEllipsis">{link.title}</TextBlock>
            </StackPanel>
          </Button>
        </border>
      </InlineUIContainer>
    {/each}
  </Paragraph>
</RichTextBlock>

<style>
  .tray {
    margin-bottom: -8px;
  }

  .slot {
    margin-right: 8px;
    margin-bottom: 8px;
  }

  .chip {
    height: 32px;
  }

  .chip-face {
    display: flex;
    flex-direction: row;
    gap: 8px;
  }

  .chip-icon {
    align-self: center;
    color: var(--live-primary);
  }

  .chip-title {
    align-self: center;
    max-width: 340px;
    font-weight: 500;
  }
</style>
