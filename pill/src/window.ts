import { MessagePort, workerData } from "node:worker_threads";

import { runOnUiThread } from "winui-svelte/thread";
import { z } from "zod";

import { mountPill } from "@/mount.ts";

const workerDataSchema = z.object({ port: z.instanceof(MessagePort) });

await runOnUiThread(async () => {
  const parsedData = workerDataSchema.safeParse(workerData);
  if (!parsedData.success) {
    throw new Error("the sidecar passed no port");
  }

  await mountPill({ port: parsedData.data.port });
});
