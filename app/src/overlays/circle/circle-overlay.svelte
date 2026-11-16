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
  import {
    CircleCursor,
    CopyLabel,
    GestureEventKind,
    hoverCursor,
    pickedWords
  } from "@/overlays/circle/gesture/gesture.ts";
  import type { GestureEvent } from "@/overlays/circle/gesture/gesture.ts";
  import { movePoints, pointerPoint } from "@/overlays/circle/gesture/pointer-points.ts";
  import { createPointerTracker, PressVerdict } from "@/overlays/circle/gesture/pointer-tracker.ts";
  import { withoutStaleStroke } from "@/overlays/circle/gesture/stale-stroke.ts";
  import {
    bracketPath,
    GLOW_GRADIENTS,
    GLOW_LAYERS,
    GlowSide,
    glowSidePaths,
    outsetRect
  } from "@/overlays/circle/glow-geometry.ts";
  import { CORE_SEARCH_ACTION, SEARCH_ENGINES } from "@/overlays/circle/search-engines.ts";
  import { OverlayGlyph } from "@/overlays/glyphs.ts";
  import { fadeOut, riseIn, sheenIn, TransformOrigin } from "@/overlays/motion/transitions.ts";
  import { CircleAction as CircleActionName, SearchAction as SearchActionName } from "@/overlays/protocol.ts";
  import type { Size } from "@/overlays/shapes.ts";
  import { CircleKeyCombination, keyName } from "@/overlays/window/hotkeys.ts";
  import { reassertTopmost } from "@/overlays/window/topmost.ts";
  import { windowTheme } from "@/overlays/window/window-theme.svelte.ts";
  import { setWindowOpacity } from "@/win32/index.ts";
  import "@gemini-live/pill/theme.css";
  import { elementSize } from "winui-svelte";
  import {
    Border,
    Button,
    Canvas,
    GradientStop,
    LinearGradientBrush,
    MenuFlyout,
    MenuFlyoutItem,
    Path,
    SelectionOverlay,
    TextBlock,
    Window
  } from "winui-svelte/components";
  import type { WindowHandle } from "winui-svelte/components";
  import "winui-svelte/css/environment";
  import { releasePointerCapture, setPointerCapture } from "winui-svelte/input";
  import type { PointerEvent } from "winui-svelte/input";
  import { createSelector, SelectionPhase, textSelection } from "winui-svelte/selection";
  import { mediaQuery, startTimer } from "winui-svelte/window";

  interface Props {
    // Which use of the window this is: 0 while it stands by hidden, a new number for each use. The
    // window is made once and reused, since a new one flashes white for a moment as it appears
    session: number;
    // The display the window covers exactly, by the id Windows lists it under
    displayId: bigint;
    // The frozen display, a JPEG
    still: Uint8Array;
    // Undefined until the window knows its size and the controller exists
    view: CircleView | undefined;
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
    session,
    displayId,
    still,
    view,
    dispatch,
    onchip,
    onsized,
    ondeactivated,
    onready,
    onfailed
  }: Props = $props();

  // The window's own opacity while it is laid out unseen, and once it is shown
  const INVISIBLE = 0;
  const OPAQUE = 255;
  // How long the window is shown at start-up, unseen, to draw its first frame
  const WARM_UP_MILLISECONDS = 800;
  // How long the covering window gets to load and paint its still, unseen, before it is shown
  const PAINT_SETTLE_MILLISECONDS = 250;
  // How long the measured size must stay the same before the controller is built on it
  const SIZE_SETTLE_MILLISECONDS = 120;
  // The white sheen that sweeps the selection the moment it lands
  const FLASH_OPACITY = 0.45;
  // The how-to at top centre drops in from slightly above
  const HINT_DROP = -12;
  // How long a notice ("Copied") stays in the hint chip before it fades
  const NOTICE_MILLISECONDS = 1600;
  // Gemini's four-point sparkle, in an 18-unit box (the C# draws it in 24 and scales)
  const GLOW_SIDES = Object.values(GlowSide);
  const SPARKLE = "M9,0 C9,4.95 13.05,9 18,9 C13.05,9 9,13.05 9,18 C9,13.05 4.95,9 0,9 C4.95,9 9,4.95 9,0 Z";

  const screen = elementSize();
  const theme = windowTheme();
  const reducedMotion = mediaQuery("(prefers-reduced-motion: reduce)");
  const clicks = createClickCounter();
  const tracker = createPointerTracker();
  const windowRef: { handle: WindowHandle | undefined } = $state({ handle: undefined });
  const pointer: { cursor: CircleCursor } = $state({ cursor: CircleCursor.draw });
  const fadedHintRevision: { value: number | undefined } = $state({ value: undefined });
  const placement: {
    isCovered: boolean;
    isSettled: boolean;
  } = $state({
    isCovered: false,
    isSettled: false
  });
  // A window that has never been shown draws nothing until its first show, so a blank frame would
  // follow it onto the display: it is shown once at start-up, unseen and without focus, then hidden
  const warmUp: { isDone: boolean } = $state({ isDone: false });

  const isInUse = $derived(session > 0);
  const isReduced = $derived(reducedMotion.matches);
  const gesture = $derived(view?.gesture);
  const selection = $derived(gesture?.selector.selection);
  const isTextMode = $derived(gesture?.isTextMode === true);
  const screenSize = $derived({
    width: screen.width,
    height: screen.height
  });

  // Before the controller exists the window shows the still alone: a selector with nothing in it
  const selector = $derived(gesture?.selector ?? createSelector({ bounds: screenSize }));
  const overlayState = $derived(
    withoutStaleStroke(selector)
  );
  const picked = $derived.by(() => {
    const isUnstarted = gesture === undefined;
    if (isUnstarted) {
      return [];
    }

    return pickedWords(gesture);
  });

  // What a copy would take, shown above the bar's buttons
  const preview = $derived(gesture === undefined ? undefined : textSelection(gesture.text)?.text);

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
      origin: TransformOrigin.TOP
    })
  );
  const hintLeave = $derived(fadeOut({ isReduced }));

  const isBarShown = $derived(
    selection !== undefined && view !== undefined && (isTextMode || !view.gesture.isAskOnRelease)
  );
  const isHintShown = $derived(view?.hint.isVisible === true && fadedHintRevision.value !== view.hint.revision);

  function pressDown(event: PointerEvent) {
    const verdict = tracker.press(event);
    const isCancel = verdict === PressVerdict.CANCEL;
    if (isCancel) {
      dispatch({ kind: GestureEventKind.ESCAPE });
      return;
    }

    const isIgnored = verdict === PressVerdict.IGNORE;
    if (isIgnored) {
      return;
    }

    const point = pointerPoint(event);
    setPointerCapture({
      control: event.currentTarget,
      pointerId: event.pointerId
    });
    dispatch({
      kind: GestureEventKind.POINTER_DOWN,
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
        kind: GestureEventKind.POINTER_MOVE,
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
    dispatch({ kind: GestureEventKind.POINTER_UP });
  }

  function endPress(event: PointerEvent) {
    const isStranger = !tracker.release(event.pointerId);
    if (isStranger) {
      return;
    }

    dispatch({ kind: GestureEventKind.POINTER_UP });
  }

  function cancel() {
    dispatch({ kind: GestureEventKind.CANCEL });
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
    // Only once the window was shown and covered the display again: until then it has its default
    // size, not the display's. The size must also hold still for a moment, since the layout
    // follows the window's resize a beat late
    const isMeasured = placement.isSettled && screen.width > 0 && screen.height > 0;
    if (!isMeasured) {
      return;
    }

    const size = {
      width: screen.width,
      height: screen.height
    };
    return startTimer({
      milliseconds: SIZE_SETTLE_MILLISECONDS,
      isRepeating: false,
      onTick() {
        onsized(size);
      }
    });
  });

  $effect(() => {
    const handle = windowRef.handle;
    const isWarming = handle !== undefined && !warmUp.isDone;
    if (!isWarming) {
      return;
    }

    setWindowOpacity({
      hwnd: handle.appWindow.id.value,
      opacity: INVISIBLE
    });
    return startTimer({
      milliseconds: WARM_UP_MILLISECONDS,
      isRepeating: false,
      onTick() {
        warmUp.isDone = true;
      }
    });
  });

  // A window moved to a display with another scale takes that move at the old display's scale, so
  // it ends up the wrong size; covering again, now that it sits there, sizes it right
  function coverDisplay(handle: WindowHandle) {
    handle.cover({ display: displayId });
    handle.cover({ display: displayId });
  }

  // Each use starts from a clean window: nothing covered, no loop fading, no notice
  $effect.pre(() => {
    void session;
    placement.isCovered = false;
    placement.isSettled = false;
    fadedHintRevision.value = undefined;
    pointer.cursor = CircleCursor.draw;
  });

  $effect(() => {
    const handle = windowRef.handle;
    const isPlaced = handle !== undefined && isInUse && !placement.isCovered;
    if (!isPlaced) {
      return;
    }

    // Invisible before anything can show it: Windows paints a blank surface on a window's first
    // frames, which nobody must see
    const hwnd = handle.appWindow.id.value;
    setWindowOpacity({
      hwnd,
      opacity: INVISIBLE
    });
    try {
      coverDisplay(handle);
    } catch (error) {
      onfailed(errorMessage(error));
      return;
    }

    reassertTopmost(handle.presenter);
    placement.isCovered = true;
  });

  // Revealed once it has had a moment to paint, then raised: Windows only brings a visible window to
  // the front
  $effect(() => {
    const handle = windowRef.handle;
    const isReady = handle !== undefined && placement.isCovered;
    if (!isReady) {
      return;
    }

    return startTimer({
      milliseconds: PAINT_SETTLE_MILLISECONDS,
      isRepeating: false,
      onTick() {
        const hwnd = handle.appWindow.id.value;
        // A window shown for the first time is put back at its default size and place by that first
        // activation, so it covers the display again now that it has been shown, still unseen
        try {
          coverDisplay(handle);
        } catch (error) {
          onfailed(errorMessage(error));
          return;
        }

        reassertTopmost(handle.presenter);
        placement.isSettled = true;
        setWindowOpacity({
          hwnd,
          opacity: OPAQUE
        });
        onready(hwnd);
      }
    });
  });
</script>

{#snippet destinationFlyout()}
  <MenuFlyout>
    <MenuFlyoutItem
      onclick={() => dispatch({
        kind: GestureEventKind.FINISH,
        action: CORE_SEARCH_ACTION
      })}
      text="Open in the side panel"
    />
    <MenuFlyoutItem
      onclick={() => dispatch({
        kind: GestureEventKind.FINISH,
        action: SearchActionName.LENS_IN_BROWSER
      })}
      text="Open in your browser"
    />
  </MenuFlyout>
{/snippet}

<Window
  activate={isInUse}
  isAlwaysOnTop
  isBorderless
  isHidden={warmUp.isDone && !placement.isCovered}
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
    {#if isInUse}
      <SelectionOverlay arm={0} image={still} state={overlayState} />
    {/if}
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

        {#if selection !== undefined}
          {#each GLOW_LAYERS as layer (layer.width)}
            {@const sides = glowSidePaths(
              outsetRect({
                rect: selection,
                radius: cornerRadius(selection),
                width: layer.width
              })
            )}
            {#each GLOW_SIDES as side (side)}
              <Path
                class="circle-glow"
                data={sides[side]}
                isHitTestVisible={false}
                opacity={layer.opacity}
                strokeThickness={layer.width}
              >
                {#snippet stroke()}
                  <LinearGradientBrush endPoint={GLOW_GRADIENTS[side].end} startPoint={GLOW_GRADIENTS[side].start}>
                    {#each GLOW_GRADIENTS[side].stops as stop (stop.offset)}
                      <GradientStop color={stop.color} offset={stop.offset} />
                    {/each}
                  </LinearGradientBrush>
                {/snippet}
              </Path>
            {/each}
          {/each}
          <Path
            class="circle-bracket"
            data={bracketPath({
              rect: selection,
              radius: cornerRadius(selection)
            })}
            isHitTestVisible={false}
          />
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
          <CircleBar oncancel={cancel} {preview} screen={screenSize} {selection}>
            <CircleAction
              isDisabled={picked.length === 0}
              isLabelled
              isPrimary
              label={gesture?.isCopied ? CopyLabel.COPIED : CopyLabel.COPY}
              onpress={() => dispatch({ kind: GestureEventKind.COPY })}
              shortcut={keyName(CircleKeyCombination.copy)}
            >
              {#snippet icon()}
                <TextBlock class="circle-icon circle-primary-ink" text={OverlayGlyph.copy} />
              {/snippet}
            </CircleAction>
            <CircleAction
              isDisabled={picked.length === 0}
              isLabelled={false}
              isPrimary={false}
              label="Search the web for the text"
              onpress={() => dispatch({ kind: GestureEventKind.SEARCH_TEXT })}
            >
              {#snippet icon()}
                <TextBlock class="circle-icon" text={OverlayGlyph.search} />
              {/snippet}
            </CircleAction>
            <!-- Done goes back to circling; the bar's own X, after it, cancels the whole overlay -->
            <CircleAction
              isLabelled
              isPrimary={false}
              label="Done"
              onpress={() => dispatch({ kind: GestureEventKind.LEAVE_TEXT })}
              shortcut={keyName(CircleKeyCombination.escape)}
            />
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
                kind: GestureEventKind.FINISH,
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
                kind: GestureEventKind.FINISH,
                action: CORE_SEARCH_ACTION
              })}
              shortcut={keyName(SEARCH_ENGINES[CORE_SEARCH_ACTION].keys)}
            >
              {#snippet icon()}
                <TextBlock class="circle-icon" text={SEARCH_ENGINES[CORE_SEARCH_ACTION].glyph} />
              {/snippet}
            </CircleAction>
            <Button
              class="circle-action circle-round"
              automationName="Where to open the results"
              flyout={destinationFlyout}
              toolTip="Open the results in the side panel or your browser"
            >
              <TextBlock class="circle-icon" text={OverlayGlyph.more} />
            </Button>
            <CircleAction
              isDisabled={view.gesture.isReading}
              isLabelled={false}
              isPrimary={false}
              label="Select text"
              onpress={() => dispatch({ kind: GestureEventKind.SELECT_TEXT })}
              shortcut={keyName(CircleKeyCombination.selectText)}
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
  /* The still covers all of it; until that paints, the window shows black (a dimming starting), not white */
  .circle-root {
    background-color: #000000;
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
