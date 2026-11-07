<script lang="ts">
  import CircleAction from "@/overlays/circle/circle-action.svelte";
  import CircleBar from "@/overlays/circle/circle-bar.svelte";
  import type { CircleView } from "@/overlays/circle/controller.ts";
  import { createClickCounter } from "@/overlays/circle/gesture/click-counter.ts";
  import {
    brackets,
    cornerRadius,
    roundedRectsPath,
    scrimPath,
    WORD_RADIUS
  } from "@/overlays/circle/gesture/geometry.ts";
  import { CircleCursor, GestureEventKind, GesturePhase, hoverCursor } from "@/overlays/circle/gesture/gesture.ts";
  import type { GestureEvent } from "@/overlays/circle/gesture/gesture.ts";
  import { OverlayGlyph } from "@/overlays/glyphs.ts";
  import {
    fadeOut,
    riseIn,
    settleIn,
    sheenIn,
    TransformOrigin
  } from "@/overlays/motion/transitions.ts";
  import { CircleAction as CircleActionName } from "@/overlays/protocol.ts";
  import type { Rect, Size } from "@/overlays/shapes.ts";
  import "@gemini-live/pill/theme.css";
  import { elementSize } from "winui-svelte";
  import {
    Border,
    Canvas,
    Image,
    Path,
    Polyline,
    TextBlock,
    Window
  } from "winui-svelte/components";
  import type { WindowHandle } from "winui-svelte/components";
  import { releasePointerCapture, setPointerCapture } from "winui-svelte/input";
  import type { PointerEvent } from "winui-svelte/input";
  import { mediaQuery } from "winui-svelte/window";

  interface Props {
    // The monitor in physical pixels: the window covers it exactly
    bounds: Rect;
    // The frozen display, a JPEG
    still: Uint8Array;
    // Undefined until the window knows its size and the controller exists
    view: CircleView | undefined;
    // False in debug runs, so the overlay shows in screenshots
    isExcludedFromCapture: boolean;
    dispatch: (event: GestureEvent) => void;
    onsized: (size: Size) => void;
    ondeactivated: () => void;
    // The window exists: its handle, to bring it to the front
    onready: (hwnd: bigint) => void;
  }

  const {
    bounds,
    still,
    view,
    isExcludedFromCapture,
    dispatch,
    onsized,
    ondeactivated,
    onready
  }: Props = $props();

  // The scrim: barely there while drawing, deeper outside a selection so the selection pops
  const IDLE_DIM = 0.08;
  const SELECTED_DIM = 0.4;
  // The brackets land from slightly larger, so the selection reads as snapping into place
  const BRACKET_SCALE_FROM = 1.06;
  // The white sheen that sweeps the selection the moment it lands
  const FLASH_OPACITY = 0.45;
  // The how-to at top centre drops in from slightly above
  const HINT_DROP = -12;
  const PRIMARY_BUTTON = 0;
  const SECONDARY_BUTTON = 2;
  // Gemini's four-point sparkle, in an 18-unit box (the C# draws it in 24 and scales)
  const SPARKLE = "M9,0 C9,4.95 13.05,9 18,9 C13.05,9 9,13.05 9,18 C9,13.05 4.95,9 0,9 C4.95,9 9,4.95 9,0 Z";

  const screen = elementSize();
  const reducedMotion = mediaQuery("(prefers-reduced-motion: reduce)");
  const clicks = createClickCounter();
  const windowRef: { handle: WindowHandle | undefined } = $state({ handle: undefined });
  const pointer: { cursor: CircleCursor } = $state({ cursor: CircleCursor.draw });

  const isReduced = $derived(reducedMotion.matches);
  const gesture = $derived(view?.gesture);
  const selection = $derived(gesture?.selection);
  const isTextMode = $derived(gesture?.isTextMode === true);
  const isStroking = $derived(gesture?.phase === GesturePhase.stroke);
  const screenSize = $derived({
    width: screen.width,
    height: screen.height
  });

  const dim = $derived.by(() => {
    const isSelectionMissing = selection === undefined;
    if (isSelectionMissing) {
      return IDLE_DIM;
    }

    return SELECTED_DIM;
  });

  const strokeOpacity = $derived.by(() => {
    if (isStroking) {
      return 1;
    }

    return 0;
  });

  const strokePoints = $derived((gesture?.stroke ?? []).map(point => [point.x, point.y] as const));
  const scrim = $derived(
    scrimPath({
      screen: screenSize,
      selection
    })
  );
  const localBrackets = $derived.by(() => {
    const isSelectionMissing = selection === undefined;
    if (isSelectionMissing) {
      return "";
    }

    return brackets({
      x: 0,
      y: 0,
      width: selection.width,
      height: selection.height
    });
  });
  const wordsPath = $derived(
    roundedRectsPath({
      rects: (gesture?.words ?? []).map(word => word.bounds),
      radius: WORD_RADIUS
    })
  );
  const pickedPath = $derived(
    roundedRectsPath({
      rects: (gesture?.picked ?? []).flatMap(index => gesture?.words[index]?.bounds ?? []),
      radius: WORD_RADIUS
    })
  );

  const sheen = $derived(
    sheenIn({
      from: FLASH_OPACITY,
      isReduced
    })
  );
  const settle = $derived(
    settleIn({
      scaleFrom: BRACKET_SCALE_FROM,
      isReduced
    })
  );
  const hintEnter = $derived(
    riseIn({
      rise: HINT_DROP,
      isReduced,
      origin: TransformOrigin.top
    })
  );
  const hintLeave = $derived(fadeOut({ isReduced }));

  $effect(() => {
    const isMeasured = screen.width > 0 && screen.height > 0;
    if (isMeasured) {
      onsized({
        width: screen.width,
        height: screen.height
      });
    }
  });

  $effect(() => {
    const handle = windowRef.handle;
    const hasHandle = handle !== undefined;
    if (hasHandle) {
      onready(handle.appWindow.id.value);
    }
  });

  function place() {
    windowRef.handle?.appWindow.moveAndResize({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    });
  }
