<script lang="ts">
  import { arePreviewsOpen } from "@/lib/display/display-previews.svelte.ts";
  import { setPillWindow } from "@/lib/pill-window.ts";
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import { holdVoiceLevel } from "@/lib/voice-level.svelte.ts";
  import CaptionCard from "@/ui/caption/CaptionCard.svelte";
  import { collapse } from "@/ui/fold/collapse.svelte.ts";
  import { foldWithPill } from "@/ui/motion/card-fold.ts";
  import { pillEnter, pillExit } from "@/ui/motion/motion.ts";
  import Glow from "@/ui/pill/Glow.svelte";
  import Pill from "@/ui/pill/Pill.svelte";
  import { heldWindowRegions } from "@/ui/window/held-regions.svelte.ts";
  import { measureParts, PillPart, trackPart } from "@/ui/window/places.svelte.ts";
  import { themeRebuilds } from "@/ui/window/theme-rebuild.svelte.ts";
  import { clipToShownPart } from "@/ui/window/window-clip.svelte.ts";
  import { dockPillWindow, followDisplayChanges } from "@/ui/window/window-dock.ts";
  import { PillActionKind } from "@gemini-live/protocol/view";
  import { elementSize } from "winui-svelte";
  import { Window } from "winui-svelte/components";
  import type { WindowHandle } from "winui-svelte/components";
  import { enableElementAnimation } from "winui-svelte/element-animation";
  import { exitApplication, systemSettings, WindowTheme } from "winui-svelte/window";

  enableElementAnimation();
  holdVoiceLevel();

  const settings = systemSettings();
  const content = elementSize();
  const windowRef: { handle: WindowHandle | undefined } = $state({ handle: undefined });
  let isExitDone = $state(true);
  let isDocked = $state(false);

  const theme = themeRebuilds(() => settings.isDarkTheme);

  // The window keeps one height through a conversation, with its content at the bottom: a window that
  // grew with each line of the card moved at once while WinUI drew the content a frame later, so the
  // pill jumped up a line's height and back. Tall enough for the card at its tallest above the pill;
  // content taller still makes it grow.
  const WINDOW_HEIGHT = 480;

  // Clipped only once the entrance is over (see clipToShownPart). The scale is kept as state so a change
  // of resolution or scaling clips the window again in its new physical pixels.
  let isEntered = $state(false);
  let windowScale = $state(1);
  clipToShownPart({
    handle: () => windowRef.handle,
    scale: () => windowScale,
    isEntered: () => isEntered
  });

  const isWindowHidden = $derived(!isDocked && isExitDone);
  const isBeingCaptured = $derived(arePreviewsOpen());

  const regions = heldWindowRegions();

  const displayLayout = $derived(JSON.stringify(view.displays));

  // The window is shown, and the pill's entrance starts, only once it sits on its display: showing it
  // first and docking after made it jump while it rose
  $effect(() => {
    void displayLayout;
    void view.pillDisplay;

    if (!view.isShown) {
      isDocked = false;
      return;
    }

    isDocked = dock();

    if (isDocked) {
      isExitDone = false;
    }
  });

  function dock() {
    return dockPillWindow(windowRef.handle);
  }

  // A display changed (a new resolution, the taskbar moved): back to the corner at once while shown
  $effect(() =>
    followDisplayChanges(() => {
      if (view.isShown) {
        dock();
      }
    }));

  // A new scale (scaling changed, or the window reached a display with another): back to its corner,
  // and clipped again in the new pixels
  function rescale(scale: number) {
    windowScale = scale;
    dock();
  }

  function dropFocusable(isActive: boolean) {
    const isKeepingFocus = isActive || view.isKeyPromptShown || !view.isFocusable;
    if (isKeepingFocus) {
      return;
    }

    sendAction({
      kind: PillActionKind.SET_FOCUSABLE,
      isFocusable: false
    });
  }
</script>

<Window
  activate={false}
  anchor="bottomRight"
  backdrop="transparent"
  dragRegions={regions.dragRegions}
  isActivatable={view.isFocusable}
  isAlwaysOnTop
  isBorderless
  isExcludedFromCapture={isBeingCaptured}
  isHidden={isWindowHidden}
  isResizable={false}
  isToolWindow
  minHeight={WINDOW_HEIGHT}
  onactivechanged={dropFocusable}
  onclosed={exitApplication}
  onscalechanged={rescale}
  passthroughRegions={regions.passthroughRegions}
  sizeToContent="both"
  theme={settings.isDarkTheme ? WindowTheme.dark : WindowTheme.light}
  title="Gemini Live"
  bind:handle={() => windowRef.handle, handle => {
    windowRef.handle = handle;
    setPillWindow(handle);
  }}
>
  <grid class="root" {@attach content.attach} {@attach trackPart(PillPart.ROOT)}>
    {#key theme.epoch}
      {#if view.isShown && isDocked}
        <stack-panel
          class="dock"
          onintroend={() => {
            // The rise ran no layout pass, so the places are still where it started
            measureParts();
            isEntered = true;
          }}
          onoutroend={() => {
            isExitDone = true;
          }}
          onoutrostart={() => {
            isEntered = false;
          }}
          in:pillEnter
          out:pillExit
        >
          <!-- Kept in the layout while folded, only unseen (foldWithPill owns its opacity); the clip
               around the orb leaves it out entirely once the orb settles -->
          <border
            {@attach foldWithPill()}
            {@attach trackPart(PillPart.CARD)}
            isHitTestVisible={!collapse.isCollapsed}
          >
            <CaptionCard />
          </border>
          <Glow>
            <Pill />
          </Glow>
        </stack-panel>
      {/if}
    {/key}
  </grid>
</Window>

<style>
  .root {
    padding-top: 16px;
    padding-right: 18px;
    padding-bottom: 8px;
    padding-left: 18px;
  }

  /* At the bottom of a window taller than it, so it sits on the taskbar whatever the card holds */
  .dock {
    align-self: end;
  }
</style>
