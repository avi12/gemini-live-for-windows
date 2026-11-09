import type { PreviewSource } from "./src/lib/capture/capture-schema.ts";
import type { PillAction, WindowProtocol } from "@gemini-live/protocol/view";
import type { MessagePort } from "node:worker_threads";
import type { WindowHandle } from "winui-svelte/components";
import type { HostChannel } from "winui-svelte/state";

export interface MountedPill {
  readonly messaging: HostChannel<PillAction, WindowProtocol>["messaging"];
  readonly window: () => WindowHandle | undefined;
}

export declare function mountPill(options: {
  port: MessagePort;
  previewSource?: PreviewSource;
  onStart?: (pill: MountedPill) => void;
}): Promise<void>;
