import type { LiveEngine } from "@/contracts/live-engine.ts";
import type { Monitor } from "@/contracts/monitor.ts";
import { errorMessage } from "@/lib/error-message.ts";
import type { CaptionLog } from "@/pill/captions/caption-log.ts";
import { REST_GLOW } from "@/pill/glow/glow-state.ts";
import type { PillDeps, ScreenFocusPort } from "@/pill/ports.ts";
import type { PillGlow, PillNamed } from "@/pill/types.ts";

// Every piece of the pill's state; the controller's concerns read and write it, nothing else holds it
export interface PillState {
  conversation: LiveEngine | undefined;
  pillMonitor: Monitor | undefined;
  displays: readonly Monitor[];
  microphones: readonly PillNamed[];
  glow: PillGlow;
  status: string;
  statusDetail: string;
  isShown: boolean;
  isMuted: boolean;
  isExtensionNeeded: boolean;
  isExtensionStepsShown: boolean;
  isKeyPromptShown: boolean;
  isFocusable: boolean;
}

export interface PillContext {
  readonly state: PillState;
  readonly deps: PillDeps;
  readonly captions: CaptionLog;
  readonly focus: ScreenFocusPort;
  changed(): void;
}

export function createPillState() {
  const state: PillState = {
    conversation: undefined,
    pillMonitor: undefined,
    displays: [],
    microphones: [],
    glow: REST_GLOW,
    status: "",
    statusDetail: "",
    isShown: false,
    isMuted: false,
    isExtensionNeeded: false,
    isExtensionStepsShown: false,
    isKeyPromptShown: false,
    isFocusable: false
  };
  return state;
}

// An engine's events and results only count while it is still the conversation
export function isCurrent({ context, engine }: { context: PillContext; engine: LiveEngine }) {
  return context.state.conversation === engine;
}

// Slow work carries on after the action is answered; a failure is logged, never unhandled
export function runInBackground({
  context,
  task,
  name
}: {
  context: PillContext;
  task: Promise<unknown>;
  name: string;
}) {
  task.catch((error: unknown) => {
    context.deps.log(`${name} failed: ${errorMessage(error)}`);
  });
}
