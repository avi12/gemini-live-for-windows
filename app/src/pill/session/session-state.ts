import type { PillContext } from "@/pill/context.ts";
import { REST_GLOW } from "@/pill/glow/glow-state.ts";

export function setStatus({ context, status, detail = "" }: { context: PillContext; status: string; detail?: string }) {
  context.state.status = status;
  context.state.statusDetail = detail;
  context.changed();
}

export function setMuted({ context, isMuted }: { context: PillContext; isMuted: boolean }) {
  const { state } = context;
  state.isMuted = isMuted;

  const { conversation } = state;
  const isRunning = conversation !== undefined;
  if (isRunning) {
    conversation.isMuted = isMuted;
  }

  context.changed();
}

// Lets go of the session: no more events, no share border, glow at rest
export function detach(context: PillContext) {
  const { state, deps } = context;
  state.conversation = undefined;
  deps.shareBorder.hideBorder();
  state.glow = REST_GLOW;
  context.changed();
}
