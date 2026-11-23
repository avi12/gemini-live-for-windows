<script lang="ts">
  import { view } from "@/lib/view.svelte.ts";
  import { Motion } from "@/ui/motion/motion.ts";
  import Waveform from "@/ui/pill/Waveform.svelte";
  import { LiveStatus } from "@gemini-live/protocol/view";
  import { fade } from "svelte/transition";
  import { TextBlock } from "winui-svelte/components";

  // The pill's middle: the waveform while it listens, otherwise the status in words, with its detail
  // as the tool tip
  const isListening = $derived(view.status === LiveStatus.LISTENING);
  const middleKey = $derived(isListening ? "waveform" : view.status);
  const isDetailEmpty = $derived(view.statusDetail === "");

  const statusDetail = $derived.by(() => {
    if (isDetailEmpty) {
      return undefined;
    }

    return view.statusDetail;
  });
</script>

<grid class="middle" toolTip={statusDetail}>
  {#key middleKey}
    <border
      class="status"
      in:fade={{ duration: Motion.STANDARD_MILLISECONDS }}
      out:fade={{ duration: Motion.SWAP_OUT_MILLISECONDS }}
    >
      {#if isListening}
        <Waveform />
      {:else}
        <TextBlock class="live-supporting-text" textTrimming="CharacterEllipsis">{view.status}</TextBlock>
      {/if}
    </border>
  {/key}
</grid>

<style>
  .middle {
    grid-column: 2;
    align-self: center;
  }

  .status {
    justify-self: center;
  }
</style>
