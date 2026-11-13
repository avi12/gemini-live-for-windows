import { MessagePort, workerData } from "node:worker_threads";

import type * as MountModule from "@gemini-live/pill/mount";
import { createWindowModuleRunner } from "winui-svelte/runner";
import { runOnUiThread } from "winui-svelte/thread";
import { z } from "zod";

import type * as FakeCaptureModule from "./fake-capture-bridge.ts";
import { PILL_ENTRY } from "./module-server.ts";

const FAKE_CAPTURE_ENTRY = "/dev/fake-capture-bridge.ts";

const workerDataSchema = z.object({
  modules: z.instanceof(MessagePort),
  port: z.instanceof(MessagePort),
  isFakeCapture: z.boolean()
});

await runOnUiThread(async () => {
  const parsedData = workerDataSchema.safeParse(workerData);
  if (!parsedData.success) {
    throw new Error("the dev host passed no ports");
  }

  const { runner } = createWindowModuleRunner(parsedData.data.modules);
  const { mountPill } = await runner.import<typeof MountModule>(PILL_ENTRY);
  const { createFakePreviewSource } = await runner.import<typeof FakeCaptureModule>(FAKE_CAPTURE_ENTRY);
  await mountPill({
    port: parsedData.data.port,
    ...(parsedData.data.isFakeCapture && {
      previewSource: createFakePreviewSource()
    })
  });
});
