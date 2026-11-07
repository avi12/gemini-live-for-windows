import { pillWindow } from "@/lib/pill-window.ts";
import type { PillAction, WindowProtocol } from "@gemini-live/protocol/view";
import type { MessagePort } from "node:worker_threads";
import type { HostChannel } from "winui-svelte/state";

// What the host gets once the pill is up: the typed link to answer its own messages on, and the
// pill's window
export interface MountedPill {
  readonly messaging: HostChannel<PillAction, WindowProtocol>["messaging"];
  readonly window: typeof pillWindow;
}

// Mounts the pill on the UI thread, over the port that carries the host's state protocol: the
// sidecar's window.ts and the app's UI worker both call it from inside `runOnUiThread`. `onStart`
// runs once the window thread's message pump has started.
export async function mountPill({ port, onStart }: {
  port: MessagePort;
  onStart?: (pill: MountedPill) => void;
}) {
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
  const channel = createHostChannel<PillAction, WindowProtocol>({ transport: createMessagePortTransport({ port }) });

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
      onStart?.({
        messaging: channel.messaging,
        window: pillWindow
      });
    }
  });
}
