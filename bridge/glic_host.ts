// The GlicBrowserHost we hand Glic's web client (ported from Chrome's own dev host), and the
// bootstrap that hands it over. Chrome normally passes it over a chrome://glic-origin handshake a
// webview cannot forge, so we pre-define internalAutoGlicBoot and replay Glic's own message
// listener with a synthetic chrome://glic event (it needs a non-null source).
import type { Picture, ScreenView } from "./glic_protocol";
import { annotatedPageContent, byteStream } from "./page_content";

// Glic host API enums we answer with, values from Chromium's glic_api_generated.ts.
enum PanelStateKind {
  Attached = 2
}
/** LINUX is what the original port reported; kept as is. */
enum Platform {
  Linux = 3
}
enum FormFactor {
  Desktop = 1
}
enum HostCapability {
  MultiInstance = 3,
  PdfZeroState = 7,
  Invoke = 8
}

const TAB_ID = "desktop";
const PANEL_STATE = {
  kind: PanelStateKind.Attached,
  windowId: TAB_ID
};
// Glic sends Live one screenshot per focused tab id, so a fixed id gives one picture per turn. A
// new id this often makes its viewport input pull a fresh frame each time, like Live on Android.
const SCREEN_NUDGE_MS = 1000;
const BOOT_POLL_MS = 100;
const MAX_BOOT_TRIES = 150;

/** What Glic asks of a tab's context. */
interface ContextOptions {
  viewportScreenshot?: boolean;
  annotatedPageContent?: boolean;
}

interface Screenshot {
  data: ArrayBuffer;
  mimeType: string;
  widthPixels: number;
  heightPixels: number;
}

interface TabContext {
  tabData: unknown;
  annotatedPageData?: { annotatedPageContent: ReadableStream<Uint8Array> };
  viewportScreenshot?: Screenshot;
  screenshotInfo?: {
    widthPixels: number;
    heightPixels: number;
  };
}

type Subscriber<T> = (value: T) => void;
interface Subscription {
  unsubscribe(): void;
}
interface Observable<T> {
  subscribe(change: Subscriber<T>): Subscription;
}

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

/** What the host needs from the session and the app. */
export interface HostSession {
  /** The user wants Live running; screen frames and text flow only while it does. */
  isActive(): boolean;
  /** A picture of the shared screen from the app; null if none comes in time. */
  capture(): Promise<Picture | null>;
  /** The screen's text from the app; null if none comes in time. */
  read(): Promise<ScreenView | null>;
  /** Glic closed its panel: Live is idle. */
  onClosePanel(): void;
}

export interface GlicHost {
  /** The object Glic's web client is initialized with. */
  host: object;
  /** Re-reads the screen and announces it as a new tab when the last nudge is old enough. */
  refreshScreen(now: number): void;
}

/** Calls a subscriber, isolating us from its errors. */
function notify<T>(subscriber: (value: T) => unknown, value: T): void {
  try {
    subscriber(value);
  } catch {
    // A subscriber's error is its own.
  }
}

/** An observable that never changes. */
function observable<T>(value: T): Observable<T> {
  return {
    subscribe(change) {
      notify(change, value);
      return { unsubscribe() {} };
    }
  };
}

function settableObservable<T>(initial: T) {
  let value = initial;
  const subscribers: Subscriber<T>[] = [];
  return {
    get: () => value,
    set(next: T) {
      value = next;
      for (const subscriber of subscribers) {
        notify(subscriber, next);
      }
    },
    subscribe(change: Subscriber<T>): Subscription {
      subscribers.push(change);
      notify(change, value);
      return {
        unsubscribe() {
          const i = subscribers.indexOf(change);
          if (i >= 0) {
            subscribers.splice(i, 1);
          }
        }
      };
    }
  };
}

function resolved<T>(value: T): () => Promise<T> {
  return () => Promise.resolve(value);
}

function toScreenshot(picture: Picture): Screenshot {
  const bytes = Uint8Array.from(atob(picture.data), char => char.charCodeAt(0));
  return {
    data: bytes.buffer,
    mimeType: picture.mimeType,
    widthPixels: picture.width,
    heightPixels: picture.height
  };
}

