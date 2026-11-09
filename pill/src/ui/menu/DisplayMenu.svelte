<script lang="ts">
  import { menuOf } from "./menu.ts";
  import { previewOf, setPreviewsOpen, syncPreviews } from "@/lib/display-previews.svelte.ts";
  import { pillPreview, sendAction, view } from "@/lib/view.svelte.ts";
  import { PillActionKind } from "@gemini-live/protocol/view";
  import type { PillView } from "@gemini-live/protocol/view";
  import { Button, Flyout, Image, TextBlock } from "winui-svelte/components";

  const menu = menuOf();
  let isOpen = $state(false);

  function setOpen(isNowOpen: boolean) {
    isOpen = isNowOpen;
    setPreviewsOpen(isNowOpen);
  }

  $effect(() => {
    syncPreviews({
      displays: view.displays,
      framesPerSecond: pillPreview.framesPerSecond
    });
  });

  function share(displayId: string) {
    sendAction({
      kind: PillActionKind.share,
      displayId
    });
  }
</script>

{#snippet tile(display: PillView["displays"][number])}
  {@const picture = previewOf(display.id)}
  <stack-panel class="tile">
    <border class="frame live-display-frame">
      {#if picture}
        <Image source={picture} stretch="Uniform" />
      {/if}
    </border>
    <TextBlock class="tile-name" text={display.name} textWrapping="Wrap" />
  </stack-panel>
{/snippet}

<Flyout
  {@attach menu.attach}
  onclosed={menu.props.onclosed}
  onclosing={menu.props.onclosing}
  placement={menu.props.placement}
  shouldConstrainToRootBounds={menu.props.shouldConstrainToRootBounds}
  bind:open={() => isOpen, setOpen}
>
  <stack-panel class="picker">
    {#each view.displays as display (display.id)}
      {#if view.sharedDisplay === display.id}
        <Button class="option live-display-shared" onclick={() => share(display.id)}>
          {@render tile(display)}
        </Button>
      {:else}
        <Button class="option" onclick={() => share(display.id)}>
          {@render tile(display)}
        </Button>
      {/if}
    {/each}
  </stack-panel>
</Flyout>

<style>
  .picker {
    display: flex;
    flex-direction: row;
    gap: 8px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .frame {
    width: 112px;
    height: 63px;
  }

  .tile-name {
    max-width: 112px;
    font-size: 12px;
  }

  .option {
    padding: 6px;
  }
</style>
