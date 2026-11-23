<script lang="ts">
  import { view } from "@/lib/view.svelte.ts";
  import { PILL_WIDTH } from "@/ui/fold/collapse.svelte.ts";
  import LinkChips from "@/ui/caption/LinkChips.svelte";
  import { cardLift, Motion } from "@/ui/motion/motion.ts";
  import ExtensionPanel from "@/ui/caption/panels/ExtensionPanel.svelte";
  import KeyPanel from "@/ui/caption/panels/KeyPanel.svelte";
  import Transcript from "@/ui/caption/Transcript.svelte";
  import { glideHeight } from "winui-svelte";
  import { StackPanel } from "winui-svelte/components";

  const hasContent = $derived(
    view.lines.length > 0
    || view.links.length > 0
    || view.isExtensionNeeded
    || view.isKeyPromptShown
  );
</script>

{#if hasContent}
  <grid style:width="{PILL_WIDTH}px" class="card" in:cardLift>
    <border
      class="live-card"
      {@attach glideHeight({
        duration: Motion.STANDARD_MILLISECONDS,
        easing: "ease-out"
      })}
    >
      <StackPanel>
        <Transcript />
        {#if view.links.length > 0}
          <LinkChips />
        {/if}
        {#if view.isExtensionNeeded}
          <ExtensionPanel />
        {/if}
        {#if view.isKeyPromptShown}
          <KeyPanel />
        {/if}
      </StackPanel>
    </border>
  </grid>
{/if}

<style>
  .card {
    margin-bottom: 16px;
  }
</style>
