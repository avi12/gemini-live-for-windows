<script lang="ts">
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import { PillActionKind } from "@gemini-live/protocol/view";
  import { MenuFlyoutItem, ToggleMenuFlyoutItem } from "winui-svelte/components";

  const CHECK_TEXT = "Check for updates";

  const entry = $derived.by(() => {
    const { update } = view;
    const isUpdateMissing = update === null;
    if (isUpdateMissing) {
      return null;
    }

    if (update.isAvailable) {
      return {
        kind: PillActionKind.update,
        text: update.text
      };
    }

    return {
      kind: PillActionKind.checkForUpdates,
      text: CHECK_TEXT
    };
  });
</script>

{#if entry !== null && view.update !== null}
  <MenuFlyoutItem onclick={() => sendAction({ kind: entry.kind })} text={entry.text} />
  <ToggleMenuFlyoutItem
    isChecked={view.update.isAutoUpdateOn}
    onclick={() => sendAction({
      kind: PillActionKind.setAutoUpdate,
      isOn: !view.update?.isAutoUpdateOn
    })}
    text="Check for updates automatically"
  />
{/if}
