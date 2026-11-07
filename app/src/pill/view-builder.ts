import { EngineKind } from "@/contracts/live-engine.ts";
import { monitorName } from "@/contracts/monitor.ts";
import type { PillContext } from "@/pill/context.ts";
import { describeMonitor } from "@/pill/menus/displays.ts";
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
      name: describeMonitor(display)
    })),
    sharedDisplay: shared?.deviceName ?? null,
    sharedDisplayName: shared === undefined ? null : monitorName(shared),
    isExtensionNeeded: state.isExtensionNeeded,
    isExtensionStepsShown: state.isExtensionStepsShown,
    isKeyPromptShown: state.isKeyPromptShown,
    engine: deps.settings.engine,
    microphones: [...state.microphones],
    microphoneId: deps.settings.microphoneId,
    isCameraAvailable: deps.settings.engine === EngineKind.google,
    isCameraShared: state.conversation?.isCameraShared ?? false,
    update: describeUpdate(context),
    glow: state.glow,
    isShown: state.isShown,
    isFocusable: state.isFocusable
  };
}
