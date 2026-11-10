<script lang="ts">
  import { describeUpdateEntry } from "@/lib/update-entry.ts";
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import { PillActionKind } from "@gemini-live/protocol/view";
  import { MenuFlyoutItem, ToggleMenuFlyoutItem } from "winui-svelte/components";

  const { update } = $derived(view);
  const entry = $derived(update === null ? null : describeUpdateEntry(update));
</script>

{#if entry !== null && update !== null}
  <MenuFlyoutItem onclick={() => sendAction({ kind: entry.kind })} text={entry.text} />
  <ToggleMenuFlyoutItem
    isChecked={update.isAutoUpdateOn}
    onclick={() => sendAction({
      kind: PillActionKind.setAutoUpdate,
      isOn: !update.isAutoUpdateOn
    })}
    text="Check for updates automatically"
  />
{/if}
