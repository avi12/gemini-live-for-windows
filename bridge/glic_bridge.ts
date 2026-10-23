// Injected at document-start into gemini.google.com/glic inside our WebView2 (bundled to
// glic_bridge.js by build.mjs).
//
// Ported from agentic-gaming-assistant/src-tauri/bridges/gemini_voice_bridge.ts (RE notes in that
// repo: reverse-engineering/gemini/GLIC-FINDINGS.md). "Glic" is Gemini in Chrome: the real, signed-in
// gemini.google.com/glic web app, which runs the WHOLE Live loop itself - mic via getUserMedia (with
// Chromium's echo canceller), the Live session to geminiweb-pa.../v1/processSession, Gemini's native
// voice out. Chrome normally hands it a "host" object over a chrome://glic-origin handshake that a
// webview cannot forge, so we define window.internalAutoGlicBoot ourselves and replay the app's own
// bootstrap listener with a synthetic event. Our host then answers its getters - including the
// viewport screenshots Live pulls while sharing, which we fetch from the C# side (ScreenGrabber).
//
// Wire to C#: the typed messenger (GlicProtocolMap in glic_protocol.ts) over chrome.webview. The page
// reports to GlicHost and asks it for frames and screen text; GlicHost sends the session commands.

import {
  Direction,
  GlicMessage,
  type GlicProtocolMap,
  type Microphone,
  type ScreenView,
  State
} from "./glic_protocol";
import { gateMicrophone, type MicGate } from "./mic_gate";
import { annotatedPageContent, byteStream } from "./page_content";
import { webViewTransport } from "./webview_transport";
import { defineMessaging } from "@gemini-live/messaging";

// ===========================================================================
// Vocabulary: every string we match on Glic's page or exchange with C#, in one place.
// ===========================================================================

/**
 * Error messages. SignedOut and Unavailable are codes GlicHost matches on to wait for a fresh
 * session, LiveBroke one it answers by reloading the page; the rest are shown to the user.
 */
enum ErrorMessage {
  SignedOut = "signed-out",
  Unavailable = "unavailable",
  LiveBroke = "live-broke",
  PageDidNotStart = "Gemini page did not start",
  LiveDidNotStart = "Gemini Live did not start (sign-in or rate limit)"
}

/** Fragments of Glic's button aria-labels. */
enum Button {
  AddEvent = "Add event",
  AddEventTitleCase = "Add Event",
  Confirm = "Confirm",
  ConfirmsActions = "Button that confirms actions",
  Copy = "Copy",
  Create = "Create",
  Delete = "Delete",
  End = "End",
  GoBack = "Go back",
  GoLive = "Go Live",
  GoodResponse = "Good response",
  NoThanks = "No thanks",
  Ok = "OK",
  PauseLive = "Pause live mode",
  Regenerate = "Regenerate",
  Remove = "Remove",
  Save = "Save",
  Send = "Send",
  SendMessage = "Send message",
  Skip = "Skip",
  StartLive = "Start live mode",
  StopResponse = "Stop response",
  Submit = "Submit",
  TextMode = "Switch to text mode",
  TryAgain = "Try again",
  TurnOnCaptions = "Turn on live captions",
  Update = "Update"
}

/** Either one shows while Live is paused; clicking it resumes. */
const RESUME_BUTTONS = [Button.StartLive, Button.GoLive];

/** Phrases in Glic's visible text. */
enum Phrase {
  MicConsent = "Live will use your microphone",
  Unavailable = "isn't available right now",
  WentWrong = "Something went wrong"
}
const SIGN_IN_PATTERN = /\bSign in\b/;

// "default" and "communications" are aliases Chromium adds for Windows' default devices.
const MIC_ALIAS_IDS = new Set(["default", "communications"]);

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
const BOOT_POLL_MS = 100;
const MAX_BOOT_TRIES = 150;
const UNAVAILABLE_POLL_MS = 500;
const START_POLL_MS = 300;
const MAX_START_TRIES = 100;
const MONITOR_POLL_MS = 300;
const REQUEST_TIMEOUT_MS = 3000;
// Glic sends Live one screenshot per focused tab id, so a fixed id gives one picture per turn. A
// new id this often makes its viewport input pull a fresh frame each time, like Live on Android.
const SCREEN_NUDGE_MS = 1000;
// Glic pauses Live by itself (idle timeouts, a turn it treats as finished). Only the user ends a
// session here - Win+C or X - so unpause straight away, backing off up to a cap but never giving
// up: a pause only ever means resume.
const RESUME_GAP_MS = 2000;
const MAX_RESUME_BACKOFF = 5;
// Live breaking shows "Something went wrong": press Glic's own Try again, at most this often, and
// only if Live is still broken this long after it last ran, have the host reload the page.
const TRY_AGAIN_GAP_MS = 5000;
const BROKEN_AFTER_MS = 15_000;

