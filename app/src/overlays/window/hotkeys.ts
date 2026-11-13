import type { OverlayLog } from "@/overlays/ports.ts";
import { CircleAction } from "@/overlays/protocol.ts";

// Circle to Search's keys as global hotkeys (CircleKey.cs and Hotkey.cs): Windows' Copilot key
// provider only ever delivers Win+C itself, and the overlay's own keys must work even when
// Windows' foreground lock leaves another app holding the keyboard. A key the app needs only for a
// while is held on demand, so other apps keep it the rest of the time.
interface RegisterHotkeyOptions {
  keys: CircleKeyCombination;
  onpressed: () => void;
}

export const CircleKeyCombination = {
  // Not Win+Shift+C: PowerToys' Color Picker holds that one by default
  CIRCLE: "win+alt+c",
  ESCAPE: "escape",
  ASK_GEMINI: "enter",
  LENS: "l",
  SELECT_TEXT: "t",
  COPY: "ctrl+c"
} as const;
export type CircleKeyCombination = (typeof CircleKeyCombination)[keyof typeof CircleKeyCombination];

// Names as people say them, for the log
const KEY_NAMES: Record<CircleKeyCombination, string> = {
  [CircleKeyCombination.CIRCLE]: "Win+Alt+C",
  [CircleKeyCombination.ESCAPE]: "Esc",
  [CircleKeyCombination.ASK_GEMINI]: "Enter",
  [CircleKeyCombination.LENS]: "L",
  [CircleKeyCombination.SELECT_TEXT]: "T",
  [CircleKeyCombination.COPY]: "Ctrl+C"
};

export interface HotkeyHandle {
  unregister(): void;
}

// winui-svelte/app/hotkeys' registerHotkey, which throws a HotkeyError when another app owns the
// combination. It must be called on the UI thread, after the message pump started
export type RegisterHotkey = (options: RegisterHotkeyOptions) => HotkeyHandle;

// One hotkey taken and given back on demand. Presses reach `onPressed` only while it is held; a
// combination another app already holds is only logged
export function createHeldKey({
  keys,
  register,
  onPressed,
  log
}: {
  keys: CircleKeyCombination;
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

// Win+Alt+C, held for the app's lifetime
export function holdCircleKey({
  register,
  onPressed,
  log
}: {
  register: RegisterHotkey;
  onPressed: () => void;
  log: OverlayLog;
}) {
  const key = createHeldKey({
    keys: CircleKeyCombination.CIRCLE,
    register,
    onPressed,
    log
  });
  key.hold(true);
  return key;
}

// Esc, which hands Gemini back the whole display. Held only while it sees a circled region
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
    keys: CircleKeyCombination.ESCAPE,
    register,
    onPressed,
    log
  });
}

// Ctrl+C for the overlay's text mode: held only while words are selected, so other apps keep
// their copy shortcut the rest of the time
export function createCopyKey({
  register,
  onPressed,
  log
}: {
  register: RegisterHotkey;
  onPressed: () => void;
  log: OverlayLog;
}) {
  return createHeldKey({
    keys: CircleKeyCombination.COPY,
    register,
    onPressed,
    log
  });
}

// The overlay's own keys, held only while it is open: Esc backs out, Enter asks Gemini, L asks
// Lens, T selects text. The main side lets go of its Esc first (ScreenFocus.isCircling), so the
// two never both want Esc
export function createOverlayKeys({
  register,
  log,
  onEscape,
  onFinish,
  onSelectText
}: {
  register: RegisterHotkey;
  log: OverlayLog;
  onEscape: () => void;
  onFinish: (action: CircleAction) => void;
  onSelectText: () => void;
}) {
  const keys = [
    createHeldKey({
      keys: CircleKeyCombination.ESCAPE,
      register,
      onPressed: onEscape,
      log
    }),
    createHeldKey({
      keys: CircleKeyCombination.ASK_GEMINI,
      register,
      onPressed: () => onFinish(CircleAction.ASK_GEMINI),
      log
    }),
    createHeldKey({
      keys: CircleKeyCombination.LENS,
      register,
      onPressed: () => onFinish(CircleAction.LENS),
      log
    }),
    createHeldKey({
      keys: CircleKeyCombination.SELECT_TEXT,
      register,
      onPressed: onSelectText,
      log
    })
  ];

  function hold(isHeld: boolean) {
    for (const key of keys) {
      key.hold(isHeld);
    }
  }

  return { hold };
}
