import { MessageChannel } from "node:worker_threads";
import { createMessagePortTransport } from "winui-svelte/state/host";

// One MessageChannel per link between the main thread and the UI worker. The main thread keeps
// the first port of each (as a transport); the second goes to the worker.
export function openChannels() {
  const channels = {
    pill: new MessageChannel(),
    overlays: new MessageChannel(),
    google: new MessageChannel(),
    entry: new MessageChannel()
  };

  return {
    transports: {
      pill: createMessagePortTransport({ port: channels.pill.port1 }),
      overlays: createMessagePortTransport({ port: channels.overlays.port1 }),
      google: createMessagePortTransport({ port: channels.google.port1 }),
      entry: createMessagePortTransport({ port: channels.entry.port1 })
    },
    workerPorts: {
      pill: channels.pill.port2,
      overlays: channels.overlays.port2,
      google: channels.google.port2,
      entry: channels.entry.port2
    }
  };
}

export type Channels = ReturnType<typeof openChannels>;
