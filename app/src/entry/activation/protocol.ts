import { defineMessaging } from "winui-svelte/messaging";
import type { Transport } from "winui-svelte/state/host";
import { z } from "zod";

import { KeyTrigger } from "@/core/instance/key-trigger.ts";

// The link between the UI worker (which hears the Copilot key's fast path) and the main thread (which
// owns the conversation). The same message also carries a trigger the main thread read itself from an
// argument: a cold start, or a second process forwarded by the single-instance pipe.
export const EntryMessage = {
  KEY_TRIGGER: "entry/key-trigger"
} as const;
export type EntryMessage = (typeof EntryMessage)[keyof typeof EntryMessage];

export const KeySource = {
  FAST_PATH: "fast-path",
  COLD_START: "cold-start",
  FORWARDED: "forwarded"
} as const;
export type KeySource = (typeof KeySource)[keyof typeof KeySource];

export const keyTriggerSchema = z.object({
  trigger: z.enum(KeyTrigger),
  source: z.enum(KeySource)
});
export type KeyTriggerPayload = z.infer<typeof keyTriggerSchema>;

export interface EntryProtocolMap {
  [EntryMessage.KEY_TRIGGER](data: KeyTriggerPayload): void;
}

/** The sending end: the UI worker calls the returned function for each press it hears. */
export function createKeyTriggerSender({ transport }: { transport: Transport }) {
  const messaging = defineMessaging<EntryProtocolMap>({ transport });
  return (payload: KeyTriggerPayload) => {
    messaging.notify(EntryMessage.KEY_TRIGGER, payload);
  };
}

/** The receiving end on the main thread; a payload that fails the schema is logged and dropped. */
export function serveKeyTriggers({
  transport,
  onTrigger,
  log
}: {
  transport: Transport;
  onTrigger: (payload: KeyTriggerPayload) => void;
  log: (message: string) => void;
}) {
  const messaging = defineMessaging<EntryProtocolMap>({
    transport,
    onError: error => log(`entry: ${error.message}`)
  });
  messaging.onMessage(EntryMessage.KEY_TRIGGER, message => {
    const parsed = keyTriggerSchema.safeParse(message.data);
    if (!parsed.success) {
      log(`entry: refused a key trigger: ${parsed.error.message}`);
      return;
    }

    onTrigger(parsed.data);
  });
  return () => messaging.close();
}
