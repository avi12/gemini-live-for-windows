<script lang="ts">
  import { errorMessage } from "@/lib/error-message.ts";
  import type { ChipAction } from "@/overlays/circle/chips/chip.ts";
  import CircleChips from "@/overlays/circle/chips/circle-chips.svelte";
  import CircleAction from "@/overlays/circle/circle-action.svelte";
  import CircleBar from "@/overlays/circle/circle-bar.svelte";
  import CircleCancel from "@/overlays/circle/circle-cancel.svelte";
  import type { CircleView } from "@/overlays/circle/controller.ts";
  import { createClickCounter } from "@/overlays/circle/gesture/click-counter.ts";
  import { cornerRadius, roundedRectsPath, WORD_RADIUS } from "@/overlays/circle/gesture/geometry.ts";
  import { CircleCursor, GestureEventKind, hoverCursor, pickedWords } from "@/overlays/circle/gesture/gesture.ts";
  import type { GestureEvent } from "@/overlays/circle/gesture/gesture.ts";
  import { movePoints, pointerPoint } from "@/overlays/circle/gesture/pointer-points.ts";
  import { createPointerTracker, PressVerdict } from "@/overlays/circle/gesture/pointer-tracker.ts";
  import { withoutStaleStroke } from "@/overlays/circle/gesture/stale-stroke.ts";
  import { CORE_SEARCH_ACTION, extraSearchActions, SEARCH_ENGINES } from "@/overlays/circle/search-engines.ts";
  import { OverlayGlyph } from "@/overlays/glyphs.ts";
  import { fadeOut, riseIn, sheenIn, TransformOrigin } from "@/overlays/motion/transitions.ts";
  import { CircleAction as CircleActionName } from "@/overlays/protocol.ts";
  import type { SearchAction } from "@/overlays/protocol.ts";
  import type { Size } from "@/overlays/shapes.ts";
  import { CircleKeyCombination, keyName } from "@/overlays/window/hotkeys.ts";
  import { reassertTopmost } from "@/overlays/window/topmost.ts";
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
  import "winui-svelte/css/environment";
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
  // The overlay fades the loop over 260 ms after release
  const STROKE_FADE_MILLISECONDS = 400;
  // Gemini's four-point sparkle, in an 18-unit box (the C# draws it in 24 and scales)
  const SPARKLE = "M9,0 C9,4.95 13.05,9 18,9 C13.05,9 9,13.05 9,18 C9,13.05 4.95,9 0,9 C4.95,9 9,4.95 9,0 Z";

  const screen = elementSize();
  const theme = windowTheme();
  const reducedMotion = mediaQuery("(prefers-reduced-motion: reduce)");
  const clicks = createClickCounter();
  const tracker = createPointerTracker();
  const windowRef: { handle: WindowHandle | undefined } = $state({ handle: undefined });
  const pointer: { cursor: CircleCursor } = $state({ cursor: CircleCursor.draw });
  const fadedHintRevision: { value: number | undefined } = $state({ value: undefined });
  const strokeFade: { isDone: boolean } = $state({ isDone: false });
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
  const overlayState = $derived(
    withoutStaleStroke({
      state: selector,
      isStrokeFaded: strokeFade.isDone
    })
  );
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

  const isBarShown = $derived(
    selection !== undefined && view !== undefined && (isTextMode || !view.gesture.isAskOnRelease)
  );
  const isHintShown = $derived(view?.hint.isVisible === true && fadedHintRevision.value !== view.hint.revision);

  function pressDown(event: PointerEvent) {
    const verdict = tracker.press(event);
    const isCancel = verdict === PressVerdict.cancel;
    if (isCancel) {
      dispatch({ kind: GestureEventKind.escape });
      return;
    }

    const isIgnored = verdict === PressVerdict.ignore;
    if (isIgnored) {
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
  }

  function moveTo(event: PointerEvent) {
    const isStranger = !tracker.isFollowed(event.pointerId);
    if (isStranger) {
      return;
    }

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
  }

  function pressUp(event: PointerEvent) {
    const isStranger = !tracker.release(event.pointerId);
    if (isStranger) {
      return;
    }

    releasePointerCapture({
      control: event.currentTarget,
      pointerId: event.pointerId
    });
    dispatch({ kind: GestureEventKind.pointerUp });
  }

  function endPress(event: PointerEvent) {
    const isStranger = !tracker.release(event.pointerId);
    if (isStranger) {
      return;
    }

    dispatch({ kind: GestureEventKind.pointerUp });
  }

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

  // The loop fades by itself after release (the overlay's own transition); once it has, the
  // stroke is dropped, and a press that moves or resizes the selection drops it at once
  $effect(() => {
    const isFading = selector.phase === SelectionPhase.idle && selector.selection !== undefined;
    if (!isFading) {
      strokeFade.isDone = false;
      return;
    }

    return startTimer({
      milliseconds: STROKE_FADE_MILLISECONDS,
      isRepeating: false,
      onTick() {
        strokeFade.isDone = true;
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

    reassertTopmost(handle.presenter);
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
    onpointercancel={endPress}
    onpointercapturelost={endPress}
    onpointerdown={pressDown}
    onpointermove={moveTo}
    onpointerup={pressUp}
    role="presentation"
  >
    <SelectionOverlay image={still} state={overlayState} />
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

    {#if !isBarShown}
      <!-- Touch has no Esc: the X is on screen before the first loop too -->
      <border
        class="circle-corner-cancel"
        onpointerdown={(event: PointerEvent) => event.stopPropagation()}
        role="presentation"
      >
        <CircleCancel onpress={cancel} />
      </border>
    {/if}

    <Canvas class="circle-layer">
      {#if view !== undefined && selection !== undefined}
        {#if isTextMode}
          <CircleBar oncancel={cancel} screen={screenSize} {selection}>
            <CircleAction
              isDisabled={picked.length === 0}
              isLabelled
              isPrimary
              label="Copy"
              onpress={() => dispatch({ kind: GestureEventKind.copy })}
              shortcut={keyName(CircleKeyCombination.copy)}
            >
              {#snippet icon()}
                <TextBlock class="circle-icon circle-primary-ink" text={OverlayGlyph.copy} />
              {/snippet}
            </CircleAction>
            <CircleAction
              isLabelled={false}
              isPrimary={false}
              label="Done"
              onpress={() => dispatch({ kind: GestureEventKind.leaveText })}
              shortcut={keyName(CircleKeyCombination.escape)}
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
              isLabelled
              isPrimary
              label="Ask Gemini"
              onpress={() => dispatch({
                kind: GestureEventKind.finish,
                action: CircleActionName.askGemini
              })}
              shortcut={keyName(CircleKeyCombination.askGemini)}
            >
              {#snippet icon()}
                <Path class="circle-sparkle" data={SPARKLE} />
              {/snippet}
            </CircleAction>
            <CircleAction
              isLabelled={false}
              isPrimary={false}
              label={SEARCH_ENGINES[CORE_SEARCH_ACTION].label}
              onpress={() => dispatch({
                kind: GestureEventKind.finish,
                action: CORE_SEARCH_ACTION
              })}
              shortcut={keyName(SEARCH_ENGINES[CORE_SEARCH_ACTION].keys)}
            >
              {#snippet icon()}
                <TextBlock class="circle-icon" text={SEARCH_ENGINES[CORE_SEARCH_ACTION].glyph} />
              {/snippet}
            </CircleAction>
            <CircleAction
              isDisabled={view.gesture.isReading}
              isLabelled={false}
              isPrimary={false}
              label="Select text"
              onpress={() => dispatch({ kind: GestureEventKind.selectText })}
              shortcut={keyName(CircleKeyCombination.selectText)}
            >
              {#snippet icon()}
                <TextBlock class="circle-icon" text={OverlayGlyph.textSelect} />
              {/snippet}
            </CircleAction>
            <!-- Other engines: one small button opens the list, so the core actions stay alone -->
            <CircleAction
              isLabelled={false}
              isPrimary={false}
              label="More"
              onpress={() => {
                chooser.isOpen = !chooser.isOpen;
              }}
            >
              {#snippet icon()}
                <TextBlock class="circle-icon" text={OverlayGlyph.more} />
              {/snippet}
            </CircleAction>
            {#if chooser.isOpen}
              {#each extraActions as action (action)}
                <CircleAction
                  isLabelled
                  isPrimary={false}
                  label={SEARCH_ENGINES[action].label}
                  onpress={() => dispatch({
                    kind: GestureEventKind.finish,
                    action
                  })}
                  shortcut={keyName(SEARCH_ENGINES[action].keys)}
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
  }

  .circle-corner-cancel {
    align-self: start;
    justify-self: end;
    margin: 28px;
  }

  .circle-hint-text {
    font-size: 14px;
  }

  .circle-icon {
    font-family: "Material Symbols Rounded";
    font-size: 18px;
  }
</style>
