import { MessagePort, workerData } from "node:worker_threads";
import { runOnUiThread } from "winui-svelte/thread";
import { z } from "zod";

const workerDataSchema = z.object({ port: z.instanceof(MessagePort) });

await runOnUiThread(async () => {
  const parsedData = workerDataSchema.safeParse(workerData);
  if (!parsedData.success) {
    throw new Error("the sidecar passed no port");
  }

  const { mountControl, registerControls } = await import("winui-svelte");
  const border = await import("winui-svelte/bindings/microsoft/ui/xaml/controls/Border");
  const grid = await import("winui-svelte/bindings/microsoft/ui/xaml/controls/Grid");
  const stackPanel = await import("winui-svelte/bindings/microsoft/ui/xaml/controls/StackPanel");
  const { createHostChannel, createMessagePortTransport } = await import("winui-svelte/state");
  const { installAnimations } = await import("winui-svelte/web-apis/animations");
  const { installPage } = await import("winui-svelte/web-apis/page");
  const { exitWhenHostEnds, runWindow } = await import("winui-svelte/window");
  const { default: appComponent } = await import("@/App.svelte");
  const { connectView } = await import("@/lib/view.svelte.ts");
  const channel = createHostChannel({
    transport: createMessagePortTransport({ port: parsedData.data.port })
  });

  registerControls({
    ...border,
    ...grid,
    ...stackPanel
  });
  connectView({ channel });
  await runWindow({
    webApis: [installAnimations, installPage],
    onStart() {
      exitWhenHostEnds({ link: channel });
      mountControl({
        component: appComponent,
        props: {}
      });
    }
  });
});
