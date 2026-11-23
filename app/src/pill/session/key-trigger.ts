import { KeyTrigger } from "@/core/instance/key-trigger.ts";
import type { PillContext } from "@/pill/context.ts";
import { endConversation, startConversation } from "@/pill/session/conversation.ts";
import { setMuted } from "@/pill/session/session-state.ts";

// The Copilot key: a tap toggles, a hold starts and unmutes
export function handleTrigger({ context, trigger }: { context: PillContext; trigger: KeyTrigger }) {
  const { deps, state } = context;
  deps.log(`trigger ${trigger}`);
  const isLive = state.conversation !== undefined;
  const isTap = trigger === KeyTrigger.TAP;
  const isEnding = isTap && isLive;
  if (isEnding) {
    return endConversation(context);
  }

  const isHoldStart = trigger === KeyTrigger.HOLD_START;
  const isStarting = isTap || (isHoldStart && !isLive);
  if (isStarting) {
    return startConversation({
      context,
      monitor: deps.displays.active()
    });
  }

  if (isHoldStart) {
    setMuted({
      context,
      isMuted: false
    });
  }

  return Promise.resolve();
}
