import { KeyTrigger } from "@/core/instance/key-trigger.ts";

import { createHiddenWindow } from "./hidden-window.ts";
import { addThreadMessageHook } from "./message-hooks.ts";
import type { MessageHookSource, ThreadMessage } from "./message-hooks.ts";
import { openWindowPropertyStore, VariantType } from "./property-store.ts";

// Windows delivers the Copilot key straight to a running app's window when the window opts in with a
// property: the message id is the value, the trigger is wParam. Same constants as CopilotKey.cs.
const WM_APP = 0x8000;
const WM_APP_OFFSET = 1;
export const WM_COPILOT = WM_APP + WM_APP_OFFSET;
const WPARAM_BITS = 32;
export const FAST_PATH_PROPERTY = {
  formatId: "38652BCA-4329-4E74-86F9-39CF29345EEA",
  propertyId: 2
};
const WINDOW_TITLE = "Gemini Live Copilot key";

// The MessageWParam numbers declared on the copilotkeyprovider extension in the manifest.
export const WParam = {
  tap: 0n,
  holdStart: 1n,
  holdStop: 2n
} as const;

const TRIGGER_BY_WPARAM = new Map<bigint, KeyTrigger>([
  [WParam.tap, KeyTrigger.TAP],
  [WParam.holdStart, KeyTrigger.HOLD_START],
  [WParam.holdStop, KeyTrigger.HOLD_STOP]
]);

/** The trigger for a message's wParam; undefined for a value the manifest does not declare. */
export function triggerFromWParam(wParam: bigint) {
  return TRIGGER_BY_WPARAM.get(BigInt.asUintN(WPARAM_BITS, wParam));
}

/** Handles the Copilot key message of one window; other messages are left alone. */
export function createCopilotMessageHook({
  hwnd,
  onTrigger
}: {
  hwnd: bigint;
  onTrigger: (trigger: KeyTrigger) => void;
}) {
  return (message: ThreadMessage) => {
    const isCopilotMessage = message.hwnd === hwnd && message.id === WM_COPILOT;
    if (!isCopilotMessage) {
      return false;
    }

    const trigger = triggerFromWParam(message.wParam);
    const isUnknownTrigger = trigger === undefined;
    if (isUnknownTrigger) {
      return false;
    }

    onTrigger(trigger);
    return true;
  };
}

/**
 * Opts a hidden window into the fast path and reports each press. Call on the UI worker, whose
 * message pump serves the window. Resolves the property on `hwnd` it made; dispose destroys it.
 *
 * Only a real Win+C in a packaged run proves the shell POSTS the message (a hook on the queue never
 * sees a SENT one): see fast-path-spike.ts and the checklist in index.ts.
 */
export function startFastPath({
  onTrigger,
  addHook = addThreadMessageHook
}: {
  onTrigger: (trigger: KeyTrigger) => void;
  addHook?: MessageHookSource;
}) {
  const window = createHiddenWindow(WINDOW_TITLE);
  const store = openWindowPropertyStore(window.hwnd);
  try {
    store.setNumber({
      key: FAST_PATH_PROPERTY,
      type: VariantType.UINT,
      value: WM_COPILOT
    });
  } finally {
    store.release();
  }
  const removeHook = addHook(
    createCopilotMessageHook({
      hwnd: window.hwnd,
      onTrigger
    })
  );
  return {
    hwnd: window.hwnd,
    dispose() {
      removeHook();
      window.destroy();
    }
  };
}
