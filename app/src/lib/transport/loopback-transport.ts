import type { Transport } from "@gemini-live/messaging";

// Two transports wired to each other in one process: what `first` posts, `second` receives
export function createLoopback() {
  const listeners = {
    first: new Set<(envelope: unknown) => void>(),
    second: new Set<(envelope: unknown) => void>()
  };

  function endpoint({ from, to }: {
    from: "first" | "second";
    to: "first" | "second";
  }) {
    const transport = {
      post(envelope) {
        queueMicrotask(() => {
          for (const receive of listeners[to]) {
            receive(envelope);
          }
        });
      },
      listen(receive) {
        listeners[from].add(receive);
      }
    } satisfies Transport;
    return transport;
  }

  return {
    first: endpoint({
      from: "first",
      to: "second"
    }),
    second: endpoint({
      from: "second",
      to: "first"
    })
  };
}