// ===========================================================================
// Types for the page and the host object Glic expects.
// ===========================================================================

interface Utterance {
  direction: Direction;
  text: string;
}

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

/** One of Glic's client flags (BardChatUi); we only rewrite the two members the flag service reads. */
interface ClientFlag {
  key?: string;
  defaultValue?: number;
  ctor?: (raw: unknown) => number;
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

declare global {
  interface Window {
    __glicBridgeInstalled?: boolean;
    internalAutoGlicBoot?: () => unknown;
    default_BardChatUi?: Record<string, unknown>;
  }
}

// Top frame only, install once.
if (!window.__glicBridgeInstalled && window.top === window) {
  window.__glicBridgeInstalled = true;
  const app = defineMessaging<GlicProtocolMap>(webViewTransport(), { timeoutMs: REQUEST_TIMEOUT_MS });

  // ===========================================================================
  // Session state shared by the sections below.
  // ===========================================================================

  /** Glic adopted our host. */
  let booted = false;
  /** The user wants Live running; screen frames flow only while it does. */
  let active = false;
  /** The stale-session page was seen and reported; nothing will start until a reload. */
  let unavailableReported = false;
  /** Last state sent to C#, to send only changes. */
  let lastState: State | null = null;

  // ===========================================================================
  // Reports to C# and page helpers.
  // ===========================================================================

  /** Sends a report to C#, which may be gone (no WebView2, or the app is closing): drops a failure. */
  const report = (sent: Promise<void>): void => {
    sent.catch(() => {});
  };

  const reportError = (message: ErrorMessage): void => report(app.sendMessage(GlicMessage.Error, message));

  const pageText = (): string => document.body?.innerText || "";

  const pageSays = (phrase: Phrase): boolean => pageText().includes(phrase);

  /** Finds the first button whose aria-label contains one of the fragments, trying them in order. */
  const findButton = (...fragments: Button[]): HTMLButtonElement | null => {
    const buttons = [...document.querySelectorAll("button")];
    for (const fragment of fragments) {
      const match = buttons.find(b => (b.getAttribute("aria-label") || "").includes(fragment));
      if (match) {
        return match;
      }
    }
    return null;
  };

  /** Clicks the first button {@link findButton} finds; whether one was clicked. */
  const clickButton = (...fragments: Button[]): boolean => {
    const button = findButton(...fragments);
    if (!button) {
      return false;
    }

    button.click();
    return true;
  };

  const isSignedOut = (): boolean =>
    location.hostname === "accounts.google.com" ||
    (SIGN_IN_PATTERN.test(pageText()) && !findButton(Button.GoLive));

  /** Reports a failed start, preferring "signed-out" so the host can wait for a session. */
  const reportStartFailure = (fallback: ErrorMessage): void =>
    reportError(isSignedOut() ? ErrorMessage.SignedOut : fallback);

  const setState = (state: State): void => {
    if (lastState === state) {
      return;
    }

    lastState = state;
    report(app.sendMessage(GlicMessage.State, state));
  };

  // ===========================================================================
  // Hidden WebView: never let Glic see itself as hidden, or it pauses Live.
  // ===========================================================================

  try {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible"
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false
    });
    document.addEventListener("visibilitychange", e => e.stopImmediatePropagation(), true);
  } catch {
    // Best effort: a page that froze these keeps its own visibility.
  }

  // ===========================================================================
  // Mic: keep AEC, add auto-gain + voice isolation so barge-in works over desktop speakers.
  // Each capture goes through a gate the pill's mute button closes (see mic_gate.ts).
  // ===========================================================================

  const micGates = new Set<MicGate>();
  let muted = false;
  /** The microphone picked in the app's menu (null = Windows' default), applied to every capture. */
  let micId: string | null = null;

  /** Rewrites Glic's getUserMedia constraints: audio gets our processing and mic pick, video never goes through. */
  const withDesktopConstraints = (constraints?: MediaStreamConstraints): MediaStreamConstraints | undefined => {
    if (!constraints) {
      return constraints;
    }

    // Glic's camera-share mode asks for video, which pops a Windows camera prompt. We only share
    // the screen (frames from C#), so the camera is never opened.
    const { video, ...rest } = constraints;
    if (video && !rest.audio) {
      throw new DOMException("Camera is not shared on desktop", "NotAllowedError");
    }

    if (!rest.audio) {
      return rest;
    }

    const requested = rest.audio === true ? {} : rest.audio;
    return {
      ...rest,
      audio: {
        ...requested,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        // voiceIsolation is Chromium-only and not in the DOM typings.
        ...({ voiceIsolation: true } as object),
        // ideal, not exact: an unplugged pick falls back to the default instead of failing Live.
        ...(micId ? {
          deviceId: {
            ideal: micId
          }
        } : {})
      }
    };
  };

  try {
    const media = navigator.mediaDevices;
    const getUserMedia = media.getUserMedia.bind(media);
    media.getUserMedia = async constraints => {
      const stream = await getUserMedia(withDesktopConstraints(constraints));
      if (stream.getAudioTracks().length === 0) {
        return stream;
      }

      const gate = await gateMicrophone(stream);
      gate.setOpen(!muted);
      micGates.add(gate);
      return gate.stream;
    };
  } catch {
    // Frozen mediaDevices: Glic captures with its own constraints.
  }

  const setMuted = (value: boolean): void => {
    muted = value;
    for (const gate of micGates) {
      if (gate.stream.getAudioTracks().some(t => t.readyState === "live")) {
        gate.setOpen(!value);
      } else {
        micGates.delete(gate);
      }
    }
  };

  /** Real microphones only, without Chromium's default-device aliases. */
  const listMics = async (): Promise<Microphone[]> => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter(d => d.kind === "audioinput" && d.deviceId && !MIC_ALIAS_IDS.has(d.deviceId))
      .map(d => ({
        id: d.deviceId,
        label: d.label || "Microphone"
      }));
  };

  /** A running session holds its stream, so a new pick restarts Live to reopen the mic. */
  const setMic = (id: string | null): void => {
    const next = id || null;
    if (next === micId) {
      return;
    }

    micId = next;

    if (!active) {
      return;
    }

    stop();
    start();
  };

  /** Which device "default" currently names, or '' if unknown. */
  const defaultMicLabel = async (): Promise<string> => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.find(d => d.kind === "audioinput" && d.deviceId === "default")?.label ?? "";
  };

  // A stream opened on "default" stays on the device that was default then, so when Windows' default
  // input changes (and no mic is picked in the menu) restart Live to reopen it on the new one.
  try {
    let followedDefault = "";
    defaultMicLabel().then(
      label => (followedDefault = label),
      () => {}
    );
    navigator.mediaDevices.addEventListener("devicechange", async () => {
      const label = await defaultMicLabel().catch(() => followedDefault);
      if (label === followedDefault) {
        return;
      }

      followedDefault = label;

      if (active && !micId) {
        stop();
        start();
      }
    });
  } catch {
    // No device events: a new default applies at the next start.
  }

  // ===========================================================================
  // Screen frames and text from C#, asked for over the messenger; null if none comes in time.
  // ===========================================================================

  const captureFrame = async (): Promise<Screenshot | null> => {
    if (!active) {
      return null;
    }

    const picture = await app.sendMessage(GlicMessage.Capture).catch(() => null);
    if (!picture) {
      return null;
    }

    const bytes = Uint8Array.from(atob(picture.data), c => c.charCodeAt(0));
    return {
      data: bytes.buffer,
      mimeType: picture.mimeType,
      widthPixels: picture.width,
      heightPixels: picture.height
    };
  };

  /** The newest text copy of the screen, shared with every picture; null when there is none. */
  let latestView: ScreenView | null = null;

  const readScreen = (): Promise<ScreenView | null> =>
    app.sendMessage(GlicMessage.Read).catch(() => null);

  // ===========================================================================
  // The GlicBrowserHost we hand the web client (ported from Chrome's own dev host).
  // ===========================================================================

  /** Calls a subscriber, isolating us from its errors. */
  const notify = <T>(subscriber: (value: T) => unknown, value: T): void => {
    try {
      subscriber(value);
    } catch {
      // A subscriber's error is its own.
    }
  };

  /** An observable that never changes. */
  const observable = <T>(value: T): Observable<T> => ({
    subscribe(change) {
      notify(change, value);
      return { unsubscribe() {} };
    }
  });

  const settableObservable = <T>(initial: T) => {
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
  };

  // Captions on: Glic's caption overlay is the only page-visible source of the spoken text.
  const captionSetting = settableObservable(true);

  /** How many times the shared screen was announced as a new tab; part of its tab id. */
  let nudges = 0;
  let lastNudge = 0;

  const focusedTab = () => ({
    tabId: `${TAB_ID}-${nudges}`,
    url: "https://localhost/desktop",
    title: latestView?.title || "Desktop",
    faviconUrl: "",
    documentMimeType: "text/html",
    isMediaActive: false
  });
  const focusedTabState = () => ({
    hasFocus: {
      tabData: focusedTab()
    }
  });
  const focusedTabSetting = settableObservable(focusedTabState());

  /** Announces the screen under a new tab id, so Glic pulls a fresh frame of it. */
  const nudgeScreen = (now: number): void => {
    lastNudge = now;
    nudges++;
    focusedTabSetting.set(focusedTabState());
  };

  let reading = false;

  /** Reads the screen's text first, so the next picture and its text reach Gemini together. */
  const readThenNudge = async (now: number): Promise<void> => {
    if (reading) {
      return;
    }

    reading = true;
    lastNudge = now;
    latestView = await readScreen();
    reading = false;

    if (active) {
      nudgeScreen(Date.now());
    }
  };

  /** The shared screen's context: the tab, plus its text when Glic asks for it and there is some. */
  const tabContext = (options?: ContextOptions): TabContext => {
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
  };

  const resolved =
    <T>(value: T) =>
      (): Promise<T> =>
        Promise.resolve(value);

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
      setState(State.Idle);
      return Promise.resolve();
    }
  };

  // ===========================================================================
  // Bootstrap: pre-define internalAutoGlicBoot, then replay Glic's own message listener with a
  // synthetic chrome://glic event (it needs a non-null source).
  // ===========================================================================

  const registry = {
    registerWebClient(webClient: WebClient): Promise<void> {
      return Promise.resolve()
        .then(() => webClient.initialize(host))
        .then(() => {
          booted = true;
          report(app.sendMessage(GlicMessage.Booted));
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

  const tryBootstrap = (): void => {
    if (booted) {
      return;
    }

    for (const handler of bootstrapHandlers) {
      notify(handler, bootstrapEvent);
    }
  };

  let bootTries = 0;
  const bootTimer = setInterval(() => {
    tryBootstrap();

    if (!booted && ++bootTries <= MAX_BOOT_TRIES) {
      return;
    }

    clearInterval(bootTimer);

    if (!booted) {
      reportStartFailure(ErrorMessage.PageDidNotStart);
    }
  }, BOOT_POLL_MS);

  // A stale Google session still loads /glic and even adopts our host, but then shows "Gemini isn't
  // available right now" (its cookie rotation 401s). Report it so the host can offer a fresh sign-in.
  const unavailableTimer = setInterval(() => {
    if (!pageSays(Phrase.Unavailable)) {
      return;
    }

    clearInterval(unavailableTimer);
    unavailableReported = true;
    reportError(ErrorMessage.Unavailable);
  }, UNAVAILABLE_POLL_MS);

  // ===========================================================================
  // Transcript from the Live wire. Glic's caption overlay labels some of Gemini's own speech
  // "You:" (the "Let me check on that" filler before a tool call, sometimes whole answers), but the
  // Live channel itself never confuses the two: the user's words arrive as the server's input
  // transcription and Gemini's as its output transcription. So read them off the wire. Frame
  // layout: docs/live-transcript-wire.md.
  // ===========================================================================

  /** The Live channel; its long-poll GETs are the downlink (POSTs carry the mic up). */
  const LIVE_CHANNEL_PATH = "/v1/processSession";

  /** Field indexes in a server message, MSG. */
  enum MsgField {
    Seq = 0,
    ServerContent = 1,
    InputTranscription = 7
  }

  /** Field indexes in MSG[ServerContent]. */
  enum ContentField {
    GenerationComplete = 2,
    Interrupted = 3,
    OutputTranscription = 5
  }

  /** Utterances in the order the wire opened them; the array index is the transcript index. */
  let utterances: Utterance[] = [];
  /** Index of the user utterance still being transcribed, or -1. */
  let openUser = -1;
  /** A user utterance Gemini's reply closed before its final transcript arrived, or -1. */
  let unfinishedUser = -1;
  /** Index of the Gemini utterance still being spoken, or -1. */
  let openAssistant = -1;
  /** The wire carried a transcript, so the caption scrape is not needed. */
  let wireSeen = false;
  /** Last text relayed per index, to send only changes. */
  let relayed: string[] = [];

  /** Forgets the previous session's utterances; indices restart at 0. */
  const resetTranscript = (): void => {
    utterances = [];
    openUser = -1;
    unfinishedUser = -1;
    openAssistant = -1;
    relayed = [];
  };

  const relayUtterance = (index: number): void => {
    const { direction, text } = utterances[index]!;
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!active || !trimmed || relayed[index] === trimmed) {
      return;
    }

    relayed[index] = trimmed;
    report(
      app.sendMessage(GlicMessage.Transcript, {
        text: trimmed,
        direction,
        index
      })
    );
  };

  /** Opens a new utterance; its index. */
  const openUtterance = (direction: Direction): number => utterances.push({
    direction,
    text: ""
  }) - 1;

  /** The first string anywhere in a nested array, depth first. */
  const firstString = (value: unknown): string | null => {
    if (typeof value === "string") {
      return value;
    }

    if (!Array.isArray(value)) {
      return null;
    }

    for (const item of value) {
      const found = firstString(item);
      if (found !== null) {
        return found;
      }
    }
    return null;
  };

  /**
   * Input transcription, MSG[7]: the user's whole utterance so far, `[[text]]` while partial and
   * `[null, [text]]` once final. Cumulative, so it replaces; the final one closes the utterance.
   */
  const onInputTranscript = (field: unknown[]): void => {
    const text = firstString(field);
    if (text === null) {
      return;
    }

    const isFinal = field[0] === null;
    // A late final belongs to the utterance Gemini's reply closed, not to a new one.
    const index =
      openUser >= 0
        ? openUser
        : isFinal && unfinishedUser >= 0
          ? unfinishedUser
          : openUtterance(Direction.User);
    utterances[index]!.text = text;
    openUser = isFinal ? -1 : index;
    unfinishedUser = -1;
    relayUtterance(index);
  };

  /**
   * Output transcription, MSG[1][5] = [fragment, startTime, endTime, first]: one piece of what
   * Gemini is saying, `first` = 1 on a generation's opening fragment. Appended.
   */
  const onOutputTranscript = (field: unknown[]): void => {
    const [fragment, , , first] = field;
    if (typeof fragment !== "string") {
      return;
    }

    if (openAssistant < 0 || first === 1) {
      openAssistant = openUtterance(Direction.Assistant);
      // Gemini answering means the user's turn is over, even if its final transcript never came.
      unfinishedUser = openUser;
      openUser = -1;
    }

    utterances[openAssistant]!.text += fragment;
    relayUtterance(openAssistant);
  };

  /**
   * Routes one server message. MSG = [seq, serverContent, ...]; inside serverContent, [5] is the
   * output transcription, [2] generation complete and [3] interrupted (barge-in) - both of which
   * end Gemini's utterance. Audio ([0] config, [1] mp3) and acks are ignored.
   */
  const onServerMessage = (msg: unknown): void => {
    if (!Array.isArray(msg) || typeof msg[MsgField.Seq] !== "string") {
      return;
    }

    const input: unknown = msg[MsgField.InputTranscription];
    if (Array.isArray(input)) {
      wireSeen = true;
      onInputTranscript(input);
    }

    const content: unknown = msg[MsgField.ServerContent];
    if (!Array.isArray(content)) {
      return;
    }

    const output: unknown = content[ContentField.OutputTranscription];
    if (Array.isArray(output)) {
      wireSeen = true;
      onOutputTranscript(output);
    }

    if (content[ContentField.GenerationComplete] != null || content[ContentField.Interrupted] != null) {
      openAssistant = -1;
    }
  };

  /**
   * One WebChannel chunk: [[arrayId, payload], ...], where a content payload is
   * [[null, MSG], ...] and the rest are ["noop"], acks and status.
   */
  const onChannelChunk = (chunk: string): void => {
    let frames: unknown;
    try {
      frames = JSON.parse(chunk);
    } catch {
      return;
    }

    if (!Array.isArray(frames)) {
      return;
    }

    for (const frame of frames) {
      const payload: unknown = Array.isArray(frame) ? frame[1] : null;
      if (!Array.isArray(payload)) {
        continue;
      }

      for (const entry of payload) {
        if (Array.isArray(entry) && entry[0] === null) {
          onServerMessage(entry[1]);
        }
      }
    }
  };

  /**
   * Follows a downlink XHR as it streams. The body is "<length>\n<chunk>" repeated, length in
   * UTF-16 units, so each read parses only the chunks completed since the last one. Reading
   * responseText takes nothing from Glic, whose own handler sees the same text.
   */
  const tapDownlink = (xhr: XMLHttpRequest): void => {
    let offset = 0;
    const read = (): void => {
      let text: string;
      try {
        text = xhr.responseText;
      } catch {
        return; // a binary responseType: not a WebChannel downlink
      }
      while (true) {
        const newline = text.indexOf("\n", offset);
        if (newline < 0) {
          return;
        }

        const length = Number(text.slice(offset, newline));
        const end = newline + 1 + length;
        if (!Number.isInteger(length) || text.length < end) {
          return;
        }

        const chunk = text.slice(newline + 1, end);
        offset = end;
        try {
          onChannelChunk(chunk);
        } catch {
          // A frame we misread costs a caption, never Glic's own processing.
        }
      }
    };
    xhr.addEventListener("progress", read);
    xhr.addEventListener("readystatechange", read);
  };

  // Glic's WebChannel uses XMLHttpRequest (not fetch). Patch the prototype at document-start so
  // every channel XHR it creates is followed; only listeners are added, nothing is replaced.
  try {
    const xhrOpen = XMLHttpRequest.prototype.open;
    const xhrSend = XMLHttpRequest.prototype.send;
    const downlinks = new WeakSet<XMLHttpRequest>();
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      if (String(method).toUpperCase() === "GET" && String(url).includes(LIVE_CHANNEL_PATH)) {
        downlinks.add(this);
      } else {
        downlinks.delete(this);
      }

      return (xhrOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: [Document | XMLHttpRequestBodyInit | null | undefined]) {
      if (downlinks.has(this)) {
        tapDownlink(this);
      }

      return xhrSend.apply(this, args);
    };
  } catch {
    // Frozen XHR: the caption scrape below still runs.
  }

  // ===========================================================================
  // Captions -> transcript, the fallback when the wire tap sees nothing (a changed channel).
  // Glic renders "<b>You:</b> ... <b>Gemini:</b> ..." and revises the live utterance in place, so
  // relay each utterance's current full text keyed by index. Its labels are not trustworthy (see
  // above), which is why this only runs without the wire.
  // ===========================================================================

  const captionsRoot = (): Element | null => {
    const scroller = document.querySelector("captions-scroller");
    if (!scroller) {
      return null;
    }

    return (
      scroller.querySelector(".captions-scroller-container .captions-scroller") ||
      scroller.querySelector(".captions-scroller-container") ||
      scroller
    );
  };

  // Only a bold node that is exactly a speaker label starts an utterance. Gemini bolds words in its
  // own answers too ("**your** schedule"), and those are part of the sentence, not a new speaker.
  const SPEAKER_LABELS: Record<string, Direction> = {
    you: Direction.User,
    gemini: Direction.Assistant
  };

  /** The transcript direction a bold node stands for, or null for bold text. */
  const directionOf = (node: Node): Direction | null => {
    if (!(node instanceof Element) || node.tagName !== "B") {
      return null;
    }

    const label = (node.textContent || "").trim().replace(/:$/, "").toLowerCase();
    return SPEAKER_LABELS[label] ?? null;
  };

  const readUtterances = (root: Element): Utterance[] => {
    const found: Utterance[] = [];
    let current: Utterance | null = null;
    for (const node of root.childNodes) {
      const direction = directionOf(node);
      if (direction) {
        current = {
          direction,
          text: ""
        };
        found.push(current);
      } else if (current) {
        current.text += node.textContent || "";
      }
    }
    return found
      .map(u => ({
        direction: u.direction,
        text: u.text.replace(/\s+/g, " ").trim()
      }))
      .filter(u => u.text);
  };

  const pumpCaptions = (): void => {
    if (wireSeen) {
      return;
    }

    const root = captionsRoot();
    if (!root) {
      return;
    }

    readUtterances(root).forEach(({ direction, text }, index) => {
      if (relayed[index] === text) {
        return;
      }

      relayed[index] = text;
      report(
        app.sendMessage(GlicMessage.Transcript, {
          text,
          direction,
          index
        })
      );
    });
  };

  // ===========================================================================
  // Live timeouts. Glic disconnects Live on four client flags (BardChatUi's live_mode module reads
  // them when its first session starts): 30 s in "listening" with no speech, 7 s of a silent mic
  // (which a mute is), and a 1 h privacy cap. A session here ends only when the user ends it, so
  // rewrite those flags before Live first reads them. Flag objects keep their numeric key across
  // releases while their minified names change, so find them by key in the shared namespace.
  // ===========================================================================

  const DAY_S = 24 * 60 * 60;
  const DAY_MS = DAY_S * 1000;
  const LIVE_TIMEOUT_FLAGS: Record<string, number> = {
    45681081: DAY_S, // inactivity in "listening", seconds
    45681082: DAY_S, // same, while a tab is shared, seconds
    45687231: DAY_MS, // mic silence, ms
    45677155: DAY_MS // privacy cap, ms
  };
  let timeoutsPatched = false;

  /** Rewrites Glic's Live timeout flags; true once all were found. */
  const patchLiveTimeouts = (): boolean => {
    if (timeoutsPatched) {
      return true;
    }

    const namespace = window.default_BardChatUi;
    if (!namespace) {
      return false;
    }

    let found = 0;
    for (const flag of Object.values(namespace) as (ClientFlag | null)[]) {
      const value = flag && typeof flag === "object" && flag.key ? LIVE_TIMEOUT_FLAGS[flag.key] : undefined;
      if (value === undefined) {
        continue;
      }

      // The flag service returns defaultValue when the server sent no value, else ctor(raw).
      flag!.defaultValue = value;
      flag!.ctor = () => value;
      found++;
    }
    timeoutsPatched = found === Object.keys(LIVE_TIMEOUT_FLAGS).length;
    return timeoutsPatched;
  };

  // ===========================================================================
  // Live control: start, keep alive (auto-resume), stop.
  // ===========================================================================

  let lastResume = 0;
  let resumeTries = 0;
  /** When Live was last seen running. */
  let lastLive = 0;
  let lastTryAgain = 0;
  /** Live breaking was reported; the host reloads us, so say it once. */
  let brokenReported = false;
  let consentAccepted = false;
  let monitorTimer: ReturnType<typeof setInterval> | null = null;
  let startTimer: ReturnType<typeof setInterval> | undefined;

  const resume = (now: number): void => {
    if (now - lastResume < RESUME_GAP_MS * Math.min(resumeTries + 1, MAX_RESUME_BACKOFF)) {
      return;
    }

    resumeTries++;
    lastResume = now;
    clickButton(...RESUME_BUTTONS);
  };

  /** Matches on visible text too: Glic's Try again is not always labelled. */
  const tryAgainButton = (): HTMLButtonElement | undefined =>
    [...document.querySelectorAll("button")].find(b =>
      `${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""}`.includes(Button.TryAgain));

  /** Live is running: forget any pause or breakage. */
  const markLive = (now: number): void => {
    lastLive = now;
    resumeTries = 0;
    brokenReported = false;
    setState(State.Listening);
  };

  const monitorTick = (): void => {
    if (!active) {
      return;
    }

    const now = Date.now();
    if (now - lastNudge >= SCREEN_NUDGE_MS) {
      void readThenNudge(now);
    }

    pumpCaptions();
    // "Your audio couldn't be heard" is Glic's own transient notice while the mic is silent - which
    // it is whenever the user mutes or just isn't talking. Glic recovers on its own when sound
    // returns, so this is never fatal; ending the session here is what made muting un-undoable.
    const wentWrong = pageSays(Phrase.WentWrong);
    if (findButton(Button.PauseLive) && !wentWrong) {
      markLive(now);
      return;
    }

    setState(State.Resuming);

    if (!wentWrong && findButton(...RESUME_BUTTONS)) {
      resume(now);
      return;
    }

    const retry = tryAgainButton();
    if (retry && now - lastTryAgain > TRY_AGAIN_GAP_MS) {
      lastTryAgain = now;
      retry.click();
    }

    if (wentWrong && now - lastLive > BROKEN_AFTER_MS && !brokenReported) {
      brokenReported = true;
      reportError(ErrorMessage.LiveBroke);
    }
  };

  const beginMonitor = (): void => {
    if (monitorTimer) {
      return;
    }

    monitorTimer = setInterval(monitorTick, MONITOR_POLL_MS);
  };

  // First-run surfaces: consent ("Live will use your microphone") and the volume onboarding card.
  // Pressing Win+C for Gemini Live is the user's decision to start it, so clear them.
  const advanceToLive = (): void => {
    const ok = findButton(Button.Ok);
    if (ok && findButton(Button.NoThanks) && pageSays(Phrase.MicConsent)) {
      ok.click();
      consentAccepted = true;
      return;
    }

    const skip = findButton(Button.Skip);
    if (skip && findButton(Button.GoBack) && findButton(Button.TurnOnCaptions)) {
      skip.click();
      return;
    }

    if (clickButton(Button.StartLive) || consentAccepted) {
      return;
    }

    clickButton(Button.GoLive);
  };

  const start = (): void => {
    active = true;
    resetTranscript();
    lastState = null;
    consentAccepted = false;
    resumeTries = 0;
    clearInterval(startTimer);
    let tries = 0;
    startTimer = setInterval(() => {
      // No usable session: stop quietly. The host waits for the browser's session and reloads us.
      if (!active || unavailableReported) {
        clearInterval(startTimer);
        return;
      }

      tryBootstrap();

      // Live must not start before its timeouts are rewritten, or it reads the defaults.
      if (!patchLiveTimeouts() && tries < MAX_START_TRIES / 2) {
        tries++;
        return;
      }

      if (findButton(Button.PauseLive)) {
        clearInterval(startTimer);
        report(app.sendMessage(GlicMessage.Ready));
        markLive(Date.now());
        beginMonitor();
        return;
      }

      advanceToLive();

      if (++tries <= MAX_START_TRIES) {
        return;
      }

      clearInterval(startTimer);
      reportStartFailure(ErrorMessage.LiveDidNotStart);
    }, START_POLL_MS);
  };

  const stop = (): void => {
    active = false;
    clearInterval(startTimer);
    clickButton(Button.TextMode, Button.PauseLive, Button.End);
    setState(State.Idle);
  };

  // ===========================================================================
  // Google apps via a text turn. Live can't reach Calendar, Keep, Tasks, Gmail or Home - those
  // tools are server-gated to the text path - so an action pauses Live, runs the request as a text
  // turn in the SAME conversation (where the account's apps are on), auto-confirms the result card,
  // then C# resumes Live, which keeps the answer in context. C# types the request with trusted CDP
  // key events, because synthetic input never enables Submit.
  // ===========================================================================

  const ACTION_READY_MS = 6000;
  const ACTION_REPLY_MS = 30000;
  const ACTION_SETTLE_MS = 1400;
  // The primary button on the confirmation card an app shows for a write; the user asked by voice,
  // so auto-confirm it. clickButton matches on aria-label, and the modern shared card (verified
  // live for Keep and Tasks) gives its primary button the generic aria-label
  // "Button that confirms actions." while only its VISIBLE text varies ("Add"), so that aria-label
  // is what we match. Its cancel button reads "Button that cancels actions.", which this never
  // matches. The rest are legacy/alternate cards whose aria-label is the visible verb; each is
  // specific enough not to hit an always-present composer button. A bare "Add" is deliberately
  // absent: it matched "Add tabs. Press Enter to activate" and auto-clicked it on every turn.
  const ACTION_CONFIRM = [
    Button.ConfirmsActions,
    Button.AddEvent,
    Button.AddEventTitleCase,
    Button.Create,
    Button.Save,
    Button.Remove,
    Button.Delete,
    Button.Update,
    Button.Confirm
  ];
  const SUBMIT = [Button.Submit, Button.SendMessage, Button.Send];
  /** Glic shows these under an answer only once it has finished. */
  const REPLY_DONE = [Button.Copy, Button.GoodResponse, Button.Regenerate];

  const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

  const waitFor = async <T>(predicate: () => T | null, timeoutMs: number): Promise<T | null> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = predicate();
      if (value) {
        return value;
      }

      await sleep(150);
    }
    return null;
  };

  const editor = (): HTMLElement | null => document.querySelector<HTMLElement>("[contenteditable=\"true\"]");

  /**
   * The newest model answer. Prefer the whole response container
   * (<code>.presented-response-container</code>): the app result cards - a Keep note, a Tasks list,
   * a Gmail summary - render as embedded siblings of the inner markdown, so reading only the markdown
   * node caught just the "Here are your Google Keep notes:" preamble and dropped the notes
   * themselves. Fall back to the inner nodes if that class ever changes, and strip the "Gemini said"
   * accessibility prefix the container carries.
   */
  const lastReplyText = (): string => {
    const containers = document.querySelectorAll<HTMLElement>(".presented-response-container");
    let last = containers[containers.length - 1];
    if (!last) {
      const nodes = document.querySelectorAll<HTMLElement>(
        "message-content, .model-response-text, .markdown, [data-response-index]"
      );
      last = nodes[nodes.length - 1];
    }

    return (last ? last.innerText : "").replace(/\s+/g, " ").replace(/^Gemini said\s*/i, "").trim();
  };

  /** Switch to text mode and hand C# a focused, empty editor. */
  const beginAction = async (): Promise<boolean> => {
    active = false;
    clearInterval(startTimer);

    if (monitorTimer) {
      clearInterval(monitorTimer);
    }

    monitorTimer = null;
    clickButton(Button.TextMode);
    const box = await waitFor(editor, ACTION_READY_MS);
    if (!box) {
      return false;
    }

    box.focus();
    document.execCommand("selectAll");
    document.execCommand("delete");
    return true;
  };

  /**
   * After C# has typed the request: submit it, wait for the answer to stop growing, auto-confirm a
   * card, and return the answer text.
   */
  const submitAndRead = async (): Promise<string> => {
    clickButton(...SUBMIT);
    let text = "";
    let stableSince = 0;
    const deadline = Date.now() + ACTION_REPLY_MS;
    while (Date.now() < deadline) {
      const now = lastReplyText();
      const done = findButton(...REPLY_DONE);
      if (now && now === text && done) {
        stableSince = stableSince || Date.now();

        if (Date.now() - stableSince > ACTION_SETTLE_MS) {
          break;
        }
      } else {
        stableSince = 0;
        text = now;
      }

      await sleep(200);
    }

    // Out of time with the reply still running (a tool call that never returns): stop it. While a
    // reply runs Glic hides its Live button, so Live could never resume.
    if (clickButton(Button.StopResponse)) {
      await sleep(ACTION_SETTLE_MS);
    }

    if (clickButton(...ACTION_CONFIRM)) {
      await sleep(ACTION_SETTLE_MS);
      text = lastReplyText() || text;
    }

    return text;
  };

  // ===========================================================================
  // Commands from GlicHost.
  // ===========================================================================

  app.onMessage(GlicMessage.Start, () => start());
  app.onMessage(GlicMessage.Stop, () => stop());
  app.onMessage(GlicMessage.SetMuted, ({ data }) => setMuted(data));
  app.onMessage(GlicMessage.ListMics, () => listMics());
  app.onMessage(GlicMessage.SetMic, ({ data }) => setMic(data));
  app.onMessage(GlicMessage.BeginAction, () => beginAction());
  app.onMessage(GlicMessage.SubmitAndRead, () => submitAndRead());
}

export {};
