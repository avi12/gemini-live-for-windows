<script lang="ts">
  import { delay } from "@/google/web-host/timeout.ts";
  import { pointerPoint } from "@/overlays/circle/gesture/pointer-points.ts";
  import type { ShowRegionText } from "@/overlays/protocol.ts";
  import RegionTextControls from "@/overlays/region/region-text-controls.svelte";
  import { windowWords } from "@/overlays/region/region-words.ts";
  import { SelectKey } from "@/overlays/region/select-keys.ts";
  import { createWordPick } from "@/overlays/region/word-pick.svelte.ts";
  import { windowTheme } from "@/overlays/window/window-theme.svelte.ts";
  import "@gemini-live/pill/theme.css";
  import { Canvas, Image, Path, Window } from "winui-svelte/components";
  import type { WindowHandle } from "winui-svelte/components";
  import { releasePointerCapture, setPointerCapture } from "winui-svelte/input";
  import type { KeyboardEvent, PointerEvent } from "winui-svelte/input";

  interface Props {
    // The region, its own still and the words in it; undefined hides the window
    target: (ShowRegionText & { still: Uint8Array }) | undefined;
    // Puts the picked text on the clipboard; whether it went
    oncopy: (text: string) => Promise<boolean>;
    // The window is done: Cancel, Done, Esc, or the user went to another window
    onclosed: () => void;
  }

  const { target, oncopy, onclosed }: Props = $props();

  const PRIMARY_BUTTON = 0;
  const READING_HINT = "Reading text…";
  const NO_TEXT_HINT = "No text found";
  // How long after showing a deactivation is still Windows settling, not the user leaving
  const SETTLE_MILLISECONDS = 800;
  const shownAt: { time: number } = $state({ time: 0 });
  // How long Done says Copied before the window closes
  const COPIED_MILLISECONDS = 650;
  const copy: { isCopied: boolean } = $state({ isCopied: false });

  const windowRef: { handle: WindowHandle | undefined } = $state({ handle: undefined });
  const theme = windowTheme();

  const words = $derived.by(() => {
    const region = target?.region;
    const isHidden = target === undefined || region === undefined;
    if (isHidden) {
      return [];
    }

    return windowWords({
      lines: target.lines,
      region,
      scale: windowRef.handle?.scale ?? 1
    });
  });
  const pick = createWordPick({ words: () => words });

  // What the window says over the picture: that it is reading, or that it found no words
  const hint = $derived.by(() => {
    const isHidden = target === undefined;
    if (isHidden) {
      return undefined;
    }

    if (target.isReading) {
      return READING_HINT;
    }

    return words.length === 0 ? NO_TEXT_HINT : undefined;
  });

  // Each use starts with nothing picked
  $effect(() => {
    void target;
    pick.clear();
    copy.isCopied = false;
    shownAt.time = performance.now();
  });

  function press(event: PointerEvent) {
    const isPrimary = event.button === PRIMARY_BUTTON;
    if (!isPrimary) {
      return;
    }

    pick.start(pointerPoint(event));
    setPointerCapture({
      control: event.currentTarget,
      pointerId: event.pointerId
    });
  }

  // Letting go keeps what is picked lit until the next press; Done is what takes it
  function release(event: PointerEvent) {
    pick.end();
    releasePointerCapture({
      control: event.currentTarget,
      pointerId: event.pointerId
    });
  }

  async function done() {
    const text = pick.text();
    const isNothingPicked = text === undefined;
    if (isNothingPicked) {
      return;
    }

    const isCopied = await oncopy(text);
    if (!isCopied) {
      return;
    }

    // The button says Copied for a moment before the window goes
    copy.isCopied = true;
    await delay(COPIED_MILLISECONDS);
    onclosed();
  }

  function key(event: KeyboardEvent) {
    if (event.key === SelectKey.CANCEL) {
      onclosed();
    } else if (event.key === SelectKey.DONE) {
      void done();
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
    onpointermove={(event: PointerEvent) => pick.extend(pointerPoint(event))}
    onpointerup={release}
    role="presentation"
  >
    {#if target !== undefined}
      <Image source={target.still} stretch="Fill" />
    {/if}
    <Canvas class="region-text-layer" isHitTestVisible={false}>
      <Path class="circle-words" data={pick.wordsPath} isHitTestVisible={false} />
      <Path class="circle-picked" data={pick.pickedPath} isHitTestVisible={false} />
    </Canvas>
    <RegionTextControls
      {hint}
      isCopied={copy.isCopied}
      isDoneEnabled={pick.isPicked}
      isReading={target?.isReading === true}
      oncancel={onclosed}
      ondone={done}
      preview={pick.text()}
    />
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
