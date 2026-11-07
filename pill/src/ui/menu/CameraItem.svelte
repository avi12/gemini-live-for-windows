<script lang="ts">
  import MenuHeader from "./MenuHeader.svelte";
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import { PillActionKind } from "@gemini-live/protocol/view";
  import { ToggleMenuFlyoutItem } from "winui-svelte/components";
</script>

<MenuHeader title="Share" />
<ToggleMenuFlyoutItem
  isChecked={view.isCameraShared}
  onclick={() => sendAction({
    kind: PillActionKind.setCamera,
    isOn: !view.isCameraShared
  })}
  text="Camera instead of screen"
/>
