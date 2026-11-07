import { createKeyTriggerSender, KeySource } from "@/entry/activation/protocol.ts";
import { isFastPathSpikeRequested, startFastPathSpike } from "@/entry/fast-path/fast-path-spike.ts";
import { startFastPath } from "@/entry/fast-path/fast-path.ts";
import type { MessagePort } from "node:worker_threads";
import { createMessagePortTransport } from "winui-svelte/state/host";

// The Copilot key's fast path, heard on this thread because its hidden window needs this thread's
// message pump; each press goes to the main thread, which owns the conversation. The spike
// (scripts\Register-FastPathSpike.ps1) logs the messages instead of acting on them.
export function startKeyTriggers({ port }: { port: MessagePort }) {
  if (isFastPathSpikeRequested()) {
    startFastPathSpike();
    return;
  }

  const send = createKeyTriggerSender({ transport: createMessagePortTransport({ port }) });
  startFastPath({
    onTrigger: trigger => send({
      trigger,
      source: KeySource.fastPath
    })
  });
}
