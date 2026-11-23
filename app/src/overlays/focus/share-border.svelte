<script lang="ts">
  import { cutEmptyRegion, cutFrameRegion } from "@/overlays/focus/frame-region.ts";
  import type { Rect } from "@/overlays/shapes.ts";
  import { windowTheme } from "@/overlays/window/window-theme.svelte.ts";
  import "@gemini-live/pill/theme.css";
  import { Window } from "winui-svelte/components";
  import type { WindowHandle } from "winui-svelte/components";

  // The frame's thickness and the corner radius of a circled region, in device-independent pixels
  const FRAME_THICKNESS = 3;
  const REGION_RADIUS = 8;

  interface Props {
    // Physical screen pixels: the display, or the circled region inflated; undefined hides it
    bounds: Rect | undefined;
    // A watched region has rounded corners; a whole display is square
    isRegion: boolean;
  }

  const { bounds, isRegion }: Props = $props();

  const windowRef: { handle: WindowHandle | undefined } = $state({ handle: undefined });
  const theme = windowTheme();

  const radius = $derived.by(() => {
    if (isRegion) {
      return `${REGION_RADIUS}px`;
    }

    return "0px";
  });

  // The window is never hidden or shown again: a plain window is white until it is cut down to its
  // frame, so it stays shown and is clipped to nothing while there is nothing to frame. It opens
  // hidden, and is shown once it has been clipped to nothing
  const shown: { isReady: boolean } = $state({ isReady: false });

  // Twice: a window moved to a display with another scale takes the first move at the old
  // display's scale, so it only has its size right the second time
  function moveOnce({ handle, bounds }: {
    handle: WindowHandle;
    bounds: Rect;
  }) {
    handle.appWindow.moveAndResize({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    });
  }

  function moveTwice(target: {
    handle: WindowHandle;
    bounds: Rect;
  }) {
    moveOnce(target);
    moveOnce(target);
  }

  function place() {
    const handle = windowRef.handle;
    const isUnplaceable = handle === undefined;
    if (isUnplaceable) {
      return;
    }

    const hwnd = handle.appWindow.id.value;
    cutEmptyRegion(hwnd);
    shown.isReady = true;
    const isHidden = bounds === undefined;
    if (isHidden) {
      return;
    }

    moveTwice({
      handle,
      bounds
    });
    // The window is only its frame: a transparent window can show a white surface on some systems, so
    // the middle is cut out of the window instead of being drawn clear
    cutFrameRegion({
      hwnd,
      width: bounds.width,
      height: bounds.height,
      thickness: Math.ceil(FRAME_THICKNESS * handle.scale),
      radius: isRegion ? Math.ceil(REGION_RADIUS * handle.scale) : 0
    });
  }

  $effect(() => {
    void bounds;
    void windowRef.handle;
    place();
  });
</script>

<Window
  activate={false}
  isActivatable={false}
  isAlwaysOnTop
  isBorderless
  isClickThrough
  isHidden={!shown.isReady}
  isResizable={false}
  isShownInSwitchers={false}
  isToolWindow
  onscalechanged={place}
  theme={theme.current}
  title="Gemini sees this"
  bind:handle={() => windowRef.handle, handle => {
    windowRef.handle = handle;
  }}
>
  <border
    style:border-radius={radius}
    class="share-frame share-frame-shape"
    isHitTestVisible={false}
  ></border>
</Window>

<style>
  .share-frame-shape {
    border-width: 3px;
    background-color: transparent;
  }
</style>
