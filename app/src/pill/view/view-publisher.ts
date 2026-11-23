import { pillViewSchema } from "@gemini-live/protocol/view";
import type { PillView } from "@gemini-live/protocol/view";

import type { PillDeps } from "@/pill/ports.ts";

type ViewListener = (view: PillView) => void;

function parseView({ view, log }: { view: unknown; log: PillDeps["log"] }) {
  const parsed = pillViewSchema.safeParse(view);
  if (!parsed.success) {
    log(`pill: the view is invalid: ${parsed.error.message}`);
    return undefined;
  }

  return parsed.data;
}

// The newest view, and the view after each change from then on; the returned function stops it
function subscribeView({
  listeners,
  listener,
  current
}: {
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

// Publishes the view `build` makes, validated, to its subscribers whenever it changes
export function createViewPublisher({ log, build }: { log: PillDeps["log"]; build: () => PillView }) {
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
    subscribe: (listener: ViewListener) =>
      subscribeView({
        listeners,
        listener,
        current: flush()
      })
  };
}
