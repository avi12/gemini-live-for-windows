import { EngineKind, LiveStatus } from "@/contracts/live-engine.ts";
import type { Monitor } from "@/contracts/monitor.ts";
import type { PillContext } from "@/pill/context.ts";
import { runInBackground } from "@/pill/context.ts";
import { showOn } from "@/pill/menus/displays.ts";
import { askForKey, hideKeyPanel, onExtensionNeeded } from "@/pill/menus/setup-panels.ts";
import { connect, followEngine } from "@/pill/session/engine-events.ts";
import { detach, setStatus } from "@/pill/session/session-state.ts";

// The pill's exit animation runs 260 ms in the window (pill/src/ui/motion/motion.ts), then it hides
const EXIT_SETTLE_MS = 400;

export async function startConversation({ context, monitor }: { context: PillContext; monitor: Monitor }) {
  const { state, deps, captions } = context;
  captions.clear();
  state.isMuted = false;
  showOn({
    context,
    monitor
  });

  const isMissingKey = deps.settings.engine === EngineKind.API_KEY && !deps.settings.hasApiKey;
  if (isMissingKey) {
    askForKey(context);
    return;
  }

  const engine = deps.engines.create({
    kind: deps.settings.engine,
    monitor
  });
  state.conversation = engine;
  followEngine({
    context,
    engine
  });
  setStatus({
    context,
    status: LiveStatus.CONNECTING
  });
  deps.shareBorder.cover(monitor);
  await connect({
    context,
    engine
  });
}

// Once the pill's exit has finished and its window is gone, hands focus back
async function restoreFocus(context: PillContext) {
  await context.deps.delay(EXIT_SETTLE_MS);
  context.deps.previousApp.restore();
}

export async function endConversation(context: PillContext) {
  const { state } = context;
  const engine = state.conversation;
  detach(context);
  state.isShown = false;
  context.changed();
  runInBackground({
    context,
    task: restoreFocus(context),
    name: "restoring focus"
  });

  await engine?.dispose();
}

// Ends whatever runs and starts again on the current settings and display
export async function restartConversation(context: PillContext) {
  const { state, deps } = context;
  const monitor = state.conversation?.monitor ?? state.pillMonitor ?? deps.displays.active();
  const engine = state.conversation;
  detach(context);

  await engine?.dispose();
  await startConversation({
    context,
    monitor
  });
}

// Saves the choice, and starts the open pill over on it
export async function switchEngine({ context, kind }: { context: PillContext; kind: EngineKind }) {
  const { state, deps } = context;
  const isUnchanged = deps.settings.engine === kind;
  if (isUnchanged) {
    return;
  }

  await deps.settings.setEngine(kind);
  deps.log(`engine -> ${kind}`);
  hideKeyPanel(context);

  const isLeavingGoogle = kind !== EngineKind.GOOGLE;
  if (isLeavingGoogle) {
    onExtensionNeeded({
      context,
      isNeeded: false
    });
  }

  if (state.isShown) {
    await restartConversation(context);
  }
}
