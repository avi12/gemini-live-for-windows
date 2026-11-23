import { GlowMode } from "@gemini-live/protocol/view";
import type { PillView } from "@gemini-live/protocol/view";

import { EngineKind, LiveStatus } from "@/contracts/live-engine.ts";
import type { Monitor } from "@/contracts/monitor.ts";
import { KeyTrigger } from "@/core/instance/key-trigger.ts";
import { DESK, HEADSET } from "@/pill/testing/fake-deps.ts";
import { PRIMARY, SECONDARY } from "@/pill/testing/fake-monitors.ts";
import { createFakePill, settle } from "@/pill/testing/fake-pill.ts";

// The view the fake pill shows at rest and once listening, which the tests compare against

const CHECK_UPDATE: NonNullable<PillView["update"]> = {
  readyVersion: null,
  isAutoUpdateOn: true
};

export function displayEntry(monitor: Monitor) {
  return {
    id: monitor.deviceName,
    index: monitor.index,
    isPrimary: monitor.isPrimary,
    refreshRateHertz: monitor.refreshRateHertz,
    x: monitor.x,
    y: monitor.y,
    width: monitor.width,
    height: monitor.height
  };
}

export function expectedView(overrides: Partial<PillView> = {}) {
  const view: PillView = {
    status: "",
    statusDetail: "",
    isMuted: false,
    lines: [],
    links: [],
    displays: [displayEntry(PRIMARY), displayEntry(SECONDARY)],
    pillDisplay: PRIMARY.deviceName,
    sharedDisplay: null,
    isExtensionNeeded: false,
    isExtensionStepsShown: false,
    isKeyPromptShown: false,
    engine: EngineKind.GOOGLE,
    microphones: [],
    microphoneId: null,
    isCameraShared: false,
    update: CHECK_UPDATE,
    glow: {
      mode: GlowMode.REST,
      level: 0,
      isUser: false
    },
    isShown: false,
    isFocusable: false,
    ...overrides
  };
  return view;
}

export const LISTENING: Partial<PillView> = {
  status: LiveStatus.LISTENING,
  isShown: true,
  sharedDisplay: PRIMARY.deviceName,
  microphones: [HEADSET, DESK],
  glow: {
    mode: GlowMode.BREATHE,
    level: 0,
    isUser: false
  }
};

export async function started(options: Parameters<typeof createFakePill>[0] = {}) {
  const pill = createFakePill(options);
  await pill.controller.onTrigger(KeyTrigger.TAP);
  await settle();
  return pill;
}
