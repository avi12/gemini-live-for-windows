// The bootstrap that hands Glic our host. Chrome normally passes it over a chrome://glic-origin
// handshake a webview cannot forge, so we pre-define internalAutoGlicBoot and replay Glic's own
// message listener with a synthetic chrome://glic event (it needs a non-null source).
import { PANEL_STATE } from "./glic_api";
import { notify } from "./observable";

const BOOT_POLL_MS = 100;
const MAX_BOOT_TRIES = 150;

/** What Glic's web client exposes to us once it registers. */
interface WebClient {
  initialize(host: unknown): unknown;
  notifyPanelWillOpen?(state: unknown): void;
}

declare global {
  interface Window {
    internalAutoGlicBoot?: () => unknown;
  }
}

interface BootEvents {
  /** Glic adopted the host. */
  onBooted(): void;
  /** Glic never adopted it. */
  onFailed(): void;
}

/**
 * Offers `host` to Glic until it adopts it, polling for a while from now; the returned function
 * offers it once more (a no-op once booted).
 */
export function installBootstrap({ host, events }: { host: object; events: BootEvents }) {
  let isBooted = false;

  const registry = {
    registerWebClient(webClient: WebClient) {
      return Promise.resolve()
        .then(() => webClient.initialize(host))
        .then(() => {
          isBooted = true;
          events.onBooted();
          setTimeout(() => {
            if (webClient.notifyPanelWillOpen) {
              notify({
                subscriber: state => webClient.notifyPanelWillOpen?.(state),
                value: PANEL_STATE
              });
            }
          }, 0);
        });
    }
  };
  window.internalAutoGlicBoot = () => registry;

  const bootstrapHandlers: EventListener[] = [];
  const originalAddEventListener = EventTarget.prototype.addEventListener.bind(window);
  Object.defineProperty(window, "addEventListener", {
    configurable: true,
    writable: true,
    value(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) {
      if (type === "message" && typeof listener === "function") {
        bootstrapHandlers.push(listener);
      }

      originalAddEventListener(type, listener, options);
    }
  });
  const bootstrapEvent = new MessageEvent("message", {
    origin: "chrome://glic",
    source: window,
    data: {
      type: "glic-bootstrap",
      glicApiSource: "data:text/javascript,//desktop"
    }
  });

  function tryBootstrap() {
    if (isBooted) {
      return;
    }

    for (const handler of bootstrapHandlers) {
      notify({
        subscriber: handler,
        value: bootstrapEvent
      });
    }
  }

  let bootTries = 0;
  const bootTimer = setInterval(() => {
    tryBootstrap();
    const shouldRetryBoot = !isBooted && ++bootTries <= MAX_BOOT_TRIES;
    if (shouldRetryBoot) {
      return;
    }

    clearInterval(bootTimer);

    if (!isBooted) {
      events.onFailed();
    }
  }, BOOT_POLL_MS);

  return tryBootstrap;
}
