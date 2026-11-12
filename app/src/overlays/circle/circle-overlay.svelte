<script lang="ts">
  import { errorMessage } from "@/lib/error-message.ts";
  import type { ChipAction } from "@/overlays/circle/chips/chip.ts";
  import CircleChips from "@/overlays/circle/chips/circle-chips.svelte";
  import CircleAction from "@/overlays/circle/circle-action.svelte";
  import CircleBar from "@/overlays/circle/circle-bar.svelte";
  import type { CircleView } from "@/overlays/circle/controller.ts";
  import { createClickCounter } from "@/overlays/circle/gesture/click-counter.ts";
  import { cornerRadius, roundedRectsPath, WORD_RADIUS } from "@/overlays/circle/gesture/geometry.ts";
  import { CircleCursor, GestureEventKind, hoverCursor, pickedWords } from "@/overlays/circle/gesture/gesture.ts";
  import type { GestureEvent } from "@/overlays/circle/gesture/gesture.ts";
  import { movePoints, pointerPoint } from "@/overlays/circle/gesture/pointer-points.ts";
  import { CORE_SEARCH_ACTION, extraSearchActions, SEARCH_ENGINES } from "@/overlays/circle/search-engines.ts";
  import { OverlayGlyph } from "@/overlays/glyphs.ts";
  import { fadeOut, riseIn, sheenIn, TransformOrigin } from "@/overlays/motion/transitions.ts";
  import { CircleAction as CircleActionName } from "@/overlays/protocol.ts";
  import type { SearchAction } from "@/overlays/protocol.ts";
  import type { Size } from "@/overlays/shapes.ts";
  import { windowTheme } from "@/overlays/window/window-theme.svelte.ts";
  import "@gemini-live/pill/theme.css";
  import { elementSize } from "winui-svelte";
  import {
    Border,
    Canvas,
    Path,
    SelectionOverlay,
    TextBlock,
    Window
  } from "winui-svelte/components";
  import type { WindowHandle } from "winui-svelte/components";
  import { releasePointerCapture, setPointerCapture } from "winui-svelte/input";
  import type { PointerEvent } from "winui-svelte/input";
  import { createSelector, SelectionPhase } from "winui-svelte/selection";
  import { mediaQuery, startTimer } from "winui-svelte/window";

  interface Props {
    // The display the window covers exactly, by the id Windows lists it under
    displayId: bigint;
    // The frozen display, a JPEG
    still: Uint8Array;
    // Undefined until the window knows its size and the controller exists
    view: CircleView | undefined;
    // The engine searched with last: the bar lists it first
    preferredSearch: SearchAction;
    // False in debug runs, so the overlay shows in screenshots
    isExcludedFromCapture: boolean;
    dispatch: (event: GestureEvent) => void;
    // A button on a chip was pressed
    onchip: (action: ChipAction) => void;
    onsized: (size: Size) => void;
    ondeactivated: () => void;
    // The window exists: its handle, to bring it to the front
    onready: (hwnd: bigint) => void;
    // The window could not be placed over its display
    onfailed: (error: string) => void;
  }

  const {
    displayId,
    still,
    view,
    preferredSearch,
    isExcludedFromCapture,
    dispatch,
    onchip,
    onsized,
    ondeactivated,
    onready,
    onfailed
  }: Props = $props();

  // The white sheen that sweeps the selection the moment it lands
  const FLASH_OPACITY = 0.45;
  // The how-to at top centre drops in from slightly above
  const HINT_DROP = -12;
  // How long a notice ("Copied") stays in the hint chip before it fades
  const NOTICE_MILLISECONDS = 1600;
  const PRIMARY_BUTTON = 0;
  const SECONDARY_BUTTON = 2;
  // Gemini's four-point sparkle, in an 18-unit box (the C# draws it in 24 and scales)
  const SPARKLE = "M9,0 C9,4.95 13.05,9 18,9 C13.05,9 9,13.05 9,18 C9,13.05 4.95,9 0,9 C4.95,9 9,4.95 9,0 Z";

  const screen = elementSize();
  const theme = windowTheme();
  const reducedMotion = mediaQuery("(prefers-reduced-motion: reduce)");
  const clicks = createClickCounter();
  const windowRef: { handle: WindowHandle | undefined } = $state({ handle: undefined });
  const pointer: { cursor: CircleCursor } = $state({ cursor: CircleCursor.draw });
  const fadedHintRevision: { value: number | undefined } = $state({ value: undefined });
  const placement: { isCovered: boolean } = $state({ isCovered: false });

  const isReduced = $derived(reducedMotion.matches);
  const gesture = $derived(view?.gesture);
  const selection = $derived(gesture?.selector.selection);
  const isTextMode = $derived(gesture?.isTextMode === true);
  const extraActions = $derived(extraSearchActions(preferredSearch));
  const chooser = $state({ isOpen: false });
  const screenSize = $derived({
    width: screen.width,
    height: screen.height
  });

  // Before the controller exists the window shows the still alone: a selector with nothing in it
  const selector = $derived(gesture?.selector ?? createSelector({ bounds: screenSize }));
  const picked = $derived.by(() => {
    const isUnstarted = gesture === undefined;
    if (isUnstarted) {
      return [];
    }

    return pickedWords(gesture);
  });

  const wordsPath = $derived(
    roundedRectsPath({
      rects: (gesture?.text.words ?? []).map(word => word.bounds),
      radius: WORD_RADIUS
    })
  );
  const pickedPath = $derived(
    roundedRectsPath({
      rects: picked.map(word => word.bounds),
      radius: WORD_RADIUS
    })
  );

  const sheen = $derived(
    sheenIn({
      from: FLASH_OPACITY,
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

  const isHintShown = $derived(view?.hint.isVisible === true && fadedHintRevision.value !== view.hint.revision);

  function cancel() {
    dispatch({ kind: GestureEventKind.cancel });
  }

  $effect(() => {
    const hint = view?.hint;
    const isNoticeShown = hint !== undefined && hint.isVisible && !hint.isLasting;
    if (!isNoticeShown) {
      return;
    }

    return startTimer({
      milliseconds: NOTICE_MILLISECONDS,
      isRepeating: false,
      onTick() {
        fadedHintRevision.value = hint.revision;
      }
    });
  });

  $effect(() => {
    // Only once covered: before that the window has its default size, not the display's
    const isMeasured = placement.isCovered && screen.width > 0 && screen.height > 0;
    if (isMeasured) {
      onsized({
        width: screen.width,
        height: screen.height
      });
    }
  });

  $effect(() => {
    const handle = windowRef.handle;
    const isPlaced = handle !== undefined && !placement.isCovered;
    if (!isPlaced) {
      return;
    }

    try {
      handle.cover({ display: displayId });
    } catch (error) {
      onfailed(errorMessage(error));
      return;
    }

    placement.isCovered = true;
    onready(handle.appWindow.id.value);
  });
</script>

<Window
  activate
  backdrop="transparent"
  isAlwaysOnTop
  isBorderless
  {isExcludedFromCapture}
  isHidden={!placement.isCovered}
  isResizable={false}
  isToolWindow
  onactivechanged={isActive => {
    if (!isActive) {
      ondeactivated();
    }
  }}
  theme={theme.current}
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

      const point = pointerPoint(event);
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
      for (const point of movePoints(event)) {
        dispatch({
          kind: GestureEventKind.pointerMove,
          point
        });
      }

      const isIdle = gesture?.selector.phase === SelectionPhase.idle;
      if (isIdle) {
        pointer.cursor = hoverCursor({
          state: gesture,
          point: pointerPoint(event)
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
    <SelectionOverlay image={still} state={selector} />
    <Border class="circle-tint" isHitTestVisible={false} />
    <Border class="circle-edge-glow" isHitTestVisible={false} />
    <Border class="circle-edge" isHitTestVisible={false} />

    <Canvas class="circle-layer" isHitTestVisible={false}>
      {#if view !== undefined}
        {#if selection !== undefined && view.landing !== undefined}
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

    {#if isHintShown && view !== undefined}
      {#key view.hint.text}
        <border class="circle-hint circle-hint-frame" in:hintEnter out:hintLeave>
          <TextBlock class="circle-hint-text" text={view.hint.text} />
        </border>
      {/key}
    {/if}

    <Canvas class="circle-layer">
      {#if view !== undefined && selection !== undefined}
        {#if isTextMode}
          <CircleBar oncancel={cancel} screen={screenSize} {selection}>
            <CircleAction
              isDisabled={picked.length === 0}
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
          {#if view.chips.length > 0}
            <CircleChips chips={view.chips} onpress={onchip} {selection} />
          {/if}
          <CircleBar oncancel={cancel} screen={screenSize} {selection}>
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
              label={SEARCH_ENGINES[CORE_SEARCH_ACTION].label}
              onpress={() => dispatch({
                kind: GestureEventKind.finish,
                action: CORE_SEARCH_ACTION
              })}
              shortcut={SEARCH_ENGINES[CORE_SEARCH_ACTION].keys.toUpperCase()}
            >
              {#snippet icon()}
                <TextBlock class="circle-icon" text={SEARCH_ENGINES[CORE_SEARCH_ACTION].glyph} />
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
            <!-- Other engines: one small button opens the list, so the core actions stay alone -->
            <CircleAction
              isPrimary={false}
              label="More"
              onpress={() => {
                chooser.isOpen = !chooser.isOpen;
              }}
              shortcut="Other search engines"
            >
              {#snippet icon()}
                <TextBlock class="circle-icon" text={OverlayGlyph.search} />
              {/snippet}
            </CircleAction>
            {#if chooser.isOpen}
              {#each extraActions as action (action)}
                <CircleAction
                  isPrimary={false}
                  label={SEARCH_ENGINES[action].label}
                  onpress={() => dispatch({
                    kind: GestureEventKind.finish,
                    action
                  })}
                  shortcut={SEARCH_ENGINES[action].keys.toUpperCase()}
                >
                  {#snippet icon()}
                    <TextBlock class="circle-icon" text={SEARCH_ENGINES[action].glyph} />
                  {/snippet}
                </CircleAction>
              {/each}
            {/if}
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

  .circle-edge {
    border-width: 3px;
  }

  .circle-edge-glow {
    border-width: 14px;
    opacity: 0.7;
    filter: blur(28px);
  }

  .circle-layer {
    width: 100%;
    height: 100%;
  }

  .circle-flash {
    position: absolute;
    background-color: #ffffff;
    opacity: 0;
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
