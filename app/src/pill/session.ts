import { EngineKind, LiveEventKind, LiveStatus } from "@/contracts/live-engine.ts";
import type { LiveEngine, LiveEvent } from "@/contracts/live-engine.ts";
import type { Monitor } from "@/contracts/monitor.ts";
import { errorMessage } from "@/lib/error-message.ts";
import type { PillContext } from "@/pill/context.ts";
import { isCurrent, runInBackground } from "@/pill/context.ts";
import { BREATHING_GLOW, followGlow, REST_GLOW } from "@/pill/glow/glow-state.ts";
import { showOn } from "@/pill/menus/displays.ts";
import { refreshMicrophones } from "@/pill/menus/microphones.ts";
import { askForKey, hideKeyPanel, onExtensionNeeded } from "@/pill/menus/setup-panels.ts";

// The pill's exit animation runs 260 ms in the window (pill/src/ui/motion/motion.ts), then it hides
const EXIT_SETTLE_MS = 400;
const API_KEY_ERROR = /API key/i;

function setStatus({ context, status, detail = "" }: {
  context: PillContext;
  status: string;
  detail?: string;
}) {
  context.state.status = status;
  context.state.statusDetail = detail;
  context.changed();
}

export function setMuted({ context, isMuted }: {
  context: PillContext;
  isMuted: boolean;
}) {
  const { state } = context;
  state.isMuted = isMuted;

  const { conversation } = state;
  const isRunning = conversation !== undefined;
  if (isRunning) {
    conversation.isMuted = isMuted;
  }

  context.changed();
}

// Lets go of the session: no more events, no share border, glow at rest
function detach(context: PillContext) {
  const { state, focus } = context;
  state.conversation = undefined;
  focus.hideBorder();
  focus.unfocus();
  state.glow = REST_GLOW;
  context.changed();
}

// A session died: keep the pill up with the reason, so the failure shows
function fail({ context, engine, reason }: {
  context: PillContext;
  engine: LiveEngine;
  reason: string;
}) {
  const isReplaced = !isCurrent({
    context,
    engine
  });
  if (isReplaced) {
    return;
  }

  context.deps.log(`ended: ${reason}`);
  detach(context);
  setStatus({
    context,
    status: LiveStatus.stopped,
    detail: reason
  });
  context.captions.addNote(reason);
  runInBackground({
    context,
    task: engine.dispose(),
    name: "disposing the ended engine"
  });
}

function onEngineEvent({ context, engine, event }: {
  context: PillContext;
  engine: LiveEngine;
  event: LiveEvent;
}) {
  const { state, captions } = context;
  const isReplaced = !isCurrent({
    context,
    engine
  });
  if (isReplaced) {
    return;
  }

  switch (event.kind) {
    case LiveEventKind.status:
      setStatus({
        context,
        status: event.status
      });
      break;
    case LiveEventKind.transcript:
      captions.show({
        text: event.text,
        isUser: event.isUser
      });
      break;
    case LiveEventKind.links:
      captions.showLinks(event.links);
      break;
    case LiveEventKind.level:
      state.glow = followGlow({
        glow: state.glow,
        level: event.peak,
        isUser: event.isUser
      });
      context.changed();
      break;
    case LiveEventKind.ended:
      fail({
        context,
        engine,
        reason: event.reason
      });
      break;
  }
}

async function connect({ context, engine }: {
  context: PillContext;
  engine: LiveEngine;
}) {
  const { state, deps } = context;
  function isReplaced() {
    return !isCurrent({
      context,
      engine
    });
  }

  try {
    await engine.start();
  } catch (error) {
    if (isReplaced()) {
      return;
    }

    const message = errorMessage(error);
    deps.log(`start failed: ${message}`);
    fail({
      context,
      engine,
      reason: message
    });

    if (API_KEY_ERROR.test(message)) {
      askForKey(context);
    }

    return;
  }

  // Ended while connecting
  if (isReplaced()) {
    return;
  }

  setStatus({
    context,
    status: LiveStatus.listening
  });

  if (!engine.reportsLevels) {
    state.glow = BREATHING_GLOW;
  }

  setMuted({
    context,
    isMuted: false
  });
  runInBackground({
    context,
    task: refreshMicrophones(context),
    name: "listing microphones"
  });
}

export async function startConversation({ context, monitor }: {
  context: PillContext;
  monitor: Monitor;
}) {
  const { state, deps, captions, focus } = context;
  captions.clear();
  state.isMuted = false;
  showOn({
    context,
    monitor
  });

  const isMissingKey = deps.settings.engine === EngineKind.apiKey && !deps.settings.hasApiKey;
  if (isMissingKey) {
    askForKey(context);
    return;
  }

  const engine = deps.engines.create({
    kind: deps.settings.engine,
    monitor
  });
  state.conversation = engine;
  engine.onEvent(event => onEngineEvent({
    context,
    engine,
    event
  }));

  engine.onExtensionNeeded(isNeeded => {
    const isReplaced = !isCurrent({
      context,
      engine
    });
    if (isReplaced) {
      return;
    }

    onExtensionNeeded({
      context,
      isNeeded
    });
  });

  setStatus({
    context,
    status: LiveStatus.connecting
  });
  focus.cover(monitor);
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
export async function switchEngine({ context, kind }: {
  context: PillContext;
  kind: EngineKind;
}) {
  const { state, deps } = context;
  const isUnchanged = deps.settings.engine === kind;
  if (isUnchanged) {
    return;
  }

  await deps.settings.setEngine(kind);
  deps.log(`engine -> ${kind}`);
  hideKeyPanel(context);

  const isLeavingGoogle = kind !== EngineKind.google;
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
