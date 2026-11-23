// The WebView2 channel between a hidden page and the app, as a messaging transport. The app's end
// is GoogleWebViewHost's Messenger (PostWebMessageAsJson down, WebMessageReceived up).
import { defineMessaging, type ProtocolMap, type Transport } from "@gemini-live/messaging";

interface WebViewChannel {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
}

declare global {
  interface Window {
    chrome?: { webview?: WebViewChannel };
  }
}

/** The transport to the app; one that goes nowhere outside a WebView2 (a page opened directly). */
function webViewTransport() {
  const channel = window.chrome?.webview;
  return {
    post(envelope) {
      try {
        channel?.postMessage(envelope);
      } catch {
        // The app is gone; nobody is listening.
      }
    },
    listen(receive) {
      channel?.addEventListener("message", event => receive(event.data));
    }
  } satisfies Transport;
}

/** The typed messenger to the app over the WebView2 channel. */
export function connectToApp<TProtocolMap extends ProtocolMap>(timeoutMs: number) {
  return defineMessaging<TProtocolMap>(webViewTransport(), { timeoutMs });
}
