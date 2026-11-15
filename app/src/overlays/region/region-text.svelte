<script lang="ts">
  import { roundedRectsPath, WORD_RADIUS } from "@/overlays/circle/gesture/geometry.ts";
  import type { ShowRegionText } from "@/overlays/protocol.ts";
  import { pointerPoint } from "@/overlays/circle/gesture/pointer-points.ts";
  import { windowTheme } from "@/overlays/window/window-theme.svelte.ts";
  import "@gemini-live/pill/theme.css";
  import { Canvas, Image, Path, Window } from "winui-svelte/components";
  import type { WindowHandle } from "winui-svelte/components";
  import { releasePointerCapture, setPointerCapture } from "winui-svelte/input";
  import type { KeyboardEvent, PointerEvent } from "winui-svelte/input";
  import { joinWords, selectableWords, wordAt, wordsBetween } from "winui-svelte/selection";

  interface Props {
    // The region, its own still and the words in it; undefined hides the window
    target: (ShowRegionText & { still: Uint8Array }) | undefined;
    // Puts the picked text on the clipboard; whether it went
    oncopy: (text: string) => Promise<boolean>;
    // The window is done: Esc, or the user went to another window
    onclosed: () => void;
  }

  const { target, oncopy, onclosed }: Props = $props();

  // Within this many DIPs of a word still counts as on it, so a drag through the gaps keeps going
  const WORD_REACH = 6;
  const PRIMARY_BUTTON = 0;
  const ESCAPE_KEY = "Escape";
  // How long after showing a deactivation is still Windows settling, not the user leaving
  const SETTLE_MILLISECONDS = 800;
  const shownAt: { time: number } = $state({ time: 0 });

  const windowRef: { handle: WindowHandle | undefined } = $state({ handle: undefined });
  const theme = windowTheme();
  const pick: {
    anchor: number | undefined;
    head: number | undefined;
  } = $state({
    anchor: undefined,
    head: undefined
  });

  // The words in the window's own DIPs: the display's pixels, from the region's corner, at the scale
  const words = $derived.by(() => {
    const scale = windowRef.handle?.scale ?? 1;
    const region = target?.region;
    const isHidden = target === undefined || region === undefined;
    if (isHidden) {
      return [];
    }

    return selectableWords(
      target.lines.map(line => ({
        words: line.words.map(word => ({
          rawValue: word.text,
          boundingBox: {
            x: (word.bounds.x - region.x) / scale,
            y: (word.bounds.y - region.y) / scale,
            width: word.bounds.width / scale,
            height: word.bounds.height / scale
          }
        }))
      }))
    );
  });

  const range = $derived.by(() => {
    const { anchor, head } = pick;
    const isNothingPicked = anchor === undefined || head === undefined;
    if (isNothingPicked) {
      return undefined;
    }

    return wordsBetween({
      words,
      from: anchor,
      to: head
    });
  });

  const wordsPath = $derived(
    roundedRectsPath({
      rects: words.map(word => word.bounds),
      radius: WORD_RADIUS
    })
  );
  const pickedPath = $derived(
    roundedRectsPath({
      rects: range === undefined ? [] : words.slice(range.start, range.end + 1).map(word => word.bounds),
      radius: WORD_RADIUS
    })
  );

  // Each use starts with nothing picked
  $effect(() => {
    void target;
    pick.anchor = undefined;
    pick.head = undefined;
    shownAt.time = performance.now();
  });

  function press(event: PointerEvent) {
    const isPrimary = event.button === PRIMARY_BUTTON;
    if (!isPrimary) {
      return;
    }

    const iWord = wordAt({
      words,
      point: pointerPoint(event),
      reach: WORD_REACH
    });
    pick.anchor = iWord;
    pick.head = iWord;
    setPointerCapture({
      control: event.currentTarget,
      pointerId: event.pointerId
    });
  }

  function move(event: PointerEvent) {
    const isPicking = pick.anchor !== undefined;
    if (!isPicking) {
      return;
    }

    const iWord = wordAt({
      words,
      point: pointerPoint(event),
      reach: WORD_REACH
    });
    if (iWord !== undefined) {
      pick.head = iWord;
    }
  }

  // Letting go copies what is picked, as the picked words stay lit until the next press
  function release(event: PointerEvent) {
    releasePointerCapture({
      control: event.currentTarget,
      pointerId: event.pointerId
    });
    const picked = range;
    const isNothingPicked = picked === undefined;
    if (isNothingPicked) {
      return;
    }

    void oncopy(
      joinWords({
        words,
        range: picked
      })
    );
  }

  function key(event: KeyboardEvent) {
    const isEscape = event.key === ESCAPE_KEY;
    if (isEscape) {
      onclosed();
    }
  }

  // The window is the region's pixels, in place: moved and sized to it on the display
  $effect(() => {
    const handle = windowRef.handle;
    const region = target?.region;
    const monitor = target?.monitor;
    const isUnplaceable = handle === undefined || region === undefined || monitor === undefined;
    if (isUnplaceable) {
      return;
    }

    const bounds = {
      x: monitor.x + region.x,
      y: monitor.y + region.y,
      width: region.width,
      height: region.height
    };
    // Twice: a window moved to a display with another scale takes the first move at the old display's
    // scale, so it only has its size right the second time
    handle.appWindow.moveAndResize(bounds);
    handle.appWindow.moveAndResize(bounds);
  });
</script>

<Window
  activate={target !== undefined}
  isAlwaysOnTop
  isBorderless
  isHidden={target === undefined}
  isResizable={false}
  isShownInSwitchers={false}
  isToolWindow
  onactivechanged={isActive => {
    // Not in the first moments, while Windows settles which window is in front
    const isSettling = performance.now() - shownAt.time < SETTLE_MILLISECONDS;
    if (!isActive && target !== undefined && !isSettling) {
      onclosed();
    }
  }}
  theme={theme.current}
  title="Select text"
  bind:handle={() => windowRef.handle, handle => {
    windowRef.handle = handle;
  }}
>
  <grid
    class="region-text-root"
    onkeydown={key}
    onpointercancel={release}
    onpointerdown={press}
    onpointermove={move}
    onpointerup={release}
    role="presentation"
  >
    {#if target !== undefined}
      <Image source={target.still} stretch="Fill" />
    {/if}
    <Canvas class="region-text-layer" isHitTestVisible={false}>
      <Path class="circle-words" data={wordsPath} isHitTestVisible={false} />
      <Path class="circle-picked" data={pickedPath} isHitTestVisible={false} />
    </Canvas>
  </grid>
</Window>

<style>
  .region-text-root {
    background-color: #000000;
    cursor: text;
  }

  .region-text-layer {
    width: 100%;
    height: 100%;
  }

  .circle-words {
    opacity: 0.14;
  }

  .circle-picked {
    opacity: 0.45;
  }
</style>
