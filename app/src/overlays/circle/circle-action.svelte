<script lang="ts">
  import type { Snippet } from "svelte";
  import { Button, StackPanel, TextBlock } from "winui-svelte/components";

  interface Props {
    label: string;
    // The key that does the same, shown in the tooltip; undefined when there is none
    shortcut?: string;
    // The one filled, labelled button of a bar
    isPrimary: boolean;
    // Shows the label beside the icon; otherwise the button is a round icon like the pill's
    isLabelled: boolean;
    isDisabled?: boolean;
    onpress: () => void;
    icon: Snippet;
  }

  const { label, shortcut, isPrimary, isLabelled, isDisabled = false, onpress, icon }: Props = $props();

  const toolTip = $derived.by(() => {
    const isUnbound = shortcut === undefined;
    if (isUnbound) {
      return label;
    }

    return `${label} (${shortcut})`;
  });
  const labelClass = $derived.by(() => {
    if (isPrimary) {
      return ["circle-action-label", "circle-primary-ink"];
    }

    return ["circle-action-label"];
  });
  const buttonClass = $derived.by(() => {
    const shape = isLabelled ? "circle-labelled" : "circle-round";
    if (isPrimary) {
      return ["circle-action", "circle-action-primary", shape];
    }

    return ["circle-action", shape];
  });
</script>

<Button class={buttonClass} automationName={label} isEnabled={!isDisabled} onclick={onpress} {toolTip}>
  <StackPanel orientation="Horizontal">
    {@render icon()}
    {#if isLabelled}
      <TextBlock class={labelClass} text={label} verticalAlignment="Center" />
    {/if}
  </StackPanel>
</Button>

<style>
  .circle-action-label {
    margin-left: 10px;
  }
</style>
