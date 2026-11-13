<script lang="ts">
  import CameraItem from "./CameraItem.svelte";
  import EnginePicker from "./EnginePicker.svelte";
  import { menuOf } from "./menu.ts";
  import MicrophoneItems from "./MicrophoneItems.svelte";
  import UpdateItems from "./UpdateItems.svelte";
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import { EngineKind, PillActionKind } from "@gemini-live/protocol/view";
  import { MenuFlyout, MenuFlyoutItem, MenuFlyoutSeparator } from "winui-svelte/components";

  const menu = menuOf();
  const isCameraShown = $derived(view.engine === EngineKind.GOOGLE);

  let isOpen = $state(false);

  function setOpen(isNowOpen: boolean) {
    isOpen = isNowOpen;

    if (isNowOpen) {
      sendAction({ kind: PillActionKind.REFRESH_MICROPHONES });
    }
  }
</script>

<MenuFlyout {...menu.props} {@attach menu.attach} bind:open={() => isOpen, setOpen}>
  <MicrophoneItems />
  {#if isCameraShown}
    <MenuFlyoutSeparator />
    <CameraItem />
  {/if}
  <MenuFlyoutSeparator />
  <EnginePicker />
  <MenuFlyoutSeparator />
  <UpdateItems />
  <MenuFlyoutItem onclick={() => sendAction({ kind: PillActionKind.QUIT })} text="Quit Gemini Live" />
</MenuFlyout>
