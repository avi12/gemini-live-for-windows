<script lang="ts">
  import type { Monitor } from "@/contracts/monitor.ts";
  import { bracketPath, GLOW_GRADIENTS, GlowSide, glowSidePaths } from "@/overlays/circle/glow-geometry.ts";
  import { cutEmptyRegion, cutFrameRegion } from "@/overlays/focus/frame-region.ts";
  import { dragRegion, GRIP_CURSORS, gripAt, RegionGrip } from "@/overlays/region/region-drag.ts";
  import type { Point, Rect } from "@/overlays/shapes.ts";
  import { windowTheme } from "@/overlays/window/window-theme.svelte.ts";
  import "@gemini-live/pill/theme.css";
  import { elementSize } from "winui-svelte";
  import {
    Canvas,
    GradientStop,
    LinearGradientBrush,
    Path,
    Window
  } from "winui-svelte/components";
  import type { WindowHandle } from "winui-svelte/components";
  import { setPointerCapture } from "winui-svelte/input";
  import type { PointerEvent } from "winui-svelte/input";

  interface Props {
    // The region the user searched, in the display's physical pixels, and the display; undefined
    // hides the frame
    target: {
      monitor: Monitor;
      region: Rect;
    } | undefined;
    // The pointer in physical screen pixels, read from the cursor rather than the frame, which
    // moves along with the drag
    cursorPosition: () => Point;
    // The region was moved or resized and let go of
    onchanged: (region: Rect) => void;
  }

  const { target, cursorPosition, onchanged }: Props = $props();

  // In device-independent pixels: the frame's thickness, the region's corner radius, the size of the
  // corners that resize, and the white corners' stroke
  const BAND = 12;
  const REGION_RADIUS = 24;
  const CORNER_ZONE = 32;
  const BRACKET_STROKE = 6;
  const PRIMARY_BUTTON = 0;
  const HALF = 2;
  const GLOW_SIDES = Object.values(GlowSide);

  const windowRef: { handle: WindowHandle | undefined } = $state({ handle: undefined });
  const content = elementSize();
  const theme = windowTheme();
  const shown: { isReady: boolean } = $state({ isReady: false });
  // The region as it is now, while it is dragged ahead of what `target` says
  const current: { region: Rect | undefined } = $state({ region: undefined });
  const drag: {
    start: Rect | undefined;
    origin: Point | undefined;
    grip: RegionGrip | undefined;
  } = $state({
    start: undefined,
    origin: undefined,
    grip: undefined
  });
  const hover: { grip: RegionGrip } = $state({ grip: RegionGrip.MOVE });

  $effect(() => {
    current.region = target?.region;
  });

  function scale() {
    return windowRef.handle?.scale ?? 1;
  }

  function place() {
    const handle = windowRef.handle;
    const isUnplaceable = handle === undefined;
    if (isUnplaceable) {
      return;
    }

    const hwnd = handle.appWindow.id.value;
    const region = current.region;
    const isHidden = region === undefined;
    if (isHidden) {
      cutEmptyRegion(hwnd);
      shown.isReady = true;
      return;
    }

    const band = Math.ceil(BAND * handle.scale);
    const bounds = {
      x: region.x - band,
      y: region.y - band,
      width: region.width + band * HALF,
      height: region.height + band * HALF
    };
    // Twice: a window moved to a display with another scale takes the first move at the old display's
    // scale, so it only has its size right the second time
    handle.appWindow.moveAndResize(bounds);
    handle.appWindow.moveAndResize(bounds);
    cutFrameRegion({
      hwnd,
      width: bounds.width,
      height: bounds.height,
      thickness: band,
      radius: Math.ceil((REGION_RADIUS + BAND) * handle.scale)
    });
    shown.isReady = true;
  }

  $effect(() => {
    void current.region;
    void windowRef.handle;
    place();
  });

  // Where in the frame the pointer is, in the frame's own physical pixels
  function gripUnderPointer() {
    const region = current.region;
    const isHidden = region === undefined;
    if (isHidden) {
      return RegionGrip.MOVE;
    }

    const band = Math.ceil(BAND * scale());
    const pointer = cursorPosition();
    return gripAt({
      point: {
        x: pointer.x - (region.x - band),
        y: pointer.y - (region.y - band)
      },
      size: {
        width: region.width + band * HALF,
        height: region.height + band * HALF
      },
      corner: Math.ceil(CORNER_ZONE * scale())
    });
  }

  function release() {
    const isDragging = drag.start !== undefined;
    drag.start = undefined;
    drag.origin = undefined;
    drag.grip = undefined;
    const region = current.region;
    const isChanged = isDragging && region !== undefined;
    if (isChanged) {
      onchanged(region);
    }
  }

  function press(event: PointerEvent) {
    const isPrimary = event.button === PRIMARY_BUTTON;
    if (!isPrimary) {
      return;
    }

    drag.start = current.region;
    drag.origin = cursorPosition();
    drag.grip = gripUnderPointer();
    setPointerCapture({
      control: event.currentTarget,
      pointerId: event.pointerId
    });
  }

  function move() {
    const { start, origin, grip } = drag;
    const monitor = target?.monitor;
    const isDragging = start !== undefined && origin !== undefined && grip !== undefined && monitor !== undefined;
    if (!isDragging) {
      hover.grip = gripUnderPointer();
      return;
    }

    const now = cursorPosition();
    current.region = dragRegion({
      start,
      grip,
      delta: {
        x: now.x - origin.x,
        y: now.y - origin.y
      },
      monitor
    });
  }

  // The frame as device-independent pixels draws it: the colour band along the region's edge, and
  // the white corners over it
  const frame = $derived.by(() => {
    const rect = {
      x: BAND / HALF,
      y: BAND / HALF,
      width: Math.max(content.width - BAND, 0),
      height: Math.max(content.height - BAND, 0)
    };
    const radius = REGION_RADIUS + BAND / HALF;
    return {
      sides: glowSidePaths({
        rect,
        radius
      }),
      brackets: bracketPath({
        rect,
        radius
      })
    };
  });
