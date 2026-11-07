import type { Json, Transport, TransportListener } from "winui-svelte/state/host";

// Two ends of a link in one process, as a MessagePort pair behaves: what one end sends reaches the
// other end's listener on a later turn, as a copy. For the tests of every protocol over such a link.
export function linkedTransports() {
  const listeners: {
    first?: TransportListener;
    second?: TransportListener;
  } = {};

  function endOf({ self, other }: {
    self: "first" | "second";
    other: "first" | "second";
  }) {
    const transport: Transport = {
      send(frame) {
        queueMicrotask(() => listeners[other]?.message(JSON.parse(JSON.stringify(frame)) satisfies Json));
      },
      listen(listener) {
        listeners[self] = listener;
        return () => {
          delete listeners[self];
        };
      }
    };
    return transport;
  }

  return {
    first: endOf({
      self: "first",
      other: "second"
    }),
    second: endOf({
      self: "second",
      other: "first"
    })
  };
}