</script>

<Window
  activate
  backdrop="transparent"
  isAlwaysOnTop
  isBorderless
  {isExcludedFromCapture}
  isResizable={false}
  isToolWindow
  onactivechanged={isActive => {
    if (!isActive) {
      ondeactivated();
    }
  }}
  onscalechanged={place}
  placement={bounds}
  title="Circle to Search"
  bind:handle={() => windowRef.handle, handle => {
    windowRef.handle = handle;
  }}
>
  <grid
    style:cursor={pointer.cursor}
    class="circle-root"
    {@attach screen.attach}
    onpointercancel={() => dispatch({ kind: GestureEventKind.pointerUp })}
    onpointercapturelost={() => dispatch({ kind: GestureEventKind.pointerUp })}
    onpointerdown={(event: PointerEvent) => {
      const isSecondary = event.button === SECONDARY_BUTTON;
      if (isSecondary) {
        dispatch({ kind: GestureEventKind.escape });
        return;
      }

      const isOtherButton = event.button !== PRIMARY_BUTTON;
      if (isOtherButton) {
        return;
      }

      const point = {
        x: event.clientX,
        y: event.clientY
      };
      setPointerCapture({
        control: event.currentTarget,
        pointerId: event.pointerId
      });
      dispatch({
        kind: GestureEventKind.pointerDown,
        point,
        clickCount: clicks.press({
          point,
          time: performance.now()
        })
      });
    }}
    onpointermove={(event: PointerEvent) => {
      const coalesced = event.getCoalescedEvents();
      const reports = coalesced.length > 0 ? coalesced : [event];
      for (const report of reports) {
        dispatch({
          kind: GestureEventKind.pointerMove,
          point: {
            x: report.x,
            y: report.y
          }
        });
      }

      const isIdle = gesture?.phase === GesturePhase.idle;
      if (isIdle) {
        pointer.cursor = hoverCursor({
          state: gesture,
          point: {
            x: event.clientX,
            y: event.clientY
          }
        });
      }
    }}
    onpointerup={(event: PointerEvent) => {
      releasePointerCapture({
        control: event.currentTarget,
        pointerId: event.pointerId
      });
      dispatch({ kind: GestureEventKind.pointerUp });
    }}
    role="presentation"
  >
    <Image class="circle-still" source={still} stretch="Fill" />
    <Border class="circle-tint" isHitTestVisible={false} />
    <Path style="opacity: {dim};" class="circle-dim" data={scrim} isHitTestVisible={false} />
    <Border class="circle-edge-glow" isHitTestVisible={false} />
    <Border class="circle-edge" isHitTestVisible={false} />

    <Canvas class="circle-layer" isHitTestVisible={false}>
      {#if view !== undefined}
        <Canvas style="opacity: {strokeOpacity};" class="circle-layer circle-stroke" isHitTestVisible={false}>
          <Polyline class="circle-stroke-glow" points={strokePoints} />
          <Polyline class="circle-stroke-core" points={strokePoints} />
        </Canvas>

        {#if selection !== undefined}
          {#key view.landing?.revision}
            <border
              style:left="{selection.x}px"
              style:top="{selection.y}px"
              style:width="{selection.width}px"
              style:height="{selection.height}px"
              class="circle-selection"
              in:settle
            >
              <Path class="circle-bracket-halo" data={localBrackets} />
              <Path class="circle-bracket" data={localBrackets} />
            </border>
          {/key}

          {#if view.landing !== undefined}
            {#key view.landing.revision}
              <border
                style:left="{selection.x}px"
                style:top="{selection.y}px"
                style:width="{selection.width}px"
                style:height="{selection.height}px"
                style:border-radius="{cornerRadius(selection)}px"
                class="circle-flash"
                in:sheen
              ></border>
            {/key}
          {/if}
        {/if}

        {#if isTextMode}
          <Path class="circle-words" data={wordsPath} isHitTestVisible={false} />
          <Path class="circle-picked" data={pickedPath} isHitTestVisible={false} />
          {#if gesture?.band !== undefined}
            <border
              style:left="{gesture.band.x}px"
              style:top="{gesture.band.y}px"
              style:width="{gesture.band.width}px"
              style:height="{gesture.band.height}px"
              class="circle-band"
            ></border>
          {/if}
        {/if}
      {/if}
    </Canvas>

    {#if view?.hint.isVisible === true}
      {#key view.hint.text}
        <border class="circle-hint circle-hint-frame" in:hintEnter out:hintLeave>
          <TextBlock class="circle-hint-text" text={view.hint.text} />
        </border>
      {/key}
    {/if}

    <Canvas class="circle-layer">
      {#if view !== undefined && selection !== undefined}
        {#if isTextMode}
          <CircleBar screen={screenSize} {selection}>
            <CircleAction
              isDisabled={gesture?.picked.length === 0}
              isPrimary
              label="Copy"
              onpress={() => dispatch({ kind: GestureEventKind.copy })}
              shortcut="Ctrl+C"
            >
              {#snippet icon()}
                <TextBlock class="circle-icon" text={OverlayGlyph.copy} />
              {/snippet}
            </CircleAction>
            <CircleAction
              isPrimary={false}
              label="Done"
              onpress={() => dispatch({ kind: GestureEventKind.leaveText })}
              shortcut="Esc"
            >
              {#snippet icon()}
                <TextBlock class="circle-icon" text={OverlayGlyph.close} />
              {/snippet}
            </CircleAction>
          </CircleBar>
        {:else if !view.gesture.isAskOnRelease}
          <CircleBar screen={screenSize} {selection}>
            <CircleAction
              isPrimary
              label="Ask Gemini"
              onpress={() => dispatch({
                kind: GestureEventKind.finish,
                action: CircleActionName.askGemini
              })}
              shortcut="Enter"
            >
              {#snippet icon()}
                <Path class="circle-sparkle" data={SPARKLE} />
              {/snippet}
            </CircleAction>
            <CircleAction
              isPrimary={false}
              label="Google Lens"
              onpress={() => dispatch({
                kind: GestureEventKind.finish,
                action: CircleActionName.lens
              })}
              shortcut="L"
            >
              {#snippet icon()}
                <TextBlock class="circle-icon" text={OverlayGlyph.search} />
              {/snippet}
            </CircleAction>
            <CircleAction
              isDisabled={view.gesture.isReading}
              isPrimary={false}
              label="Select text"
              onpress={() => dispatch({ kind: GestureEventKind.selectText })}
              shortcut="T"
            >
              {#snippet icon()}
                <TextBlock class="circle-icon" text={OverlayGlyph.textSelect} />
              {/snippet}
            </CircleAction>
          </CircleBar>
        {/if}
      {/if}
    </Canvas>
  </grid>
</Window>

<style>
  .circle-root {
    background-color: transparent;
  }

  .circle-tint {
    background-image: linear-gradient(to bottom, #4285f4 0%, #ea4335 33%, #fbbc04 66%, #34a853 100%);
    opacity: 0.1;
  }

  .circle-dim {
    fill: #000000;
    transition: opacity 200ms;
  }

  .circle-edge {
    border-color: #4285f4;
    border-width: 3px;
  }

  .circle-edge-glow {
    border-color: #4285f4;
    border-width: 14px;
    opacity: 0.7;
    filter: blur(28px);
  }

  .circle-layer {
    width: 100%;
    height: 100%;
  }

  .circle-stroke {
    transition: opacity 260ms;
  }

  .circle-stroke-glow {
    stroke: #4285f4;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 20px;
    opacity: 0.85;
    filter: blur(12px);
  }

  .circle-stroke-core {
    stroke: #ffffff;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 6px;
  }

  .circle-selection {
    position: absolute;
  }

  .circle-flash {
    position: absolute;
    background-color: #ffffff;
    opacity: 0;
  }

  .circle-bracket {
    fill: none;
    stroke: #ffffff;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 5px;
  }

  .circle-bracket-halo {
    fill: none;
    stroke: #000000;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 10px;
    opacity: 0.35;
  }

  .circle-words {
    opacity: 0.14;
  }

  .circle-picked {
    opacity: 0.45;
  }

  .circle-band {
    position: absolute;
    border-width: 1.5px;
    opacity: 0.7;
  }

  .circle-hint-frame {
    align-self: start;
    justify-self: center;
    margin-top: 28px;
    padding: 12px 20px;
    border-radius: 34px;
  }

  .circle-hint-text {
    font-size: 14px;
  }

  .circle-icon {
    font-family: "Material Symbols Rounded";
    font-size: 18px;
  }
</style>
