// The GlicBrowserHost we hand Glic's web client (ported from Chrome's own dev host): what it reports
// about the browser, and the shared screen it serves as the focused tab. bootstrap.ts hands it over.
import type { Picture, ScreenView } from "@/glic/glic_protocol";

import { FormFactor, HostCapability, PANEL_STATE, Platform, TAB_ID } from "./glic_api";
import { observable, settableObservable } from "./observable";
import { annotatedPageContent, byteStream } from "./page_content";

// Glic sends Live one screenshot per focused tab id, so a fixed id gives one picture per turn. A
// new id this often makes its viewport input pull a fresh frame each time, like Live on Android.
const SCREEN_NUDGE_MS = 1000;

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

/** What the host needs from the session and the app. */
interface HostSession {
  /** The user wants Live running; screen frames and text flow only while it does. */
  isActive(): boolean;
  /** A picture of the shared screen from the app; null if none comes in time. */
  capture(): Promise<Picture | null>;
  /** The screen's text from the app; null if none comes in time. */
  read(): Promise<ScreenView | null>;
  /** Glic closed its panel: Live is idle. */
  onClosePanel(): void;
}

interface GlicHost {
  /** The object Glic's web client is initialized with. */
  host: object;
  /** Re-reads the screen and announces it as a new tab when the last nudge is old enough. */
  refreshScreen(now: number): void;
}

function resolved<T>(value: T) {
  return () => Promise.resolve(value);
}

function toScreenshot(picture: Picture) {
  const bytes = Uint8Array.from(atob(picture.data), char => char.charCodeAt(0));
  return {
    data: bytes.buffer,
    mimeType: picture.mimeType,
    widthPixels: picture.width,
    heightPixels: picture.height
  };
}

export function createGlicHost(session: HostSession) {
  async function captureFrame() {
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
  function nudgeScreen(now: number) {
    lastNudge = now;
    nudges++;
    focusedTabSetting.set(focusedTabState());
  }

  let isReading = false;

  /** Reads the screen's text first, so the next picture and its text reach Gemini together. */
  async function readThenNudge(now: number) {
    if (isReading) {
      return;
    }

    isReading = true;
    lastNudge = now;
    latestView = await session.read();
    isReading = false;

    if (session.isActive()) {
      nudgeScreen(Date.now());
    }
  }

  /** The shared screen's context: the tab, plus its text when Glic asks for it and there is some. */
  function tabContext(options?: ContextOptions) {
    const tabData = focusedTab();
    if (!options?.annotatedPageContent || !latestView) {
      const bare: TabContext = { tabData };
      return bare;
    }

    const content = annotatedPageContent({
      title: tabData.title,
      url: tabData.url,
      blocks: latestView.blocks
    });
    const withContent: TabContext = {
      tabData,
      annotatedPageData: {
        annotatedPageContent: byteStream(content)
      }
    };
    return withContent;
  }

  const host = {
    getChromeVersion: resolved({
      major: 130,
      minor: 0,
      build: 0,
      patch: 0
    }),
    getPlatform: () => Platform.LINUX,
    getFormFactor: () => FormFactor.DESKTOP,
    getHostCapabilities: () =>
      new Set([HostCapability.MULTI_INSTANCE, HostCapability.PDF_ZERO_STATE, HostCapability.INVOKE]),
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
    closePanel() {
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
  } satisfies GlicHost;
}
