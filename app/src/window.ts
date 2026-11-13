import { workerData } from "node:worker_threads";

import { runOnUiThread } from "winui-svelte/thread";

import { uiWorkerDataSchema } from "@/wiring/ui-thread/ui-worker-data.ts";

// The UI-thread worker: everything WinUI lives here, and the main thread owns the state it shows
await runOnUiThread(async () => {
  const parsedData = uiWorkerDataSchema.safeParse(workerData);
  if (!parsedData.success) {
    throw new Error(`the main thread passed the UI worker bad data: ${parsedData.error.message}`);
  }

  const { startUi } = await import("@/wiring/ui-thread/start-ui.ts");
  await startUi(parsedData.data);
});
