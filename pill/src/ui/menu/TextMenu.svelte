<script lang="ts">
  import { menuOf } from "./menu.ts";
  import { sendAction } from "@/lib/view.svelte.ts";
  import { Glyph } from "@/ui/glyph/glyphs.ts";
  import { PillActionKind } from "@gemini-live/protocol/view";
  import { FontIcon, MenuFlyout, MenuFlyoutItem } from "winui-svelte/components";

  interface Props {
    // The whole line, which Copy takes when nothing in it is selected
    text: string;
    // What is selected in the line's text, empty when nothing is
    selected: () => string;
  }

  const props: Props = $props();
  const menu = menuOf();

  function copy() {
    const selection = props.selected();
    const isSelected = selection.length > 0;
    sendAction({
      kind: PillActionKind.COPY_TEXT,
      text: isSelected ? selection : props.text
    });
  }
</script>

<MenuFlyout {...menu.props} {@attach menu.attach}>
  <MenuFlyoutItem onclick={copy} text="Copy">
    {#snippet icon()}
      <FontIcon class="live-icon" glyph={Glyph.COPY} />
    {/snippet}
  </MenuFlyoutItem>
</MenuFlyout>
