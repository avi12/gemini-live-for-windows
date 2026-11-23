import { KeyTrigger } from "@/core/instance/key-trigger.ts";
import { ActivationKind } from "@/entry/activation/activation.ts";
import type { Activation } from "@/entry/activation/activation.ts";

export function triggerOf(activation: Activation) {
  return activation.kind === ActivationKind.KEY ? activation.trigger : KeyTrigger.TAP;
}

// A launch at sign-in, or a restart after a crash, only readies the app; any other start is a press of the key
export function firstTriggerOf(activation: Activation) {
  const isReadyOnly = activation.kind === ActivationKind.STARTUP || activation.kind === ActivationKind.RECOVERED;
  return isReadyOnly ? undefined : triggerOf(activation);
}
