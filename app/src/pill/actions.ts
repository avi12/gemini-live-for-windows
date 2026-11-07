import { EngineKind } from "@/contracts/live-engine.ts";
import type { PillContext } from "@/pill/context.ts";
import { runInBackground } from "@/pill/context.ts";
import { shareDisplay } from "@/pill/menus/displays.ts";
import { refreshMicrophones, setMicrophone } from "@/pill/menus/microphones.ts";
import { askForKey, connectExtension, hideKeyPanel, setFocusable } from "@/pill/menus/setup-panels.ts";
import { checkForUpdates, installUpdate, setAutoUpdate } from "@/pill/menus/update-menu.ts";
import { endConversation, restartConversation, setMuted, switchEngine } from "@/pill/session.ts";
import { PillActionKind } from "@gemini-live/protocol/view";
import type { PillAction } from "@gemini-live/protocol/view";

const NEEDS_GOOGLE_ENGINE = "Camera sharing needs the Gemini subscription engine";
const NO_SESSION_FOR_CAMERA = "Camera sharing needs a running session";

// Camera share rides the Google engine's frame pull; the API-key engine pushes the screen itself
async function setCamera({ context, isOn }: {
  context: PillContext;
  isOn: boolean;
}) {
  const { deps, state } = context;
  const isGoogle = deps.settings.engine === EngineKind.google;
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

async function submitKey({ context, key }: {
  context: PillContext;
  key: string;
}) {
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
      kind: EngineKind.google
    }),
    name: "switching back to Google"
  });
}

function moveBy({ context, deltaX, deltaY }: {
  context: PillContext;
  deltaX: number;
  deltaY: number;
}) {
  context.deps.window.moveBy({
    deltaX: Math.round(deltaX),
    deltaY: Math.round(deltaY)
  });
}

function refuseUnknown(action: unknown) {
  throw new Error(`Nothing handles '${JSON.stringify(action)}'`);
}

async function applyConversationAction({ context, action }: {
  context: PillContext;
  action: PillAction;
}) {
  switch (action.kind) {
    case PillActionKind.mute:
      // The tracked state, not the engine's, so it works across a reconnect
      setMuted({
        context,
        isMuted: !context.state.isMuted
      });
      return true;
    case PillActionKind.end:
      runInBackground({
        context,
        task: endConversation(context),
        name: "ending"
      });
      return true;
    case PillActionKind.share:
      shareDisplay({
        context,
        displayId: action.displayId
      });
      return true;
    case PillActionKind.setCamera:
      runInBackground({
        context,
        task: setCamera({
          context,
          isOn: action.isOn
        }),
        name: "switching the camera"
      });
      return true;
    case PillActionKind.setEngine:
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

async function applyInputAction({ context, action }: {
  context: PillContext;
  action: PillAction;
}) {
  switch (action.kind) {
    case PillActionKind.setMicrophone:
      await setMicrophone({
        context,
        id: action.microphoneId
      });
      return true;
    case PillActionKind.refreshMicrophones:
      runInBackground({
        context,
        task: refreshMicrophones(context),
        name: "listing microphones"
      });
      return true;
    case PillActionKind.askForKey:
      askForKey(context);
      return true;
    case PillActionKind.submitKey:
      await submitKey({
        context,
        key: action.key
      });
      return true;
    case PillActionKind.cancelKey:
      cancelKey(context);
      return true;
    case PillActionKind.connectExtension:
      connectExtension(context);
      return true;
    case PillActionKind.openLink:
      context.deps.openExternal(new URL(action.uri).href);
      return true;
    default:
      return false;
  }
}

async function applyAppAction({ context, action }: {
  context: PillContext;
  action: PillAction;
}) {
  switch (action.kind) {
    case PillActionKind.update:
      installUpdate(context);
      return true;
    case PillActionKind.checkForUpdates:
      checkForUpdates(context);
      return true;
    case PillActionKind.setAutoUpdate:
      await setAutoUpdate({
        context,
        isOn: action.isOn
      });
      return true;
    case PillActionKind.quit:
      runInBackground({
        context,
        task: endConversation(context),
        name: "ending"
      });
      context.deps.quit();
      return true;
    case PillActionKind.setFocusable:
      setFocusable({
        context,
        isFocusable: action.isFocusable
      });
      return true;
    case PillActionKind.moveBy:
      moveBy({
        context,
        deltaX: action.dx,
        deltaY: action.dy
      });
      return true;
    default:
      return false;
  }
}

// Does the action; slow work carries on in the background. One that cannot be done throws, and the
// window gets the message as the answer's error.
export async function applyAction({ context, action }: {
  context: PillContext;
  action: PillAction;
}) {
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
