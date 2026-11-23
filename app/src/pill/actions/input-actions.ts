import { PillActionKind } from "@gemini-live/protocol/view";
import type { PillAction } from "@gemini-live/protocol/view";

import { EngineKind } from "@/contracts/live-engine.ts";
import type { PillContext } from "@/pill/context.ts";
import { runInBackground } from "@/pill/context.ts";
import { refreshMicrophones, setMicrophone } from "@/pill/menus/microphones.ts";
import { askForKey, connectExtension, hideKeyPanel } from "@/pill/menus/setup-panels.ts";
import { restartConversation, switchEngine } from "@/pill/session/conversation.ts";

async function submitKey({ context, key }: { context: PillContext; key: string }) {
  await context.deps.settings.setApiKey(key);
  hideKeyPanel(context);
  runInBackground({
    context,
    task: restartConversation(context),
    name: "restarting on the new key"
  });
}

// Backs out of the prompt: with no key to fall back on, back to the subscription
function cancelKey(context: PillContext) {
  hideKeyPanel(context);

  if (context.deps.settings.hasApiKey) {
    return;
  }

  runInBackground({
    context,
    task: switchEngine({
      context,
      kind: EngineKind.GOOGLE
    }),
    name: "switching back to Google"
  });
}

// What the person feeds in: the microphone, the API key, the extension, a link or text to copy
export async function applyInputAction({ context, action }: { context: PillContext; action: PillAction }) {
  switch (action.kind) {
    case PillActionKind.SET_MICROPHONE:
      await setMicrophone({
        context,
        id: action.microphoneId
      });
      return true;
    case PillActionKind.REFRESH_MICROPHONES:
      runInBackground({
        context,
        task: refreshMicrophones(context),
        name: "listing microphones"
      });
      return true;
    case PillActionKind.ASK_FOR_KEY:
      askForKey(context);
      return true;
    case PillActionKind.SUBMIT_KEY:
      await submitKey({
        context,
        key: action.key
      });
      return true;
    case PillActionKind.CANCEL_KEY:
      cancelKey(context);
      return true;
    case PillActionKind.CONNECT_EXTENSION:
      connectExtension(context);
      return true;
    case PillActionKind.OPEN_LINK:
      context.deps.log(`open link: ${action.uri}`);
      context.deps.openExternal(new URL(action.uri).href);
      return true;
    case PillActionKind.COPY_TEXT:
      await context.deps.copyText(action.text);
      return true;
    default:
      return false;
  }
}
