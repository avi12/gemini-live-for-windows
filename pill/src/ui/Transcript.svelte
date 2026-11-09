<script lang="ts">
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import { lineLift } from "@/ui/motion/motion.ts";
  import { PillActionKind } from "@gemini-live/protocol/view";
  import { control } from "winui-svelte";
  import { Run, ScrollViewer, StackPanel, TextBlock } from "winui-svelte/components";

  interface ScrollerControl {
    scrollableHeight: number;
    changeView(...view: [null, number, null, boolean]): boolean;
    onLayoutUpdated(callback: () => void): () => void;
  }

  function speaker(isUser: boolean) {
    if (isUser) {
      return "You: ";
    }

    return "Gemini: ";
  }

  function keepEnd(scroller: ScrollerControl) {
    return scroller.onLayoutUpdated(() => {
      scroller.changeView(null, scroller.scrollableHeight, null, true);
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
          class="live-body"
          isTextSelectionEnabled
          onpointerpressed={makeFocusable}
          onselectionchanged={makeFocusable}
          textWrapping="Wrap"
        >
          <Run fontWeight="bold">{speaker(line.isUser)}</Run><Run>{line.text}</Run>
        </TextBlock>
      </border>
    {/each}
  </StackPanel>
</ScrollViewer>

<style>
  .transcript {
    max-height: 200px;
    mask-image: linear-gradient(to bottom, transparent 0%, #000000 14%);
  }
</style>
