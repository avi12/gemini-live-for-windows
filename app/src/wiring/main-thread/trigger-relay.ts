import type { KeyTrigger } from "@/core/instance/key-trigger.ts";
import { KeySource } from "@/entry/activation/protocol.ts";

// After the fast path hears a press, the shell still launches the protocol URI a few seconds later
// (measured: about 3.5 s), and that second copy forwards the same press. It would toggle the pill
// straight back, so a forwarded press inside this window of a fast-path one is that echo.
export const FORWARDED_ECHO_MILLISECONDS = 8000;

interface Press {
  trigger: KeyTrigger;
  source: KeySource;
}

// Hands key triggers to the pill controller once it exists. A press that arrives while the app is
// still starting (the pipe is served before the controller is built) waits instead of being lost.
export function createTriggerRelay({ now = () => performance.now(), log = () => undefined }: {
  now?: () => number;
  log?: (message: string) => void;
} = {}) {
  let target: ((trigger: KeyTrigger) => void) | undefined;
  const waiting: KeyTrigger[] = [];
  let lastFastPathAt: number | undefined;

  function isEcho({ source }: Press) {
    const isForwarded = source === KeySource.forwarded;
    const isAfterFastPath = lastFastPathAt !== undefined && now() - lastFastPathAt < FORWARDED_ECHO_MILLISECONDS;
    return isForwarded && isAfterFastPath;
  }

  return {
    send(press: Press) {
      log(`key: ${press.trigger} from ${press.source}`);
      const isFastPath = press.source === KeySource.fastPath;
      if (isFastPath) {
        lastFastPathAt = now();
      }

      if (isEcho(press)) {
        log(`key: dropped the shell's echo of a ${press.trigger}`);
        return;
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
