<script lang="ts">
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import LinkIcon from "@/ui/caption/LinkIcon.svelte";
  import LinkMenu from "@/ui/menu/LinkMenu.svelte";
  import { Motion } from "@/ui/motion/motion.ts";
  import { isUntitledLink, PillActionKind } from "@gemini-live/protocol/view";
  import type { PillLink } from "@gemini-live/protocol/view";
  import { SvelteSet } from "svelte/reactivity";
  import { scale } from "svelte/transition";
  import {
    Button,
    InlineUIContainer,
    Paragraph,
    RichTextBlock,
    StackPanel,
    TextBlock
  } from "winui-svelte/components";

  const CHIP_SCALE_FROM = 0.9;
  const TRAY_GAP_BELOW_TRANSCRIPT = 10;

  const hasLines = $derived(view.lines.length > 0);

  // The links whose title the chip cuts short: only those repeat the full title in the tooltip, above
  // the URL; a title shown whole is not said twice
  const trimmedTitles = new SvelteSet<string>();

  function markTrimmed({ id, isTrimmed }: { id: string; isTrimmed: boolean }) {
    if (isTrimmed) {
      trimmedTitles.add(id);
      return;
    }

    trimmedTitles.delete(id);
  }

  // The tooltip names the full URL, the one the chip opens and Copy link address copies, and above it
  // the title when the chip cut it short. A page with no title of its own is titled by its short
  // address, which the URL already says.
  function isTitleInTip(link: PillLink) {
    return !isUntitledLink(link) && trimmedTitles.has(link.id);
  }

  const trayTop = $derived.by(() => {
    if (hasLines) {
      return TRAY_GAP_BELOW_TRANSCRIPT;
    }

    return 0;
  });

  function open(uri: string) {
    sendAction({
      kind: PillActionKind.OPEN_LINK,
      uri
    });
  }
</script>

<RichTextBlock style:margin-top="{trayTop}px" class="tray" isTextSelectionEnabled={false}>
  <Paragraph>
    {#each view.links as link, iLink (link.id)}
      <InlineUIContainer>
        <border
          class="slot"
          in:scale={{
            start: CHIP_SCALE_FROM,
            delay: iLink * Motion.STAGGER_MILLISECONDS,
            duration: Motion.STANDARD_MILLISECONDS
          }}
        >
          <Button
            class="live-chip chip"
            onclick={() => open(link.uri)}
          >
            {#snippet toolTip()}
              <StackPanel>
                {#if isTitleInTip(link)}
                  <TextBlock class="tip-title">{link.title}</TextBlock>
                {/if}
                <TextBlock class="live-primary-text tip-url">{link.uri}</TextBlock>
              </StackPanel>
            {/snippet}
            {#snippet contextFlyout()}
              <LinkMenu uri={link.uri} />
            {/snippet}
            <StackPanel class="chip-face">
              <LinkIcon {link} />
              <TextBlock class="live-label chip-title"                bind:isTextTrimmed={() => trimmedTitles.has(link.id), isTrimmed => markTrimmed({ id: link.id, isTrimmed })}
              >
                {link.title}
              </TextBlock>
            </StackPanel>
          </Button>
        </border>
      </InlineUIContainer>
    {/each}
  </Paragraph>
</RichTextBlock>

<style>
  /* The tray's text and its buttons each ask for a cursor, and where they overlap it flickers between
     them: the tray says arrow, the chips say hand */
  .tray {
    margin-bottom: -8px;
    cursor: default;
  }

  .slot {
    margin-right: 8px;
    margin-bottom: 8px;
  }

  .chip {
    height: 32px;
    cursor: pointer;
  }

  .chip-face {
    display: flex;
    flex-direction: row;
    gap: 8px;
  }

  .tip-title {
    text-wrap: wrap;
  }

  /* The address in the accent colour, a size down, so it reads apart from the title above it */
  .tip-url {
    font-size: 12px;
    text-wrap: wrap;
  }

  .chip-title {
    align-self: center;
    max-width: 340px;
    font-weight: 500;
    text-overflow: ellipsis;
  }
</style>
