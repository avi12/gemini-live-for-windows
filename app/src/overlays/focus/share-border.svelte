<script lang="ts">
  import type { Rect } from "@/overlays/shapes.ts";
  import "@gemini-live/pill/theme.css";
  import { Window } from "winui-svelte/components";
  import type { WindowHandle } from "winui-svelte/components";

  interface Props {
    // Physical screen pixels: the display, or the circled region inflated; undefined hides it
    bounds: Rect | undefined;
    // A circled region rounds like Circle to Search's selection; a whole display is square
    isRegion: boolean;
    // False in debug runs, so the frame shows in screenshots
    isExcludedFromCapture: boolean;
  }

  const { bounds, isRegion, isExcludedFromCapture }: Props = $props();

  const windowRef: { handle: WindowHandle | undefined } = $state({ handle: undefined });

  const radius = $derived.by(() => {
    if (isRegion) {
      return "8px";
    }

    return "0px";
  });

  function place() {
    const isHidden = bounds === undefined;
    if (isHidden) {
      return;
    }

    windowRef.handle?.appWindow.moveAndResize({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    });
  }

  $effect(() => {
    void bounds;
    place();
  });
</script>

<Window
  activate={false}
  backdrop="transparent"
  isActivatable={false}
  isAlwaysOnTop
  isBorderless
  isClickThrough
  {isExcludedFromCapture}
  isHidden={bounds === undefined}
  isResizable={false}
  isShownInSwitchers={false}
  isToolWindow
  onscalechanged={place}
  placement={bounds ?? null}
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
