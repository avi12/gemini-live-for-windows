import { MessagePort } from "node:worker_threads";

import { z } from "zod";

// What the main thread hands the UI worker: one port per link, and where the files it reads ship.
// Both threads read it through this schema, so the two ends cannot drift apart.
export const uiWorkerDataSchema = z.object({
  ports: z.object({
    pill: z.instanceof(MessagePort),
    overlays: z.instanceof(MessagePort),
    google: z.instanceof(MessagePort),
    entry: z.instanceof(MessagePort)
  }),
  bridgesDirectory: z.string(),
  // The executable the browsers start as the native messaging host
  nativeHostPath: z.string(),
  audioWorkerUrl: z.string(),
  uiaWorkerUrl: z.string(),
  isDebugging: z.boolean()
});

export type UiWorkerData = z.infer<typeof uiWorkerDataSchema>;
