<script lang="ts">
  import "./theme.css";
  import { setPillWindow } from "@/lib/pill-window.ts";
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import { holdVoiceLevel } from "@/lib/voice-level.svelte.ts";
  import CaptionCard from "@/ui/CaptionCard.svelte";
  import Glow from "@/ui/Glow.svelte";
  import { pillEnter, pillExit } from "@/ui/motion/motion.ts";
  import Pill from "@/ui/Pill.svelte";
  import { PillPart, placeOf } from "@/ui/places.svelte.ts";
  import { PillActionKind } from "@gemini-live/protocol/view";
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

  const PILL_WIDTH = 504;
  const DOCK_INSET = 6;
  const BUTTON_PARTS = [PillPart.share, PillPart.mic, PillPart.gear, PillPart.end] as const;

  enableElementAnimation();
  holdVoiceLevel();

  const settings = systemSettings();
  const content = elementSize();
  const windowRef: { handle: WindowHandle | undefined } = $state({ handle: undefined });
  let isExitDone = $state(true);
  let isDocked = $state(false);

  const isWindowHidden = $derived(!isDocked && isExitDone);

  const pillPlace = $derived(placeOf(PillPart.pill));
  const dragRegions = $derived([pillPlace].filter(place => place !== undefined));

  const passthroughRegions = $derived(
    BUTTON_PARTS.map(part => placeOf(part)).filter(place => place !== undefined)
  );

  const displayLayout = $derived(view.displays.map(display => `${display.id} ${display.name}`).join("|"));

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
    return true;
  }

  function dropFocusable(isActive: boolean) {
    const isKeepingFocus = isActive || view.isKeyPromptShown || !view.isFocusable;
    if (isKeepingFocus) {
      return;
    }

    sendAction({
      kind: PillActionKind.setFocusable,
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
  isExcludedFromCapture
  isHidden={isWindowHidden}
  isResizable={false}
  isToolWindow
  onactivechanged={dropFocusable}
  onclosed={exitApplication}
  onscalechanged={dock}
  {passthroughRegions}
  sizeToContent="height"
  theme={settings.isDarkTheme ? WindowTheme.dark : WindowTheme.light}
  title="Gemini Live"
  width={PILL_WIDTH}
  bind:handle={() => windowRef.handle, handle => {
    windowRef.handle = handle;
    setPillWindow(handle);
  }}
>
  <stack-panel class="root" {@attach content.attach}>
    {#if view.isShown && isDocked}
      <stack-panel
        onoutroend={() => {
          isExitDone = true;
        }}
        in:pillEnter
        out:pillExit
      >
        <CaptionCard />
        <Glow>
          <Pill />
        </Glow>
      </stack-panel>
    {/if}
  </stack-panel>
</Window>

<style>
  .root {
    padding-top: 16px;
    padding-right: 18px;
    padding-bottom: 8px;
    padding-left: 18px;
  }
</style>
