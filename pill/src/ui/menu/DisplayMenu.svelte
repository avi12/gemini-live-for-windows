<script lang="ts">
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import { PillActionKind } from "@/protocol/view.ts";
  import { MenuFlyout, ToggleMenuFlyoutItem } from "winui-svelte/components";
</script>

<MenuFlyout placement="Top" shouldConstrainToRootBounds={false}>
  {#each view.displays as display (display.id)}
    <ToggleMenuFlyoutItem
      isChecked={view.sharedDisplay === display.id}
      onclick={() => sendAction({
        kind: PillActionKind.share,
        displayId: display.id
      })}
      text={display.name}
    />
  {/each}
</MenuFlyout>
