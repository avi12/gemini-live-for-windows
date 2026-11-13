import type { KeyTrigger } from "@/core/instance/key-trigger.ts";
import { KeySource } from "@/entry/activation/protocol.ts";

// After the fast path hears a press, the shell still launches the protocol URI a few seconds later
// (measured: about 3.5 s), and that second copy forwards the same press. It would toggle the pill
// straight back, so a forwarded press inside this window of a fast-path one is that echo.
export const FORWARDED_ECHO_MILLISECONDS = 8000;

// The shell also repeats a fast-path tap itself, measured 3.3 to 3.5 s after the press. Only that
// band is treated as the repeat, so a quick second press by the user still counts.
export const REPEAT_ECHO_FROM_MILLISECONDS = 2800;
export const REPEAT_ECHO_UNTIL_MILLISECONDS = 4200;

interface Press {
  trigger: KeyTrigger;
  source: KeySource;
}

// Hands key triggers to the pill controller once it exists. A press that arrives while the app is
// still starting (the pipe is served before the controller is built) waits instead of being lost.
export function createTriggerRelay({
  now = () => performance.now(),
  log = () => undefined
}: {
  now?: () => number;
  log?: (message: string) => void;
} = {}) {
  let target: ((trigger: KeyTrigger) => void) | undefined;
  const waiting: KeyTrigger[] = [];
  let lastFastPathAt: number | undefined;

  function isEcho({ source }: Press) {
    const previousAt = lastFastPathAt;
    const isFirstPress = previousAt === undefined;
    if (isFirstPress) {
      return false;
    }

    const elapsed = now() - previousAt;
    const isForwardedEcho = source === KeySource.FORWARDED && elapsed < FORWARDED_ECHO_MILLISECONDS;
    const isRepeatedEcho =
      source === KeySource.FAST_PATH &&
      elapsed >= REPEAT_ECHO_FROM_MILLISECONDS &&
      elapsed < REPEAT_ECHO_UNTIL_MILLISECONDS;
    return isForwardedEcho || isRepeatedEcho;
  }

  return {
    send(press: Press) {
      log(`key: ${press.trigger} from ${press.source}`);

      if (isEcho(press)) {
        log(`key: dropped the shell's echo of a ${press.trigger}`);
        return;
      }

      const isFastPath = press.source === KeySource.FAST_PATH;
      if (isFastPath) {
        lastFastPathAt = now();
      }

      if (target) {
        target(press.trigger);
        return;
      }

      waiting.push(press.trigger);
    },
    attach(next: (trigger: KeyTrigger) => void) {
      target = next;
      for (const trigger of waiting.splice(0)) {
        next(trigger);
      }
    }
  };
}
