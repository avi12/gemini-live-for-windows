import type { Monitor, Region } from "@/contracts/monitor.ts";
import { KeyTrigger } from "@/core/instance/key-trigger.ts";
import { applyAction } from "@/pill/actions.ts";
import { createCaptionLog } from "@/pill/captions/caption-log.ts";
import { createPillState } from "@/pill/context.ts";
import type { PillContext } from "@/pill/context.ts";
import { onDisplaysChanged } from "@/pill/menus/displays.ts";
import type { PillDeps } from "@/pill/ports.ts";
import { endConversation, setMuted, startConversation } from "@/pill/session.ts";
import { buildView } from "@/pill/view-builder.ts";
import { pillViewSchema } from "@gemini-live/protocol/view";
import type { PillAction, PillView } from "@gemini-live/protocol/view";

type ViewListener = (view: PillView) => void;

function parseView({ view, log }: {
  view: unknown;
  log: PillDeps["log"];
}) {
  const parsed = pillViewSchema.safeParse(view);
  if (!parsed.success) {
    log(`pill: the view is invalid: ${parsed.error.message}`);
    return undefined;
  }

  return parsed.data;
}

// The newest view, and the view after each change from then on; the returned function stops it
function subscribeView({ listeners, listener, current }: {
  listeners: Set<ViewListener>;
  listener: ViewListener;
  current: PillView | undefined;
}) {
  listeners.add(listener);

  const hasView = current !== undefined;
  if (hasView) {
    listener(current);
  }

  return () => {
    listeners.delete(listener);
  };
}

function createViewPublisher({ log, build }: {
  log: PillDeps["log"];
  build: () => PillView;
}) {
  const listeners = new Set<ViewListener>();
  let latest: PillView | undefined;
  let latestText = "";
  let isScheduled = false;

  // Rebuilds the view and tells the listeners when it differs from the last one
  function flush() {
    isScheduled = false;
    const view = parseView({
      view: build(),
      log
    });
    const text = JSON.stringify(view);
    const isUnchanged = view === undefined || text === latestText;
    if (isUnchanged) {
      return latest;
    }

    latestText = text;
    latest = view;
    for (const listener of listeners) {
      listener(view);
    }

    return latest;
  }

  // Coalesces a burst of changes into one view
  function changed() {
    if (isScheduled) {
      return;
    }

    isScheduled = true;
    queueMicrotask(flush);
  }

  return {
    flush,
    changed,
    subscribe: (listener: ViewListener) => subscribeView({
      listeners,
      listener,
      current: flush()
    })
  };
}

// The Copilot key: a tap toggles, a hold starts and unmutes
function handleTrigger({ context, trigger }: {
  context: PillContext;
  trigger: KeyTrigger;
}) {
  const { deps, state } = context;
  deps.log(`trigger ${trigger}`);
  const isLive = state.conversation !== undefined;
  const isTap = trigger === KeyTrigger.tap;
  const isEnding = isTap && isLive;
  if (isEnding) {
    return endConversation(context);
  }

  const isHoldStart = trigger === KeyTrigger.holdStart;
  const isStarting = isTap || isHoldStart && !isLive;
  if (isStarting) {
    return startConversation({
      context,
      monitor: deps.displays.active()
    });
  }

  if (isHoldStart) {
    setMuted({
      context,
      isMuted: false
    });
  }

  return Promise.resolve();
}

// Circle to Search: Gemini watches the circled region, starting a conversation first if none runs
async function focusRegion({ context, monitor, region }: {
  context: PillContext;
  monitor: Monitor;
  region: Region;
}) {
  const isIdle = context.state.conversation === undefined;
  if (isIdle) {
    await startConversation({
      context,
      monitor
    });
  }

  context.focus.focusOn({
    monitor,
    region
  });
}

function createContext({ deps, changed }: {
  deps: PillDeps;
  changed: () => void;
}) {
  const state = createPillState();
  const context: PillContext = {
    state,
    deps,
    captions: createCaptionLog({
      onChange: changed,
      onLinkAdded: uri => deps.log(`link: ${uri}`)
    }),
    focus: deps.createFocus({ currentEngine: () => state.conversation }),
    changed
  };
  return context;
}

function startWatching(context: PillContext) {
  const { deps, state, changed } = context;
  const stops = [
    context.focus.onChanged(changed),
    deps.updates.onReadyChanged(changed),
    deps.displays.onChanged(() => onDisplaysChanged(context)),
    deps.updates.watch()
  ];
  deps.microphones.select(deps.settings.microphoneId);
  state.displays = deps.displays.all();
  changed();
  return stops;
}

// Googlebook's Live UI on Windows, minus the drawing: the session behind the pill and the caption
// card above it. It owns every piece of state and all the logic, and shows it as one validated
// `PillView` for the Svelte window, which sends back `PillAction`s.
export function createPillController(deps: PillDeps) {
  const { flush, changed, subscribe } = createViewPublisher({
    log: deps.log,
    build: () => buildView(context)
  });
  const context = createContext({
    deps,
    changed
  });
  const { state } = context;
  const stops = startWatching(context);

  return {
    get isRunning() {
      return state.conversation !== undefined;
    },
    subscribe,
    view() {
      return flush();
    },
    flush,
    onTrigger(trigger: KeyTrigger) {
      return handleTrigger({
        context,
        trigger
      });
    },
    startOn(monitor: Monitor) {
      return startConversation({
        context,
        monitor
      });
    },
    focusRegion({ monitor, region }: {
      monitor: Monitor;
      region: Region;
    }) {
      return focusRegion({
        context,
        monitor,
        region
      });
    },
    async apply(action: PillAction) {
      await applyAction({
        context,
        action
      });
      flush();
    },
    dispose() {
      for (const stop of stops) {
        stop();
      }

      deps.previousApp.dispose();
    }
  };
}

export type PillController = ReturnType<typeof createPillController>;
