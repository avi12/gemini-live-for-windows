import { FAST_PATH_PROPERTY, WM_COPILOT } from "./fast-path.ts";
import { createHiddenWindow } from "./hidden-window.ts";
import { addThreadMessageHook } from "./message-hooks.ts";
import type { MessageHookSource } from "./message-hooks.ts";
import { openWindowPropertyStore, VariantType } from "./property-store.ts";
import { browserDir } from "@/lib/paths.ts";
import {
  argHandle,
  argI64,
  argU32,
  argU64,
  bindFunction,
  Win32Type
} from "@/win32/bind.ts";
import fs from "node:fs";
import path from "node:path";

// Question: does the shell POST WM_APP+1 to our window (a queue hook sees it) or SEND it (only a
// window procedure sees it)? A queue hook cannot tell "sent" from "never came", so the spike also
// posts the message to itself first: the log then proves the hook works, and a Win+C with no line
// after it means SENT (or the shell never targeted this window).
export const SPIKE_FLAG_FILE = "fast-path-spike.flag";
const SPIKE_LOG_FILE = "fast-path-spike.log";
const SELF_TEST_WPARAM = 99n;
const NO_LPARAM = 0n;
const HEX_RADIX = 16;

function hex(value: bigint | number) {
  return value.toString(HEX_RADIX);
}

export function spikeLogPath() {
  return path.join(browserDir(), SPIKE_LOG_FILE);
}

/** True when scripts\Register-FastPathSpike.ps1 left its flag file beside the exe. */
export function isFastPathSpikeRequested({ executable = process.execPath }: { executable?: string } = {}) {
  return fs.existsSync(path.join(path.dirname(executable), SPIKE_FLAG_FILE));
}

export function formatSpikeLine({ time, text }: {
  time: Date;
  text: string;
}) {
  return `${time.toISOString()} ${text}\n`;
}

/**
 * Runs the spike on the UI worker: hidden window, the property, a hook that logs every message of the
 * thread's queue (ids of our window in full, other windows counted by id), and a self-posted message.
 */
export function startFastPathSpike({ addHook = addThreadMessageHook, logPath = spikeLogPath() }: {
  addHook?: MessageHookSource;
  logPath?: string;
} = {}) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  function write(text: string) {
    fs.appendFileSync(
      logPath, formatSpikeLine({
        time: new Date(),
        text
      })
    );
  }
  const postMessage = bindFunction({
    library: "user32.dll",
    entryPoint: "PostMessageW",
    parameters: [Win32Type.handle, Win32Type.u32, Win32Type.u64, Win32Type.i64],
    returns: Win32Type.bool32
  });
  const window = createHiddenWindow("Gemini Live fast-path spike");
  const store = openWindowPropertyStore(window.hwnd);
  store.setNumber({
    key: FAST_PATH_PROPERTY,
    type: VariantType.uint,
    value: WM_COPILOT
  });
  const stored = store.read(FAST_PATH_PROPERTY);
  store.release();
  write(`start hwnd=0x${hex(window.hwnd)} pid=${process.pid} property=${stored.number} (type ${stored.type}, expect ${WM_COPILOT})`);

  const otherIds = new Set<number>();
  const removeHook = addHook(message => {
    const isOurs = message.hwnd === window.hwnd;
    if (isOurs) {
      write(`message id=0x${hex(message.id)} wParam=${message.wParam} lParam=${message.lParam}`);
      return false;
    }

    if (!otherIds.has(message.id)) {
      otherIds.add(message.id);
      write(`other window hwnd=0x${hex(message.hwnd)} first id=0x${hex(message.id)}`);
    }

    return false;
  });
  postMessage([argHandle(window.hwnd), argU32(WM_COPILOT), argU64(SELF_TEST_WPARAM), argI64(NO_LPARAM)]);
  write(`self-test posted id=0x${hex(WM_COPILOT)} wParam=${SELF_TEST_WPARAM}: a message line must follow, else the hook is blind`);
  write("now select this app in Settings > Personalization > Text input > Copilot key, then press Win+C: tap, hold, release");

  return () => {
    removeHook();
    window.destroy();
    write("stop");
  };
}
