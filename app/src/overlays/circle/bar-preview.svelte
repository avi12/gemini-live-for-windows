<script lang="ts">
  import { TextBlock } from "winui-svelte/components";

  interface Props {
    // The words picked so far, as they would be copied; undefined shows nothing
    text: string | undefined;
  }

  const { text }: Props = $props();

  const MAX_LINES = 3;
</script>

<!-- What a copy would take, above the buttons, so the user sees what the reading picked up -->
{#if text !== undefined}
  <TextBlock
    class="circle-hint-text bar-preview"
    horizontalTextAlignment="DetectFromContent"
    maxLines={MAX_LINES}
    textReadingOrder="DetectFromContent"
    textTrimming="CharacterEllipsis"
    textWrapping="Wrap">{text}</TextBlock
  >
{/if}

<style>
  .bar-preview {
    max-width: 320px;
    margin: 6px 12px;
    margin-bottom: 12px;
    font-size: 14px;
  }
</style>
