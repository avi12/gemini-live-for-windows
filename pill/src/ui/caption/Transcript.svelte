<script lang="ts">
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import TextMenu from "@/ui/menu/TextMenu.svelte";
  import { lineLift } from "@/ui/motion/motion.ts";
  import { PillActionKind } from "@gemini-live/protocol/view";
  import { SvelteMap } from "svelte/reactivity";
  import { control } from "winui-svelte";
  import { Run, ScrollViewer, StackPanel, TextBlock } from "winui-svelte/components";
  import { z } from "zod";

  interface ScrollerControl {
    scrollableHeight: number;
    verticalOffset: number;
    changeView(...view: [null, number, null, boolean]): boolean;
    onLayoutUpdated(callback: () => void): () => void;
  }

  interface SelectableText {
    selectedText: string;
  }

  // Each line's text block by the line's id, for the Copy item to ask what is selected in it
  const blocks = new SvelteMap<string, SelectableText>();

  // Characters that draw nothing: the right-to-left mark settles which way a line runs, and the
  // no-break space keeps the label's space with it
  const RIGHT_TO_LEFT_MARK = String.fromCodePoint(0x200f);
  const NO_BREAK_SPACE = String.fromCodePoint(0xa0);
  const RIGHT_TO_LEFT_LETTER = /[\p{Script=Hebrew}\p{Script=Arabic}]/u;

  // The label is Latin, so on its own it would make a Hebrew line run left to right and scramble the
  // hyphens next to English words. A right-to-left mark first makes the whole line run right to left,
  // label included: it reads "Gemini" and then its colon, to the left of it.
  function speaker({ isUser, text }: { isUser: boolean; text: string }) {
    const name = isUser ? "You" : "Gemini";
    const isRightToLeft = RIGHT_TO_LEFT_LETTER.test(text);
    if (isRightToLeft) {
      return `${RIGHT_TO_LEFT_MARK}${name}:${NO_BREAK_SPACE}`;
    }

    return `${name}:${NO_BREAK_SPACE}`;
  }

  // Within this many DIPs of the end still counts as at the end
  const END_TOLERANCE = 4;

  // New text brings the end into view, but only for a reader who is at the end: one who scrolled up
  // to read stays where they are
  // Text has scrolled out of the top edge, which is what the fade there hints at
  const scroll: { isScrolled: boolean } = $state({ isScrolled: false });

  function readScroll(scroller: { verticalOffset: number }) {
    scroll.isScrolled = scroller.verticalOffset > END_TOLERANCE;
  }

  const scrollerSchema = z.object({ verticalOffset: z.number() });

  // A view change tells which scroll viewer it was; only one that scrolls vertically is read
  function readSender(sender: unknown) {
    const scroller = scrollerSchema.safeParse(sender);
    if (scroller.success) {
      readScroll(scroller.data);
    }
  }

  function keepEnd(scroller: ScrollerControl) {
    const seen = { height: 0 };
    return scroller.onLayoutUpdated(() => {
      const height = scroller.scrollableHeight;
      readScroll(scroller);

      const isAtEnd = scroller.verticalOffset >= seen.height - END_TOLERANCE;
      const hasGrown = height > seen.height;
      seen.height = height;

      if (isAtEnd && hasGrown) {
        scroller.changeView(null, height, null, true);
      }
    });
  }

  function makeFocusable() {
    if (view.isFocusable) {
      return;
    }

    sendAction({
      kind: PillActionKind.SET_FOCUSABLE,
      isFocusable: true
    });
  }
</script>

<ScrollViewer
  class={scroll.isScrolled ? "transcript transcript-faded" : "transcript"}
  {@attach control<ScrollerControl>(keepEnd)}
  horizontalScrollBarVisibility="Disabled"
  onviewchanged={readSender}
  verticalScrollBarVisibility="Hidden"
>
  <StackPanel>
    {#each view.lines as line (line.id)}
      <border in:lineLift>
        <TextBlock
          class="live-body line"
          {@attach control<SelectableText>(element => {
            blocks.set(line.id, element);
            return () => blocks.delete(line.id);
          })}
          horizontalTextAlignment="DetectFromContent"
          isTextSelectionEnabled
          onpointerpressed={makeFocusable}
          onselectionchanged={makeFocusable}
          textReadingOrder="DetectFromContent"
          textWrapping="Wrap"
        >
          {#snippet contextFlyout()}
            <TextMenu selected={() => blocks.get(line.id)?.selectedText ?? ""} text={line.text} />
          {/snippet}
          <Run fontWeight="bold">{speaker({ isUser: line.isUser, text: line.text })}</Run><Run>{line.text}</Run>
        </TextBlock>
      </border>
    {/each}
  </StackPanel>
</ScrollViewer>

<style>
  /* Selectable text asks for the text cursor on glyphs and the arrow between them; one shape keeps it steady */
  .line {
    cursor: text;
  }

  .transcript {
    max-height: 200px;
  }

  /* Only when text has scrolled away above: at the top there is nothing to hint at */
  .transcript-faded {
    mask-image: linear-gradient(to bottom, transparent 0%, #000000 14%);
  }
</style>
