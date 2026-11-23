import type { Monitor } from "@/contracts/monitor.ts";
import type { PillContext } from "@/pill/context.ts";
import { describeUpdate } from "@/pill/menus/update-menu.ts";

// A display as the pill's view carries it
export function displayView(monitor: Monitor) {
  return {
    id: monitor.deviceName,
    index: monitor.index,
    isPrimary: monitor.isPrimary,
    refreshRateHertz: monitor.refreshRateHertz,
    x: monitor.x,
    y: monitor.y,
    width: monitor.width,
    height: monitor.height,
    workRight: monitor.workRight,
    workBottom: monitor.workBottom
  };
}

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
    displays: state.displays.map(displayView),
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
