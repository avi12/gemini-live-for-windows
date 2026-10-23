// The WebView2 channel between a hidden page and the app, as a messaging transport. The app's end
// is GoogleWebViewHost's Messenger (PostWebMessageAsJson down, WebMessageReceived up).
import type { Transport } from '@gemini-live/messaging';

interface WebViewChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: MessageEvent<unknown>) => void): void;
}

declare global {
  interface Window {
    chrome?: { webview?: WebViewChannel };
  }
}

/** The transport to the app; one that goes nowhere outside a WebView2 (a page opened directly). */
export const webViewTransport = (): Transport => {
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
      channel?.addEventListener('message', (e) => receive(e.data));
    },
  };
};
