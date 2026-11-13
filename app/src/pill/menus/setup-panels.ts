import { EngineKind, LiveStatus } from "@/contracts/live-engine.ts";
import type { PillContext } from "@/pill/context.ts";

export function onExtensionNeeded({ context, isNeeded }: { context: PillContext; isNeeded: boolean }) {
  const { state, deps } = context;
  const isGoogleSessionWindingDown = isNeeded && deps.settings.engine !== EngineKind.GOOGLE;
  if (isGoogleSessionWindingDown) {
    return;
  }

  state.isExtensionNeeded = isNeeded;

  if (!isNeeded) {
    state.isExtensionStepsShown = false;
  }

  context.changed();
}

export function connectExtension(context: PillContext) {
  context.deps.google.beginExtensionSetup();
  context.state.isExtensionStepsShown = true;
}

export function askForKey(context: PillContext) {
  const { state } = context;
  // A running session keeps its status: changing the key can still be cancelled
  const isIdle = state.conversation === undefined;
  if (isIdle) {
    state.status = LiveStatus.NEEDS_API_KEY;
    state.statusDetail = "";
  }

  state.isKeyPromptShown = true;
  // Typing needs focus, so the window drops no-activate just for this
  state.isFocusable = true;
  context.changed();
}

export function hideKeyPanel(context: PillContext) {
  context.state.isKeyPromptShown = false;
  context.state.isFocusable = false;
  context.changed();
}

// Selecting transcript text, or typing a key, needs the window to hold focus or the keys go to the
// app underneath. It stops being focusable when it loses activation, unless the key prompt waits.
export function setFocusable({ context, isFocusable }: { context: PillContext; isFocusable: boolean }) {
  const { state, deps } = context;
  state.isFocusable = isFocusable || state.isKeyPromptShown;

  if (!isFocusable) {
    return;
  }

  deps.window.bringToFront();
}
