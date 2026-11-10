import type { PillContext } from "@/pill/context.ts";
import { describeUpdate } from "@/pill/menus/update-menu.ts";

// The whole pill as one snapshot for the Svelte window; nothing in it is stored twice
export function buildView(context: PillContext) {
  const { state, deps, captions } = context;
  const shared = state.conversation?.monitor;
  return {
    status: state.status,
    statusDetail: state.statusDetail,
    isMuted: state.isMuted,
    lines: [...captions.lines],
    links: [...captions.links],
    displays: state.displays.map(display => ({
      id: display.deviceName,
      index: display.index,
      isPrimary: display.isPrimary,
      refreshRateHertz: display.refreshRateHertz,
      x: display.x,
      y: display.y,
      width: display.width,
      height: display.height
    })),
    pillDisplay: state.pillMonitor?.deviceName ?? null,
    sharedDisplay: shared?.deviceName ?? null,
    isExtensionNeeded: state.isExtensionNeeded,
    isExtensionStepsShown: state.isExtensionStepsShown,
    isKeyPromptShown: state.isKeyPromptShown,
    engine: deps.settings.engine,
    microphones: [...state.microphones],
    microphoneId: deps.settings.microphoneId,
    isCameraShared: state.conversation?.isCameraShared ?? false,
    update: describeUpdate(context),
    glow: state.glow,
    isShown: state.isShown,
    isFocusable: state.isFocusable
  };
}
