<script lang="ts">
  import { menuOf } from "./menu.ts";
  import { sendAction } from "@/lib/view.svelte.ts";
  import { PillActionKind } from "@gemini-live/protocol/view";
  import { MenuFlyout, MenuFlyoutItem } from "winui-svelte/components";
  import { clipboard } from "winui-svelte/data-transfer";

  interface Props {
    uri: string;
  }

  const props: Props = $props();
  const menu = menuOf();
</script>

<MenuFlyout {...menu.props} {@attach menu.attach}>
  <MenuFlyoutItem
    onclick={() => sendAction({
      kind: PillActionKind.openLink,
      uri: props.uri
    })}
    text="Open link"
  />
  <MenuFlyoutItem onclick={() => clipboard.writeText(props.uri)} text="Copy link address" />
</MenuFlyout>
