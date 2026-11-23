import type { OverlayLog } from "@/overlays/ports.ts";

// The one global hotkey the overlays use: Esc, which hands Gemini back the whole display. Windows'
// foreground lock can leave another app holding the keyboard, so it is a hotkey rather than a key
// event, and it is held on demand so other apps keep Esc the rest of the time.

export const HotkeyCombination = { ESCAPE: "escape" } as const;
export type HotkeyCombination = (typeof HotkeyCombination)[keyof typeof HotkeyCombination];

// Names as people say them, for the log
const KEY_NAMES: Record<HotkeyCombination, string> = { [HotkeyCombination.ESCAPE]: "Esc" };

export interface HotkeyHandle {
  unregister(): void;
}

// winui-svelte/app/hotkeys' registerHotkey, which throws a HotkeyError when another app owns the
// combination. It must be called on the UI thread, after the message pump started
export type RegisterHotkey = (options: { keys: HotkeyCombination; onpressed: () => void }) => HotkeyHandle;

// One hotkey taken and given back on demand. Presses reach `onPressed` only while it is held; a
// combination another app already holds is only logged
export function createHeldKey({
  keys,
  register,
  onPressed,
  log
}: {
  keys: HotkeyCombination;
  register: RegisterHotkey;
  onPressed: () => void;
  log: OverlayLog;
}) {
  let handle: HotkeyHandle | undefined;

  function take() {
    const isTaken = handle !== undefined;
    if (isTaken) {
      return;
    }

    try {
      handle = register({
        keys,
        onpressed: onPressed
      });
    } catch {
      log.write(`hotkey: ${KEY_NAMES[keys]} is taken by another app`);
    }
  }

  function release() {
    handle?.unregister();
    handle = undefined;
  }

  return {
    get isHeld() {
      return handle !== undefined;
    },
    hold(isHeld: boolean) {
      if (isHeld) {
        take();
        return;
      }

      release();
    }
  };
}

// Esc, which hands Gemini back the whole display. Held only while it sees a watched region
export function createFocusEscapeKey({
  register,
  onPressed,
  log
}: {
  register: RegisterHotkey;
  onPressed: () => void;
  log: OverlayLog;
}) {
  return createHeldKey({
    keys: HotkeyCombination.ESCAPE,
    register,
    onPressed,
    log
  });
}
