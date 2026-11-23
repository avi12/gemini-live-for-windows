import type { MessagePort } from "node:worker_threads";

import type { PillAction, WindowProtocol } from "@gemini-live/protocol/view";
import type { WindowClipper } from "@gemini-live/protocol/view";
import type { WindowHandle } from "winui-svelte/components";
import type { HostChannel } from "winui-svelte/state";

import type { PreviewSource } from "./src/lib/capture/capture-schema.ts";

export interface MountedPill {
  readonly messaging: HostChannel<PillAction, WindowProtocol>["messaging"];
  readonly window: () => WindowHandle | undefined;
}

export declare function mountPill(options: {
  port: MessagePort;
  previewSource?: PreviewSource;
  // Clips a window on the pill's thread; without it, each clip is asked of the host over the port
  clipWindow?: WindowClipper;
  onStart?: (pill: MountedPill) => void;
}): Promise<void>;