</script>

<Window
  activate={false}
  isActivatable={false}
  isAlwaysOnTop
  isBorderless
  isHidden={!shown.isReady || target === undefined}
  isResizable={false}
  isShownInSwitchers={false}
  isToolWindow
  onscalechanged={place}
  theme={theme.current}
  title="Search region"
  bind:handle={() => windowRef.handle, handle => {
    windowRef.handle = handle;
  }}
>
  <border
    style:cursor={GRIP_CURSORS[hover.grip]}
    class="search-region-root"
    {@attach content.attach}
    onpointercapturelost={release}
    onpointerdown={press}
    onpointermove={move}
    onpointerup={release}
    role="presentation"
  >
    <Canvas class="search-region-layer" isHitTestVisible={false}>
      {#each GLOW_SIDES as side (side)}
        <Path data={frame.sides[side]} isHitTestVisible={false} strokeThickness={BAND}>
          {#snippet stroke()}
            <LinearGradientBrush endPoint={GLOW_GRADIENTS[side].end} startPoint={GLOW_GRADIENTS[side].start}>
              {#each GLOW_GRADIENTS[side].stops as stop (stop.offset)}
                <GradientStop color={stop.color} offset={stop.offset} />
              {/each}
            </LinearGradientBrush>
          {/snippet}
        </Path>
      {/each}
      <Path
        class="circle-bracket"
        data={frame.brackets}
        isHitTestVisible={false}
        strokeThickness={BRACKET_STROKE}
      />
    </Canvas>
  </border>
</Window>

<style>
  .search-region-root {
    background-color: #4285f4;
  }

  .search-region-layer {
    width: 100%;
    height: 100%;
  }
</style>
