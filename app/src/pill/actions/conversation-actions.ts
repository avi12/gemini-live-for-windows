import { PillActionKind } from "@gemini-live/protocol/view";
import type { PillAction } from "@gemini-live/protocol/view";

import { EngineKind } from "@/contracts/live-engine.ts";
import type { PillContext } from "@/pill/context.ts";
import { runInBackground } from "@/pill/context.ts";
import { shareDisplay } from "@/pill/menus/displays.ts";
import { endConversation, switchEngine } from "@/pill/session/conversation.ts";
import { setMuted } from "@/pill/session/session-state.ts";

const NEEDS_GOOGLE_ENGINE = "Camera sharing needs the Gemini subscription engine";
const NO_SESSION_FOR_CAMERA = "Camera sharing needs a running session";

// Camera share rides the Google engine's frame pull; the API-key engine pushes the screen itself
async function setCamera({ context, isOn }: { context: PillContext; isOn: boolean }) {
  const { deps, state } = context;
  const isGoogle = deps.settings.engine === EngineKind.GOOGLE;
  if (!isGoogle) {
    deps.log(NEEDS_GOOGLE_ENGINE);
    return;
  }

  const { conversation } = state;
  const isIdle = conversation === undefined;
  if (isIdle) {
    deps.log(NO_SESSION_FOR_CAMERA);
    return;
  }

  await conversation.useCamera(isOn);
  context.changed();
}

// What the running conversation does: mute, end, the shared display, the camera and the engine
export async function applyConversationAction({ context, action }: { context: PillContext; action: PillAction }) {
  switch (action.kind) {
    case PillActionKind.MUTE:
      // The tracked state, not the engine's, so it works across a reconnect
      setMuted({
        context,
        isMuted: !context.state.isMuted
      });
      return true;
    case PillActionKind.END:
      runInBackground({
        context,
        task: endConversation(context),
        name: "ending"
      });
      return true;
    case PillActionKind.SHARE:
      shareDisplay({
        context,
        displayId: action.displayId
      });
      return true;
    case PillActionKind.SET_CAMERA:
      runInBackground({
        context,
        task: setCamera({
          context,
          isOn: action.isOn
        }),
        name: "switching the camera"
      });
      return true;
    case PillActionKind.SET_ENGINE:
      runInBackground({
        context,
        task: switchEngine({
          context,
          kind: action.engine
        }),
        name: "switching the engine"
      });
      return true;
    default:
      return false;
  }
}
