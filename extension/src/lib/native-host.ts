// Asks the app's native messaging host where this run of the app listens.
import { type LinkInfo, NATIVE_HOST, NativeMessage, type NativeProtocolMap } from "@/lib/native-protocol";
import { defineMessaging, type Transport } from "@gemini-live/messaging";

// The browser starts the host process per ask; give it time to boot before calling the link gone.
const NATIVE_TIMEOUT_MS = 10000;

/** A native host port as a messaging transport: the browser frames JSON both ways. */
function portTransport(port: Browser.runtime.Port): Transport {
  return {
    post(envelope) {
      // A port the host already closed throws; its sender's timeout (or the disconnect) reports it.
      try {
        port.postMessage(envelope);
      } catch {
        // Gone already.
      }
    },
    listen(receive) {
      port.onMessage.addListener((message: unknown) => receive(message));
    }
  };
}

/**
 * The running app's link, asked of its native messaging host; undefined when the host isn't
 * installed or the app isn't running, so the caller retries later.
 */
export async function readLinkInfo(): Promise<LinkInfo | undefined> {
  let port: Browser.runtime.Port;
  try {
    port = browser.runtime.connectNative(NATIVE_HOST);
  } catch {
    return undefined;
  }

  const disconnected = new Promise<undefined>(resolve => {
    port.onDisconnect.addListener(() => {
      // Reading lastError marks it handled: a missing or crashed host just means "no link yet".
      void browser.runtime.lastError;
      resolve(undefined);
    });
  });
  const messenger = defineMessaging<NativeProtocolMap>(portTransport(port), { timeoutMs: NATIVE_TIMEOUT_MS });
  try {
    const info = await Promise.race([messenger.sendMessage(NativeMessage.Link), disconnected]);
    return info ?? undefined;
  } catch {
    return undefined;
  } finally {
    messenger.removeAllListeners();
    port.disconnect();
  }
}
