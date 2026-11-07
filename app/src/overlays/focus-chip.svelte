<script lang="ts">
  import type { Monitor, Region } from "@/contracts/monitor.ts";
  import { chipOrigin } from "@/overlays/focus-layout.ts";
  import { OverlayGlyph } from "@/overlays/glyphs.ts";
  import type { Point } from "@/overlays/shapes.ts";
  import "@gemini-live/pill/theme.css";
  import { elementSize } from "winui-svelte";
  import { Button, StackPanel, TextBlock, Window } from "winui-svelte/components";
  import type { WindowHandle } from "winui-svelte/components";
  import { setPointerCapture } from "winui-svelte/input";
  import type { PointerEvent } from "winui-svelte/input";

  interface AttachedRegion {
    monitor: Monitor;
    region: Region;
  }

  interface Props {
    // The region the chip labels; undefined hides the chip
    attached: AttachedRegion | undefined;
    isExcludedFromCapture: boolean;
    // The pointer in physical screen pixels, read from the cursor rather than the chip, which
    // moves along with the drag
    cursorPosition: () => Point;
    ondismissed: () => void;
    ondragstarted: () => void;
    ondragged: (travelled: Point) => void;
  }

  const {
    attached,
    isExcludedFromCapture,
    cursorPosition,
    ondismissed,
    ondragstarted,
    ondragged
  }: Props = $props();

  const LABEL = "Gemini sees this area";
  const CLOSE_TOOL_TIP = "Show Gemini the whole screen (Esc)";
  const PRIMARY_BUTTON = 0;

  const windowRef: { handle: WindowHandle | undefined } = $state({ handle: undefined });
  const content = elementSize();
  const drag: { origin: Point | undefined } = $state({ origin: undefined });

  // Just above the region's frame, or below it when the region touches the top of the display:
  // the chip's own height in physical pixels is its height in DIPs at the window's scale
  function place() {
    const handle = windowRef.handle;
    const isPending = attached === undefined || handle === undefined;
    if (isPending) {
      return;
    }

    const origin = chipOrigin({
      monitor: attached.monitor,
      region: attached.region,
      chipHeight: Math.ceil(content.height * handle.scale)
    });
    handle.appWindow.move({
      x: Math.round(origin.x),
      y: Math.round(origin.y)
    });
  }

  $effect(() => {
    void attached;
    void content.height;
    place();
  });
</script>

<Window
  activate={false}
  backdrop="transparent"
  isActivatable={false}
  isAlwaysOnTop
  isBorderless
  {isExcludedFromCapture}
  isHidden={attached === undefined}
  isResizable={false}
  isShownInSwitchers={false}
  isToolWindow
  onscalechanged={place}
  sizeToContent="both"
  title="Gemini sees this area"
  bind:handle={() => windowRef.handle, handle => {
    windowRef.handle = handle;
  }}
>
  <border
    class="focus-chip focus-chip-shape"
    {@attach content.attach}
    onpointercapturelost={() => {
      drag.origin = undefined;
    }}
    onpointerdown={(event: PointerEvent) => {
      const isPrimary = event.button === PRIMARY_BUTTON;
      if (!isPrimary) {
        return;
      }

      drag.origin = cursorPosition();
      setPointerCapture({
        control: event.currentTarget,
        pointerId: event.pointerId
      });
      ondragstarted();
    }}
    onpointermove={() => {
      const origin = drag.origin;
      const isIdle = origin === undefined;
      if (isIdle) {
        return;
      }

      const now = cursorPosition();
      ondragged({
        x: now.x - origin.x,
        y: now.y - origin.y
      });
    }}
    onpointerup={() => {
      drag.origin = undefined;
    }}
    role="presentation"
  >
    <StackPanel orientation="Horizontal">
      <TextBlock class="focus-chip-label" text={LABEL} verticalAlignment="Center" />
      <Button
        class="focus-chip-close"
        onclick={ondismissed}
        toolTip={CLOSE_TOOL_TIP}
      >
        <TextBlock class="focus-chip-icon" text={OverlayGlyph.close} />
      </Button>
    </StackPanel>
  </border>
</Window>

<style>
  .focus-chip-shape {
    padding-top: 4px;
    padding-right: 4px;
    padding-bottom: 4px;
    padding-left: 0;
    border-width: 1px;
    border-radius: 34px;
    cursor: move;
  }

  .focus-chip-label {
    margin-right: 8px;
    margin-left: 16px;
    font-size: 14px;
  }

  .focus-chip-close {
    width: 32px;
    height: 32px;
    padding: 0;
    border-width: 0;
    border-radius: 16px;
    cursor: default;
  }

  .focus-chip-icon {
    font-family: "Material Symbols Rounded";
    font-size: 20px;
  }
</style>
