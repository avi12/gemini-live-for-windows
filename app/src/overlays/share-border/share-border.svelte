<script lang="ts">
  import type { Region } from "@/contracts/monitor.ts";
  import { cutEmptyRegion, cutFrameRegion } from "@/overlays/share-border/frame-region.ts";
  import { windowTheme } from "@/overlays/share-border/window-theme.svelte.ts";
  import "@gemini-live/pill/theme.css";
  import { Window } from "winui-svelte/components";
  import type { WindowHandle } from "winui-svelte/components";

  // The frame's thickness, in device-independent pixels
  const FRAME_THICKNESS = 3;

  interface Props {
    // The shared display, in physical screen pixels; undefined hides the border
    bounds: Region | undefined;
  }

  const { bounds }: Props = $props();

  const windowRef: { handle: WindowHandle | undefined } = $state({ handle: undefined });
  const theme = windowTheme();

  // The window is never hidden or shown again: a plain window is white until it is cut down to its
  // frame, so it stays shown and is clipped to nothing while there is nothing to frame. It opens
  // hidden, and is shown once it has been clipped to nothing
  const shown: { isReady: boolean } = $state({ isReady: false });

  // Twice: a window moved to a display with another scale takes the first move at the old
  // display's scale, so it only has its size right the second time
  function moveOnce({ handle, bounds }: {
    handle: WindowHandle;
    bounds: Region;
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
    bounds: Region;
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
      thickness: Math.ceil(FRAME_THICKNESS * handle.scale)
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
    class="share-frame share-frame-shape"
    isHitTestVisible={false}
  ></border>
</Window>

<style>
  .share-frame-shape {
    border-width: 3px;
    border-radius: 0;
    background-color: transparent;
  }
</style>
