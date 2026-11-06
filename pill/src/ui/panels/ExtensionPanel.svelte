<script lang="ts">
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import { PillActionKind } from "@/protocol/view.ts";
  import { Button, StackPanel, TextBlock } from "winui-svelte/components";
</script>

<StackPanel class="extension">
  <TextBlock class="live-supporting-text" textWrapping="Wrap">
    Gemini Live uses the Google account you're signed in to in your browser, through a small companion extension.
  </TextBlock>
  <Button
    class="live-accent-button"
    horizontalAlignment="Left"
    onclick={() => sendAction({ kind: PillActionKind.connectExtension })}
  >
    Add the browser extension
  </Button>
  {#if view.isExtensionStepsShown}
    <TextBlock class="live-caption-text live-secondary-text">
      In the extensions page that opened: turn on Developer mode, click Load unpacked,
      and paste the folder path (it's on your clipboard). Gemini Live continues by itself.
    </TextBlock>
  {/if}
</StackPanel>

<style>
  .extension {
    gap: 10px;
    margin-top: 4px;
  }
</style>
