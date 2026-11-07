import type { Transport } from "@gemini-live/messaging";

function parseJson(text: string) {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

// One messaging transport that outlives the channel under it. A host builds its WebView2 control
// again after a browser crash, and the messenger (which allows one listener per message) must keep
// its handlers: the transport stays, and attach() points it at the new control.
export function createSwitchableTransport() {
  let sendJson: ((json: string) => void) | undefined;
  let receiveEnvelope: ((envelope: unknown) => void) | undefined;

  const transport: Transport = {
    post(envelope) {
      sendJson?.(JSON.stringify(envelope));
    },
    listen(receive) {
      receiveEnvelope = receive;
    }
  };

  function attach(send: (json: string) => void) {
    sendJson = send;
  }

  function detach() {
    sendJson = undefined;
  }

  function receive(json: string) {
    const envelope = parseJson(json);
    const isUnreadable = envelope === undefined;
    if (isUnreadable) {
      return;
    }

    receiveEnvelope?.(envelope);
  }

  return {
    transport,
    attach,
    detach,
    receive
  };
}

// A messaging transport over a socket's text frames, both ways
export function createFrameTransport({ send, onFrame }: {
  send: (json: string) => void;
  onFrame: (listener: (text: string) => void) => void;
}) {
  const transport: Transport = {
    post(envelope) {
      send(JSON.stringify(envelope));
    },
    listen(receive) {
      onFrame(text => {
        const envelope = parseJson(text);
        const isUnreadable = envelope === undefined;
        if (isUnreadable) {
          return;
        }

        receive(envelope);
      });
    }
  };
  return transport;
}
