import { z } from "zod";

import { KeyTrigger } from "./key-trigger.ts";

// Every message a later launch sends the running app over the activation pipe
export const ActivationMessage = {
  TRIGGER: "trigger",
  PING: "ping"
} as const;

export const keyTriggerSchema = z.enum(KeyTrigger);

export interface ActivationProtocolMap {
  // The key press the later launch was started for
  [ActivationMessage.TRIGGER](trigger: KeyTrigger): void;
  // Is anyone there; never starts anything
  [ActivationMessage.PING](): void;
}
