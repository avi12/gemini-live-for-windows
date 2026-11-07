<script lang="ts">
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import { lineLift } from "@/ui/motion.ts";
  import { PillActionKind } from "@gemini-live/protocol/view";
  import { control } from "winui-svelte";
  import { Run, ScrollViewer, StackPanel, TextBlock } from "winui-svelte/components";

  interface ScrollerControl {
    scrollableHeight: number;
    changeView(horizontalOffset: null, verticalOffset: number, zoomFactor: null): boolean;
    onLayoutUpdated(callback: () => void): () => void;
  }

  let isScrollPending = false;

  const transcriptSignature = $derived(view.lines.map(line => `${line.id}:${line.text}`).join("\n"));

  $effect(() => {
    void transcriptSignature;
    isScrollPending = true;
  });

  function speaker(isUser: boolean) {
    if (isUser) {
      return "You: ";
    }

    return "Gemini: ";
  }

  function keepEnd(scroller: ScrollerControl) {
    return scroller.onLayoutUpdated(() => {
      if (!isScrollPending) {
        return;
      }

      isScrollPending = false;
      scroller.changeView(null, scroller.scrollableHeight, null);
    });
  }

  function makeFocusable() {
    if (view.isFocusable) {
      return;
    }

    sendAction({
      kind: PillActionKind.setFocusable,
      isFocusable: true
    });
  }
</script>

<ScrollViewer
  class="transcript"
  {@attach control<ScrollerControl>(keepEnd)}
  horizontalScrollBarVisibility="Disabled"
  verticalScrollBarVisibility="Hidden"
>
  <StackPanel>
    {#each view.lines as line (line.id)}
      <border in:lineLift>
        <TextBlock
          class="live-body line"
          isTextSelectionEnabled
          onpointerpressed={makeFocusable}
          onselectionchanged={makeFocusable}
          textWrapping="Wrap"
        >
          <Run class="speaker">{speaker(line.isUser)}</Run><Run>{line.text}</Run>
        </TextBlock>
      </border>
    {/each}
  </StackPanel>
</ScrollViewer>

<style>
  .transcript {
    max-height: 200px;
  }

  .line {
    line-height: 24px;
  }

  .speaker {
    font-weight: 500;
  }
</style>
