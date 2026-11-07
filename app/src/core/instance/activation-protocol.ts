import { KeyTrigger } from "./key-trigger.ts";
import { z } from "zod";

// Every message a later launch sends the running app over the activation pipe
export const ActivationMessage = {
  trigger: "trigger",
  ping: "ping"
} as const;

export const keyTriggerSchema = z.enum(KeyTrigger);

export interface ActivationProtocolMap {
  // The key press the later launch was started for
  [ActivationMessage.trigger](trigger: KeyTrigger): void;
  // Is anyone there; never starts anything
  [ActivationMessage.ping](): void;
}
