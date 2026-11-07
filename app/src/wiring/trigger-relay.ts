import type { KeyTrigger } from "@/core/instance/key-trigger.ts";

// Hands key triggers to the pill controller once it exists. A press that arrives while the app is
// still starting (the pipe is served before the controller is built) waits instead of being lost.
export function createTriggerRelay() {
  let target: ((trigger: KeyTrigger) => void) | undefined;
  const waiting: KeyTrigger[] = [];

  return {
    send(trigger: KeyTrigger) {
      if (target) {
        target(trigger);
        return;
      }

      waiting.push(trigger);
    },
    attach(next: (trigger: KeyTrigger) => void) {
      target = next;
      for (const trigger of waiting.splice(0)) {
        next(trigger);
      }
    }
  };
}
