<script lang="ts">
  import MenuHeader from "./MenuHeader.svelte";
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import { PillActionKind } from "@/protocol/view.ts";
  import { RadioMenuFlyoutItem } from "winui-svelte/components";

  const MICROPHONE_GROUP = "microphone";
  const DEFAULT_MICROPHONE_NAME = "Default (Windows)";

  const choices = $derived([
    {
      id: null,
      name: DEFAULT_MICROPHONE_NAME
    },
    ...view.microphones
  ]);
</script>

<MenuHeader title="Microphone" />
{#each choices as choice (choice.id)}
  <RadioMenuFlyoutItem
    groupName={MICROPHONE_GROUP}
    isChecked={view.microphoneId === choice.id}
    onclick={() => sendAction({
      kind: PillActionKind.setMicrophone,
      microphoneId: choice.id
    })}
    text={choice.name}
  />
{/each}
