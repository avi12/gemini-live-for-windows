import { PillActionKind } from "@gemini-live/protocol/view";
import type { PillAction } from "@gemini-live/protocol/view";

import type { PillContext } from "@/pill/context.ts";
import { runInBackground } from "@/pill/context.ts";
import { setFocusable } from "@/pill/menus/setup-panels.ts";
import { checkForUpdates, installUpdate, setAutoUpdate } from "@/pill/menus/update-menu.ts";
import { endConversation } from "@/pill/session/conversation.ts";

function moveBy({ context, deltaX, deltaY }: { context: PillContext; deltaX: number; deltaY: number }) {
  context.deps.window.moveBy({
    deltaX: Math.round(deltaX),
    deltaY: Math.round(deltaY)
  });
}

// What concerns the app and its window: updates, quitting, focus, moving and clipping the window
export async function applyAppAction({ context, action }: { context: PillContext; action: PillAction }) {
  switch (action.kind) {
    case PillActionKind.UPDATE:
      installUpdate(context);
      return true;
    case PillActionKind.CHECK_FOR_UPDATES:
      checkForUpdates(context);
      return true;
    case PillActionKind.SET_AUTO_UPDATE:
      await setAutoUpdate({
        context,
        isOn: action.isOn
      });
      return true;
    case PillActionKind.QUIT:
      runInBackground({
        context,
        task: endConversation(context),
        name: "ending"
      });
      context.deps.quit();
      return true;
    case PillActionKind.SET_FOCUSABLE:
      setFocusable({
        context,
        isFocusable: action.isFocusable
      });
      return true;
    case PillActionKind.MOVE_BY:
      moveBy({
        context,
        deltaX: action.dx,
        deltaY: action.dy
      });
      return true;
    case PillActionKind.CLIP_TO:
      context.deps.window.clipTo({ region: action.region });
      return true;
    default:
      return false;
  }
}
