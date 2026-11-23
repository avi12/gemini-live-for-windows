import type { PillAction } from "@gemini-live/protocol/view";

import { applyAppAction } from "@/pill/actions/app-actions.ts";
import { applyConversationAction } from "@/pill/actions/conversation-actions.ts";
import { applyInputAction } from "@/pill/actions/input-actions.ts";
import type { PillContext } from "@/pill/context.ts";

function refuseUnknown(action: unknown) {
  throw new Error(`Nothing handles '${JSON.stringify(action)}'`);
}

// Does the action; slow work carries on in the background. One that cannot be done throws, and the
// window gets the message as the answer's error.
export async function applyAction({ context, action }: { context: PillContext; action: PillAction }) {
  const handlers = [applyConversationAction, applyInputAction, applyAppAction];
  for (const handler of handlers) {
    const isHandled = await handler({
      context,
      action
    });
    if (isHandled) {
      context.changed();
      return;
    }
  }

  refuseUnknown(action);
}
