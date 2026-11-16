<script lang="ts">
  import { menuOf } from "./menu.ts";
  import { sendAction } from "@/lib/view.svelte.ts";
  import { Glyph } from "@/ui/glyph/glyphs.ts";
  import { PillActionKind } from "@gemini-live/protocol/view";
  import { FontIcon, MenuFlyout, MenuFlyoutItem } from "winui-svelte/components";
  interface Props {
    uri: string;
  }

  const props: Props = $props();
  const menu = menuOf();
</script>

<MenuFlyout {...menu.props} {@attach menu.attach}>
  <MenuFlyoutItem
    onclick={() => sendAction({
      kind: PillActionKind.OPEN_LINK,
      uri: props.uri
    })}
    text="Open link"
  >
    {#snippet icon()}
      <FontIcon class="live-icon" glyph={Glyph.LINK} />
    {/snippet}
  </MenuFlyoutItem>
  <MenuFlyoutItem
    onclick={() => sendAction({
      kind: PillActionKind.COPY_TEXT,
      text: props.uri
    })}
    text="Copy link address"
  >
    {#snippet icon()}
      <FontIcon class="live-icon" glyph={Glyph.COPY} />
    {/snippet}
  </MenuFlyoutItem>
</MenuFlyout>
