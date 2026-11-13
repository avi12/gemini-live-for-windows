<script lang="ts">
  import MenuHeader from "./MenuHeader.svelte";
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import { EngineKind, PillActionKind } from "@gemini-live/protocol/view";
  import { MenuFlyoutItem, RadioMenuFlyoutItem } from "winui-svelte/components";

  const ENGINE_GROUP = "engine";

  const CHOICES = [
    {
      kind: EngineKind.GOOGLE,
      name: "Your Gemini subscription",
      detail: "Your Gemini subscription, through Google's own web client and the browser extension. Unofficial: Google may suspend an account that uses it."
    },
    {
      kind: EngineKind.API_KEY,
      name: "Your API key",
      detail: "The public Gemini Live API, billed to your key. No extension, and your Google account isn't involved."
    }
  ] as const;

  const isChangeKeyShown = $derived(view.engine === EngineKind.API_KEY);
</script>

<MenuHeader title="Gemini runs on" />
{#each CHOICES as choice (choice.kind)}
  <RadioMenuFlyoutItem
    groupName={ENGINE_GROUP}
    isChecked={view.engine === choice.kind}
    onclick={() => sendAction({
      kind: PillActionKind.SET_ENGINE,
      engine: choice.kind
    })}
    text={choice.name}
    toolTip={choice.detail}
  />
{/each}
{#if isChangeKeyShown}
  <MenuFlyoutItem onclick={() => sendAction({ kind: PillActionKind.ASK_FOR_KEY })} text="Change API key…" />
{/if}
