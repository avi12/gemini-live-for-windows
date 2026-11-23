<script lang="ts">
  import "./theme.css";
  import { arePreviewsOpen } from "@/lib/display-previews.svelte.ts";
  import { clipPillWindow, setPillWindow } from "@/lib/pill-window.ts";
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import { holdVoiceLevel } from "@/lib/voice-level.svelte.ts";
  import CaptionCard from "@/ui/CaptionCard.svelte";
  import Glow from "@/ui/Glow.svelte";
  import { foldWithPill } from "@/ui/motion/card-fold.ts";
  import { pillEnter, pillExit } from "@/ui/motion/motion.ts";
  import Pill from "@/ui/Pill.svelte";
  import { collapse } from "@/ui/collapse.svelte.ts";
  import { BUTTON_PARTS, PillPart, placeOf, trackPart } from "@/ui/places.svelte.ts";
  import { PillActionKind } from "@gemini-live/protocol/view";
  import type { PillRegion } from "@gemini-live/protocol/view";
  import { tick } from "svelte";
  import { elementSize } from "winui-svelte";
  import { Window } from "winui-svelte/components";
  import type { WindowHandle } from "winui-svelte/components";
  import { enableElementAnimation } from "winui-svelte/element-animation";
  import {
    DockDisplay,
    exitApplication,
    systemSettings,
    WindowAnchor,
    WindowTheme
  } from "winui-svelte/window";

  const DOCK_INSET = 6;

  enableElementAnimation();
  holdVoiceLevel();

  const settings = systemSettings();
  const content = elementSize();
  const windowRef: { handle: WindowHandle | undefined } = $state({ handle: undefined });
  let isExitDone = $state(true);
  let isDocked = $state(false);

  // WinUI leaves controls that already exist on the old theme's colors when the system theme flips, so
  // the content is rebuilt once the window has taken the new theme. The tick waits for that: a rebuild
  // in the same pass would resolve its colors against the old theme again.
  let themeEpoch = $state(0);
  let shownTheme = settings.isDarkTheme;
  $effect(() => {
    const isDark = settings.isDarkTheme;
    if (isDark === shownTheme) {
      return;
    }

    shownTheme = isDark;
    void tick().then(() => {
      themeEpoch += 1;
    });
  });

  // The window keeps one height through a conversation, with its content at the bottom: a window that
  // grew with each line of the card moved at once while WinUI drew the content a frame later, so the
  // pill jumped up a line's height and back. Tall enough for the card at its tallest above the pill;
  // content taller still makes it grow.
  const WINDOW_HEIGHT = 480;

  // The window shows only what is there and takes clicks only there: the folded orb once it has
  // settled; otherwise the band from the card's top (or the pill's, with no card) down, with room for
  // the glow above it. Sent only when it changes.
  const CLIP_MARGIN = 2;
  const GLOW_ROOM = 16;
  let sentClip = JSON.stringify(null);
  // The orb's place is measured through the entrance's rise and scale, so a clip taken then misses the
  // orb where it settles and the window takes no click on it: clip only once the entrance is over
  let isEntered = $state(false);

  interface Place {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  // A place's top in the window's physical pixels. Places are measured against the root, which sits on
  // the window's bottom edge, so it is counted up from there: true whatever the root starts at
  function windowTopOf({ y, root, clientHeight, scale }: { y: number; root: Place; clientHeight: number; scale: number }) {
    return clientHeight - (root.y + root.height - y) * scale;
  }

  function regionOf({ pill, card, root }: { pill: Place; card: Place | undefined; root: Place }) {
    const handle = windowRef.handle;
    if (handle === undefined) {
      return null;
    }

    const { scale } = handle;
    const client = handle.appWindow.clientSize;
    const isOrb = collapse.isCollapsed && !collapse.isGliding;
    if (isOrb) {
      const top = windowTopOf({
        y: pill.y,
        root,
        clientHeight: client.height,
        scale
      });
      return {
        x: Math.max(0, Math.floor(pill.x * scale) - CLIP_MARGIN),
        y: Math.max(0, Math.floor(top) - CLIP_MARGIN),
        width: Math.ceil(pill.width * scale) + CLIP_MARGIN * 2,
        height: Math.ceil(pill.height * scale) + CLIP_MARGIN * 2
      };
    }

    const top = windowTopOf({
      y: Math.min(pill.y, card?.y ?? Infinity) - GLOW_ROOM,
      root,
      clientHeight: client.height,
      scale
    });
    const y = Math.max(0, Math.floor(top));
    return {
      x: 0,
      y,
      width: client.width,
      height: client.height - y
    };
  }

  $effect(() => {
    const pill = placeOf(PillPart.PILL);
    const card = placeOf(PillPart.CARD);
    const root = placeOf(PillPart.ROOT);
    const isMeasured = isEntered && pill !== undefined && root !== undefined;
    const region: PillRegion | null = isMeasured ? regionOf({
      pill,
      card,
      root
    }) : null;
    const key = JSON.stringify(region);
    if (key === sentClip) {
      return;
    }

    sentClip = key;
    void clipPillWindow(region);
  });

  const isWindowHidden =$derived(!isDocked && isExitDone);
  const isBeingCaptured = $derived(arePreviewsOpen());

  let dragRegions: Place[] = $state([]);
  let passthroughRegions: Place[] = $state([]);

  // Applying the regions costs milliseconds each time, and a glide moves the pill and its buttons on
  // every frame: they are held as they were while it runs (a click mid-glide does not matter) and
  // follow the settled places once it ends. Gliding is read first, so a held run does not read the places.
  $effect(() => {
    if (collapse.isGliding) {
      return;
    }

    dragRegions = [placeOf(PillPart.PILL)].filter(place => place !== undefined);
    // A button of the face that is not shown is still built, at no size: it takes no clicks
    passthroughRegions = BUTTON_PARTS.map(part => placeOf(part)).filter(
      (place): place is Place => place !== undefined && place.width > 0 && place.height > 0
    );
  });

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
    const handle = windowRef.handle;
    if (!handle) {
      return false;
    }

    const target = view.displays.find(display => display.id === view.pillDisplay);
    if (target) {
      handle.appWindow.move({
        x: target.x + DOCK_INSET,
        y: target.y + DOCK_INSET
      });
    }

    handle.dock({
      anchor: WindowAnchor.bottomRight,
      inset: DOCK_INSET,
      display: DockDisplay.current
    });
    handle.presenter.isAlwaysOnTop = true;
    return true;
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
  {dragRegions}
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
  onscalechanged={dock}
  {passthroughRegions}
  sizeToContent="both"
  theme={settings.isDarkTheme ? WindowTheme.dark : WindowTheme.light}
  title="Gemini Live"
  bind:handle={() => windowRef.handle, handle => {
    windowRef.handle = handle;
    setPillWindow(handle);
  }}
>
  <grid class="root" {@attach content.attach} {@attach trackPart(PillPart.ROOT)}>
    {#key themeEpoch}
      {#if view.isShown && isDocked}
        <stack-panel
          class="dock"
          onintroend={() => {
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