export function createGlicHost(session: HostSession): GlicHost {
  async function captureFrame(): Promise<Screenshot | null> {
    if (!session.isActive()) {
      return null;
    }

    const picture = await session.capture();
    return picture ? toScreenshot(picture) : null;
  }

  /** The newest text copy of the screen, shared with every picture; null when there is none. */
  let latestView: ScreenView | null = null;

  // Captions on: Glic's caption overlay is the only page-visible source of the spoken text.
  const captionSetting = settableObservable(true);

  /** How many times the shared screen was announced as a new tab; part of its tab id. */
  let nudges = 0;
  let lastNudge = 0;

  function focusedTab() {
    return {
      tabId: `${TAB_ID}-${nudges}`,
      url: "https://localhost/desktop",
      title: latestView?.title || "Desktop",
      faviconUrl: "",
      documentMimeType: "text/html",
      isMediaActive: false
    };
  }
  function focusedTabState() {
    return {
      hasFocus: {
        tabData: focusedTab()
      }
    };
  }
  const focusedTabSetting = settableObservable(focusedTabState());

  /** Announces the screen under a new tab id, so Glic pulls a fresh frame of it. */
  function nudgeScreen(now: number): void {
    lastNudge = now;
    nudges++;
    focusedTabSetting.set(focusedTabState());
  }

  let reading = false;

  /** Reads the screen's text first, so the next picture and its text reach Gemini together. */
  async function readThenNudge(now: number): Promise<void> {
    if (reading) {
      return;
    }

    reading = true;
    lastNudge = now;
    latestView = await session.read();
    reading = false;

    if (session.isActive()) {
      nudgeScreen(Date.now());
    }
  }

  /** The shared screen's context: the tab, plus its text when Glic asks for it and there is some. */
  function tabContext(options?: ContextOptions): TabContext {
    const tabData = focusedTab();
    if (!options?.annotatedPageContent || !latestView) {
      return { tabData };
    }

    const content = annotatedPageContent(tabData.title, tabData.url, latestView.blocks);
    return {
      tabData,
      annotatedPageData: {
        annotatedPageContent: byteStream(content)
      }
    };
  }

  const host = {
    getChromeVersion: resolved({
      major: 130,
      minor: 0,
      build: 0,
      patch: 0
    }),
    getPlatform: () => Platform.Linux,
    getFormFactor: () => FormFactor.Desktop,
    getHostCapabilities: () =>
      new Set([HostCapability.MultiInstance, HostCapability.PdfZeroState, HostCapability.Invoke]),
    getUserProfileInfo: resolved({
      displayName: "You",
      email: "",
      givenName: "You",
      localProfileName: "You",
      isManaged: false,
      avatarIcon: resolved(undefined)
    }),
    getPanelState: () => observable(PANEL_STATE),
    panelActive: () => observable(true),
    getFocusedTabStateV2: () => focusedTabSetting,
    getContextFromFocusedTab: (options?: ContextOptions) => Promise.resolve(tabContext(options)),
    captureScreenshot: () => captureFrame(),
    // Live's viewport: Glic pulls a screenshot and the page content through here for each new
    // focused tab id.
    async getContextFromTab(_tabId: string, options?: ContextOptions) {
      const context = tabContext(options);
      if (!options?.viewportScreenshot) {
        return context;
      }

      const shot = await captureFrame();
      if (shot) {
        context.viewportScreenshot = shot;
        context.screenshotInfo = {
          widthPixels: shot.widthPixels,
          heightPixels: shot.heightPixels
        };
      }

      return context;
    },
    getTabContextPermissionStateV2: () => observable(true),
    getMicrophonePermissionState: () => observable(true),
    getLocationPermissionState: () => observable(true),
    getTabContextPermissionState: () => observable(true),
    getClosedCaptioningSetting: () => captionSetting,
    getDefaultTabContextPermissionState: () => observable(true),
    canAttachPanel: () => observable(false),
    isBrowserOpen: () => observable(true),
    isManuallyResizing: () => observable(false),
    getOsMicrophonePermissionStatus: resolved(true),
    getOsHotkeyState: () => observable({ hotkey: "" }),
    resizeWindow: resolved(undefined),
    setTabContextPermissionState: resolved(undefined),
    setMicrophonePermissionState: resolved(undefined),
    setLocationPermissionState: resolved(undefined),
    setClosedCaptioningSetting: resolved(undefined), // keep captions on: they are our text tap
    attachPanel: resolved(undefined),
    detachPanel: resolved(undefined),
    closePanel(): Promise<void> {
      session.onClosePanel();
      return Promise.resolve();
    }
  };

  return {
    host,
    refreshScreen(now) {
      if (now - lastNudge >= SCREEN_NUDGE_MS) {
        void readThenNudge(now);
      }
    }
  };
}

export interface BootEvents {
  /** Glic adopted the host. */
  onBooted(): void;
  /** Glic never adopted it. */
  onFailed(): void;
}

/**
 * Offers `host` to Glic until it adopts it, polling for a while from now; the returned function
 * offers it once more (a no-op once booted).
 */
export function installBootstrap(host: object, events: BootEvents): () => void {
  let booted = false;

  const registry = {
    registerWebClient(webClient: WebClient): Promise<void> {
      return Promise.resolve()
        .then(() => webClient.initialize(host))
        .then(() => {
          booted = true;
          events.onBooted();
          setTimeout(() => {
            if (webClient.notifyPanelWillOpen) {
              notify(state => webClient.notifyPanelWillOpen?.(state), PANEL_STATE);
            }
          }, 0);
        });
    }
  };
  window.internalAutoGlicBoot = () => registry;

  const bootstrapHandlers: EventListener[] = [];
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  Object.defineProperty(window, "addEventListener", {
    configurable: true,
    writable: true,
    value(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) {
      if (type === "message" && typeof listener === "function") {
        bootstrapHandlers.push(listener);
      }

      originalAddEventListener.call(window, type, listener, options);
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

  function tryBootstrap(): void {
    if (booted) {
      return;
    }

    for (const handler of bootstrapHandlers) {
      notify(handler, bootstrapEvent);
    }
  }

  let bootTries = 0;
  const bootTimer = setInterval(() => {
    tryBootstrap();

    if (!booted && ++bootTries <= MAX_BOOT_TRIES) {
      return;
    }

    clearInterval(bootTimer);

    if (!booted) {
      events.onFailed();
    }
  }, BOOT_POLL_MS);

  return tryBootstrap;
}
