import { LiveEventKind, LiveStatus } from "@/contracts/live-engine.ts";
import type { LiveEngine, LiveEvent } from "@/contracts/live-engine.ts";
import { errorMessage } from "@/lib/error-message.ts";
import type { PillContext } from "@/pill/context.ts";
import { isCurrent, runInBackground } from "@/pill/context.ts";
import { BREATHING_GLOW, followGlow } from "@/pill/glow/glow-state.ts";
import { refreshMicrophones } from "@/pill/menus/microphones.ts";
import { askForKey, onExtensionNeeded } from "@/pill/menus/setup-panels.ts";
import { detach, setMuted, setStatus } from "@/pill/session/session-state.ts";

const API_KEY_ERROR = /API key/i;

// A session died: keep the pill up with the reason, so the failure shows
function fail({ context, engine, reason }: { context: PillContext; engine: LiveEngine; reason: string }) {
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
    status: LiveStatus.STOPPED,
    detail: reason
  });
  context.captions.addNote(reason);
  runInBackground({
    context,
    task: engine.dispose(),
    name: "disposing the ended engine"
  });
}

function onEngineEvent({ context, engine, event }: { context: PillContext; engine: LiveEngine; event: LiveEvent }) {
  const { state, captions } = context;
  const isReplaced = !isCurrent({
    context,
    engine
  });
  if (isReplaced) {
    return;
  }

  switch (event.kind) {
    case LiveEventKind.STATUS:
      setStatus({
        context,
        status: event.status
      });
      break;
    case LiveEventKind.TRANSCRIPT:
      captions.show({
        text: event.text,
        isUser: event.isUser
      });
      break;
    case LiveEventKind.LINKS:
      captions.showLinks(event.links);
      break;
    case LiveEventKind.LEVEL:
      state.glow = followGlow({
        glow: state.glow,
        level: event.peak,
        isUser: event.isUser
      });
      context.changed();
      break;
    case LiveEventKind.ENDED:
      fail({
        context,
        engine,
        reason: event.reason
      });
      break;
  }
}

// Shows what the engine reports for as long as it is the conversation
export function followEngine({ context, engine }: { context: PillContext; engine: LiveEngine }) {
  engine.onEvent(event =>
    onEngineEvent({
      context,
      engine,
      event
    })
  );

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
}

// Starts the engine and, once it listens, unmutes it; a start that fails shows why, and a missing or
// refused API key brings up the key prompt
export async function connect({ context, engine }: { context: PillContext; engine: LiveEngine }) {
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
    status: LiveStatus.LISTENING
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
