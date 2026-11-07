<script lang="ts">
  import type { Snippet } from "svelte";
  import { Button, StackPanel, TextBlock } from "winui-svelte/components";

  interface Props {
    label: string;
    // The key that does the same, shown as the tooltip
    shortcut: string;
    isPrimary: boolean;
    isDisabled?: boolean;
    onpress: () => void;
    icon: Snippet;
  }

  const { label, shortcut, isPrimary, isDisabled = false, onpress, icon }: Props = $props();

  const buttonClass = $derived.by(() => {
    if (isPrimary) {
      return ["circle-action", "circle-action-primary", "circle-action-shape"];
    }

    return ["circle-action", "circle-action-shape"];
  });
</script>

<Button class={buttonClass} isEnabled={!isDisabled} onclick={onpress} toolTip={shortcut}>
  <StackPanel orientation="Horizontal">
    {@render icon()}
    <TextBlock class="circle-action-label" text={label} verticalAlignment="Center" />
  </StackPanel>
</Button>

<style>
  .circle-action-shape {
    height: 48px;
    padding: 0 20px;
    border-width: 0;
    border-radius: 24px;
    font-weight: 500;
    font-size: 16px;
  }

  .circle-action-label {
    margin-left: 10px;
  }
</style>
