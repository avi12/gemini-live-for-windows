import { isUntitledLink } from "@gemini-live/protocol/view";
import type { PillAction, PillLink } from "@gemini-live/protocol/view";

import type { Monitor } from "@/contracts/monitor.ts";
import type { KeyTrigger } from "@/core/instance/key-trigger.ts";
import { applyAction } from "@/pill/actions/apply-action.ts";
import { createCaptionLog } from "@/pill/captions/caption-log.ts";
import { createPillState } from "@/pill/context.ts";
import type { PillContext } from "@/pill/context.ts";
import { onDisplaysChanged } from "@/pill/menus/displays.ts";
import type { PillDeps } from "@/pill/ports.ts";
import { startConversation } from "@/pill/session/conversation.ts";
import { handleTrigger } from "@/pill/session/key-trigger.ts";
import { buildView } from "@/pill/view/view-builder.ts";
import { createViewPublisher } from "@/pill/view/view-publisher.ts";

function createContext({ deps, changed }: { deps: PillDeps; changed: () => void }) {
  const state = createPillState();
  const context: PillContext = {
    state,
    deps,
    captions: createCaptionLog({
      onChange: changed,
      onLinkAdded(link) {
        deps.log(`link: ${link.uri}`);
        void titleUntitled(link);
      }
    }),
    changed
  };

  // A link Gemini gave only as a URL is titled by its address until the page's own title is read
  async function titleUntitled(link: PillLink) {
    const isTitled = !isUntitledLink(link) || link.isSearch;
    if (isTitled) {
      return;
    }

    const title = await deps.pageTitle(link.uri);
    if (title !== undefined) {
      context.captions.retitle({
        id: link.id,
        title
      });
    }
  }

  return context;
}

function startWatching(context: PillContext) {
  const { deps, state, changed } = context;
  const stops = [
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
    }
  };
}

export type PillController = ReturnType<typeof createPillController>;
