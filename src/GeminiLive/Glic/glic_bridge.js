// Injected at document-start into gemini.google.com/glic inside our WebView2.
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
// Wire to C#: chrome.webview.postMessage({kind, ...}) up; {kind:"frame", id, ...} replies down.
(() => {
  if (window.__glicBridge || window.top !== window) {
    return;
  }

  // ===========================================================================
  // Vocabulary: every string we match on Glic's page or exchange with C#, in one place.
  // ===========================================================================

  /** Message kinds on the WebView2 channel (GlicHost.OnMessage switches on these). */
  const Kind = {
    BOOTED: 'booted',
    CAPTURE: 'capture',
    ERROR: 'error',
    FRAME: 'frame',
    READY: 'ready',
    STATE: 'state',
    TRANSCRIPT: 'transcript',
  };

  /** Live states reported to C#. */
  const State = {
    IDLE: 'idle',
    LISTENING: 'listening',
    RESUMING: 'resuming',
  };

  /**
   * Error messages. SIGNED_OUT and UNAVAILABLE are codes GlicHost matches on to wait for a fresh
   * session; the rest are shown to the user.
   */
  const ErrorMessage = {
    SIGNED_OUT: 'signed-out',
    UNAVAILABLE: 'unavailable',
    PAGE_DID_NOT_START: 'Gemini page did not start',
    LIVE_DID_NOT_START: 'Gemini Live did not start (sign-in or rate limit)',
    LIVE_WONT_RESUME: 'Gemini Live paused and won\'t resume',
  };

  /** Fragments of Glic's button aria-labels. */
  const Button = {
    END: 'End',
    GO_BACK: 'Go back',
    GO_LIVE: 'Go Live',
    NO_THANKS: 'No thanks',
    OK: 'OK',
    PAUSE_LIVE: 'Pause live mode',
    SKIP: 'Skip',
    START_LIVE: 'Start live mode',
    TEXT_MODE: 'Switch to text mode',
    TURN_ON_CAPTIONS: 'Turn on live captions',
  };

  /** Phrases in Glic's visible text. */
  const Phrase = {
    MIC_CONSENT: 'Live will use your microphone',
    UNAVAILABLE: 'isn\'t available right now',
  };
  const SIGN_IN_PATTERN = /\bSign in\b/;

  // "default" and "communications" are aliases Chromium adds for Windows' default devices.
  const MIC_ALIAS_IDS = new Set(['default', 'communications']);

  const PANEL_STATE = {kind: 2, windowId: 'desktop'};
  const BOOT_POLL_MS = 100;
  const MAX_BOOT_TRIES = 150;
  const UNAVAILABLE_POLL_MS = 500;
  const START_POLL_MS = 300;
  const MAX_START_TRIES = 100;
  const MONITOR_POLL_MS = 300;
  const FRAME_TIMEOUT_MS = 3000;
  // Glic pauses Live by itself (idle timeouts, a turn it treats as finished). Only the user ends a
  // session here - Win+C or X - so unpause straight away, backing off if Live won't come back.
  const RESUME_GAP_MS = 2000;
  const MAX_RESUME_TRIES = 5;

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
  let lastState = null;

  // ===========================================================================
  // Channel to C# and page helpers.
  // ===========================================================================

  const native = window.chrome && window.chrome.webview;

  /**
   * Posts {kind, ...extra} to C#.
   * @param {string} kind
   * @param {!Object=} extra
   */
  const emit = (kind, extra) => {
    if (!native) {
      return;
    }
    try {
      native.postMessage({kind, ...extra});
    } catch {
      // The host is gone; nobody is listening.
    }
  };

  /** @param {string} message */
  const reportError = (message) => emit(Kind.ERROR, {message});

  /** Reports a failed start, preferring "signed-out" so the host can wait for a session. */
  const reportStartFailure = (fallback) =>
      reportError(isSignedOut() ? ErrorMessage.SIGNED_OUT : fallback);

  /** @param {string} state */
  const setState = (state) => {
    if (lastState === state) {
      return;
    }
    lastState = state;
    emit(Kind.STATE, {state});
  };

  const pageText = () => (document.body && document.body.innerText) || '';

  /** @param {string} phrase */
  const pageSays = (phrase) => pageText().includes(phrase);

  /**
   * Finds the first button whose aria-label contains one of the fragments, trying them in order.
   * @param {...string} fragments
   * @return {?HTMLButtonElement}
   */
  const findButton = (...fragments) => {
    const buttons = [...document.querySelectorAll('button')];
    for (const fragment of fragments) {
      const match =
          buttons.find((b) => (b.getAttribute('aria-label') || '').includes(fragment));
      if (match) {
        return match;
      }
    }
    return null;
  };

  /**
   * Clicks the first button {@link findButton} finds.
   * @param {...string} fragments
   * @return {boolean} Whether a button was clicked.
   */
  const clickButton = (...fragments) => {
    const button = findButton(...fragments);
    if (!button) {
      return false;
    }
    button.click();
    return true;
  };

  const isSignedOut = () => location.hostname === 'accounts.google.com' ||
      (SIGN_IN_PATTERN.test(pageText()) && !findButton(Button.GO_LIVE));

  // ===========================================================================
  // Hidden WebView: never let Glic see itself as hidden, or it pauses Live.
  // ===========================================================================

  try {
    Object.defineProperty(
        document, 'visibilityState', {configurable: true, get: () => 'visible'});
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => false});
    document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
  } catch {
    // Best effort: a page that froze these keeps its own visibility.
  }

  // ===========================================================================
  // Mic: keep AEC, add auto-gain + voice isolation so barge-in works over desktop speakers.
  // Also keep the tracks so the pill's mute button can silence them.
  // ===========================================================================

  const micTracks = new Set();
  let muted = false;
  /** The microphone picked in the app's menu (null = Windows' default), applied to every capture. */
  let micId = null;

  /**
   * Rewrites Glic's getUserMedia constraints: audio gets our processing and mic pick, video never
   * goes through.
   * @param {!MediaStreamConstraints|undefined} constraints
   * @return {!MediaStreamConstraints|undefined}
   */
  const withDesktopConstraints = (constraints) => {
    if (!constraints) {
      return constraints;
    }
    // Glic's camera-share mode asks for video, which pops a Windows camera prompt. We only share
    // the screen (frames from C#), so the camera is never opened.
    const {video, ...rest} = constraints;
    if (video && !rest.audio) {
      throw new DOMException('Camera is not shared on desktop', 'NotAllowedError');
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
        voiceIsolation: true,
        // ideal, not exact: an unplugged pick falls back to the default instead of failing Live.
        ...(micId ? {deviceId: {ideal: micId}} : {}),
      },
    };
  };

  try {
    const media = navigator.mediaDevices;
    const getUserMedia = media.getUserMedia.bind(media);
    media.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(withDesktopConstraints(constraints));
      for (const track of stream.getAudioTracks()) {
        track.enabled = !muted;
        micTracks.add(track);
      }
      return stream;
    };
  } catch {
    // Frozen mediaDevices: Glic captures with its own constraints.
  }

  /** @param {boolean} value */
  const setMuted = (value) => {
    muted = value;
    for (const track of micTracks) {
      if (track.readyState === 'live') {
        track.enabled = !value;
      } else {
        micTracks.delete(track);
      }
    }
  };

  /**
   * Real microphones only, without Chromium's default-device aliases.
   * @return {!Promise<!Array<{id: string, label: string}>>}
   */
  const listMics = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
        .filter((d) => d.kind === 'audioinput' && d.deviceId && !MIC_ALIAS_IDS.has(d.deviceId))
        .map((d) => ({id: d.deviceId, label: d.label || 'Microphone'}));
  };

  /**
   * A running session holds its stream, so a new pick restarts Live to reopen the mic.
   * @param {?string} id
   */
  const setMic = (id) => {
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

  // ===========================================================================
  // Screen frames from C#: request/response over the WebView2 message channel.
  // ===========================================================================

  let nextFrameId = 1;
  const pendingFrames = new Map();

  const decodeFrame = (message) => {
    if (!message.base64) {
      return null;
    }
    const bytes = Uint8Array.from(atob(message.base64), (c) => c.charCodeAt(0));
    return {
      data: bytes.buffer,
      mimeType: message.mimeType,
      widthPixels: message.width,
      heightPixels: message.height,
    };
  };

  if (native) {
    native.addEventListener('message', (e) => {
      const message = e.data;
      if (!message || message.kind !== Kind.FRAME) {
        return;
      }
      const resolve = pendingFrames.get(message.id);
      if (!resolve) {
        return;
      }
      pendingFrames.delete(message.id);
      resolve(decodeFrame(message));
    });
  }

  const captureFrame = () => {
    if (!active) {
      return Promise.resolve(null);
    }
    const id = nextFrameId++;
    return new Promise((resolve) => {
      pendingFrames.set(id, resolve);
      emit(Kind.CAPTURE, {id});
      setTimeout(() => {
        if (pendingFrames.delete(id)) {
          resolve(null);
        }
      }, FRAME_TIMEOUT_MS);
    });
  };

  // ===========================================================================
  // The GlicBrowserHost we hand the web client (ported from Chrome's own dev host).
  // ===========================================================================

  /** Calls a subscriber, isolating us from its errors. */
  const notify = (subscriber, value) => {
    try {
      subscriber(value);
    } catch {
      // A subscriber's error is its own.
    }
  };

  /** An observable that never changes. */
  const observable = (value) => ({
    subscribe(change) {
      notify(change, value);
      return {unsubscribe() {}};
    },
  });

  const settableObservable = (initial) => {
    let value = initial;
    const subscribers = [];
    return {
      get: () => value,
      set(next) {
        value = next;
        for (const subscriber of subscribers) {
          notify(subscriber, next);
        }
      },
      subscribe(change) {
        subscribers.push(change);
        notify(change, value);
        return {
          unsubscribe() {
            const i = subscribers.indexOf(change);
            if (i >= 0) {
              subscribers.splice(i, 1);
            }
          },
        };
      },
    };
  };

  // Captions on: Glic's caption overlay is the only page-visible source of the spoken text.
  const captionSetting = settableObservable(true);
  const FOCUSED_TAB = {
    tabId: 'desktop',
    url: 'https://localhost/desktop',
    title: 'Desktop',
    faviconUrl: '',
    documentMimeType: 'text/html',
    isMediaActive: false,
  };
  const resolved = (value) => () => Promise.resolve(value);

  const host = {
    getChromeVersion: resolved({major: 130, minor: 0, build: 0, patch: 0}),
    getPlatform: () => 3,
    getFormFactor: () => 1,
    getHostCapabilities: () => new Set([3, 7, 8]),
    getUserProfileInfo: resolved({
      displayName: 'You',
      email: '',
      givenName: 'You',
      localProfileName: 'You',
      isManaged: false,
      avatarIcon: resolved(undefined),
    }),
    getPanelState: () => observable(PANEL_STATE),
    panelActive: () => observable(true),
    getFocusedTabStateV2: () => observable({hasFocus: {tabData: FOCUSED_TAB}}),
    getContextFromFocusedTab: resolved({tabData: FOCUSED_TAB}),
    captureScreenshot: () => captureFrame(),
    // Live's continuous viewport: Glic pulls a screenshot per frame through here.
    async getContextFromTab(_tabId, options) {
      const context = {tabData: FOCUSED_TAB};
      if (!options || !options.viewportScreenshot) {
        return context;
      }
      const shot = await captureFrame();
      if (shot) {
        context.viewportScreenshot = shot;
        context.screenshotInfo = {widthPixels: shot.widthPixels, heightPixels: shot.heightPixels};
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
    getOsHotkeyState: () => observable({hotkey: ''}),
    resizeWindow: resolved(undefined),
    setTabContextPermissionState: resolved(undefined),
    setMicrophonePermissionState: resolved(undefined),
    setLocationPermissionState: resolved(undefined),
    setClosedCaptioningSetting: resolved(undefined),  // keep captions on: they are our text tap
    attachPanel: resolved(undefined),
    detachPanel: resolved(undefined),
    closePanel() {
      setState(State.IDLE);
      return Promise.resolve();
    },
  };

  // ===========================================================================
  // Bootstrap: pre-define internalAutoGlicBoot, then replay Glic's own message listener with a
  // synthetic chrome://glic event (it needs a non-null source).
  // ===========================================================================

  const registry = {
    registerWebClient(webClient) {
      return Promise.resolve()
          .then(() => webClient.initialize(host))
          .then(() => {
            booted = true;
            emit(Kind.BOOTED);
            setTimeout(() => {
              if (webClient.notifyPanelWillOpen) {
                notify((state) => webClient.notifyPanelWillOpen(state), PANEL_STATE);
              }
            }, 0);
          });
    },
  };
  window.internalAutoGlicBoot = () => registry;

  const bootstrapHandlers = [];
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  Object.defineProperty(window, 'addEventListener', {
    configurable: true,
    writable: true,
    value(type, listener, options) {
      if (type === 'message' && typeof listener === 'function') {
        bootstrapHandlers.push(listener);
      }
      originalAddEventListener.call(window, type, listener, options);
    },
  });
  const bootstrapEvent = new MessageEvent('message', {
    origin: 'chrome://glic',
    source: window,
    data: {type: 'glic-bootstrap', glicApiSource: 'data:text/javascript,//desktop'},
  });

  const tryBootstrap = () => {
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
      reportStartFailure(ErrorMessage.PAGE_DID_NOT_START);
    }
  }, BOOT_POLL_MS);

  // A stale Google session still loads /glic and even adopts our host, but then shows "Gemini isn't
  // available right now" (its cookie rotation 401s). Report it so the host can offer a fresh sign-in.
  const unavailableTimer = setInterval(() => {
    if (!pageSays(Phrase.UNAVAILABLE)) {
      return;
    }
    clearInterval(unavailableTimer);
    unavailableReported = true;
    reportError(ErrorMessage.UNAVAILABLE);
  }, UNAVAILABLE_POLL_MS);

  // ===========================================================================
  // Transcript from the Live wire. Glic's caption overlay labels some of Gemini's own speech
  // "You:" (the "Let me check on that" filler before a tool call, sometimes whole answers), but the
  // Live channel itself never confuses the two: the user's words arrive as the server's input
  // transcription and Gemini's as its output transcription. So read them off the wire. Frame
  // layout: docs/live-transcript-wire.md.
  // ===========================================================================

  /** The Live channel; its long-poll GETs are the downlink (POSTs carry the mic up). */
  const LIVE_CHANNEL_PATH = '/v1/processSession';

  /**
   * Utterances in the order the wire opened them; the array index is the transcript index.
   * @type {!Array<{direction: string, text: string}>}
   */
  let utterances = [];
  /** Index of the user utterance still being transcribed, or -1. */
  let openUser = -1;
  /** A user utterance Gemini's reply closed before its final transcript arrived, or -1. */
  let unfinishedUser = -1;
  /** Index of the Gemini utterance still being spoken, or -1. */
  let openAssistant = -1;
  /** The wire carried a transcript, so the caption scrape is not needed. */
  let wireSeen = false;
  /** Last text relayed per index, to send only changes. */
  let relayed = [];

  /** Forgets the previous session's utterances; indices restart at 0. */
  const resetTranscript = () => {
    utterances = [];
    openUser = -1;
    unfinishedUser = -1;
    openAssistant = -1;
    relayed = [];
  };

  /** @param {number} index */
  const relayUtterance = (index) => {
    const {direction, text} = utterances[index];
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (!active || !trimmed || relayed[index] === trimmed) {
      return;
    }
    relayed[index] = trimmed;
    emit(Kind.TRANSCRIPT, {text: trimmed, direction, index});
  };

  /** @return {number} The index of a new utterance. */
  const openUtterance = (direction) => utterances.push({direction, text: ''}) - 1;

  /** @return {?string} The first string anywhere in a nested array, depth first. */
  const firstString = (value) => {
    if (typeof value === 'string') {
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
  const onInputTranscript = (field) => {
    const text = firstString(field);
    if (text === null) {
      return;
    }
    const isFinal = field[0] === null;
    // A late final belongs to the utterance Gemini's reply closed, not to a new one.
    const index = openUser >= 0 ? openUser :
        isFinal && unfinishedUser >= 0 ? unfinishedUser : openUtterance('user');
    utterances[index].text = text;
    openUser = isFinal ? -1 : index;
    unfinishedUser = -1;
    relayUtterance(index);
  };

  /**
   * Output transcription, MSG[1][5] = [fragment, startTime, endTime, first]: one piece of what
   * Gemini is saying, `first` = 1 on a generation's opening fragment. Appended.
   */
  const onOutputTranscript = (field) => {
    const [fragment, , , first] = field;
    if (typeof fragment !== 'string') {
      return;
    }
    if (openAssistant < 0 || first === 1) {
      openAssistant = openUtterance('assistant');
      // Gemini answering means the user's turn is over, even if its final transcript never came.
      unfinishedUser = openUser;
      openUser = -1;
    }
    utterances[openAssistant].text += fragment;
    relayUtterance(openAssistant);
  };

  /**
   * Routes one server message. MSG = [seq, serverContent, ...]; inside serverContent, [5] is the
   * output transcription, [2] generation complete and [3] interrupted (barge-in) - both of which
   * end Gemini's utterance. Audio ([0] config, [1] mp3) and acks are ignored.
   */
  const onServerMessage = (msg) => {
    if (!Array.isArray(msg) || typeof msg[0] !== 'string') {
      return;
    }
    if (Array.isArray(msg[7])) {
      wireSeen = true;
      onInputTranscript(msg[7]);
    }
    const content = msg[1];
    if (!Array.isArray(content)) {
      return;
    }
    if (Array.isArray(content[5])) {
      wireSeen = true;
      onOutputTranscript(content[5]);
    }
    if (content[2] != null || content[3] != null) {
      openAssistant = -1;
    }
  };

  /**
   * One WebChannel chunk: [[arrayId, payload], ...], where a content payload is
   * [[null, MSG], ...] and the rest are ["noop"], acks and status.
   */
  const onChannelChunk = (chunk) => {
    let frames;
    try {
      frames = JSON.parse(chunk);
    } catch {
      return;
    }
    if (!Array.isArray(frames)) {
      return;
    }
    for (const frame of frames) {
      const payload = Array.isArray(frame) ? frame[1] : null;
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
   * @param {!XMLHttpRequest} xhr
   */
  const tapDownlink = (xhr) => {
    let offset = 0;
    const read = () => {
      let text;
      try {
        text = xhr.responseText;
      } catch {
        return;  // a binary responseType: not a WebChannel downlink
      }
      while (true) {
        const newline = text.indexOf('\n', offset);
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
    xhr.addEventListener('progress', read);
    xhr.addEventListener('readystatechange', read);
  };

  // Glic's WebChannel uses XMLHttpRequest (not fetch). Patch the prototype at document-start so
  // every channel XHR it creates is followed; only listeners are added, nothing is replaced.
  try {
    const xhrOpen = XMLHttpRequest.prototype.open;
    const xhrSend = XMLHttpRequest.prototype.send;
    const downlinks = new WeakSet();
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      if (String(method).toUpperCase() === 'GET' && String(url).includes(LIVE_CHANNEL_PATH)) {
        downlinks.add(this);
      } else {
        downlinks.delete(this);
      }
      return xhrOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function(...args) {
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

  const captionsRoot = () => {
    const scroller = document.querySelector('captions-scroller');
    if (!scroller) {
      return null;
    }
    return scroller.querySelector('.captions-scroller-container .captions-scroller') ||
        scroller.querySelector('.captions-scroller-container') || scroller;
  };

  // Only a bold node that is exactly a speaker label starts an utterance. Gemini bolds words in its
  // own answers too ("**your** schedule"), and those are part of the sentence, not a new speaker.
  const SPEAKER_LABELS = {you: 'user', gemini: 'assistant'};

  /** @return {?string} The transcript direction a bold node stands for, or null for bold text. */
  const directionOf = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE || node.tagName !== 'B') {
      return null;
    }
    const label = (node.textContent || '').trim().replace(/:$/, '').toLowerCase();
    return SPEAKER_LABELS[label] ?? null;
  };

  /** @return {!Array<{direction: string, text: string}>} */
  const readUtterances = (root) => {
    const utterances = [];
    let current = null;
    for (const node of root.childNodes) {
      const direction = directionOf(node);
      if (direction) {
        current = {direction, text: ''};
        utterances.push(current);
      } else if (current) {
        current.text += node.textContent || '';
      }
    }
    return utterances
        .map((u) => ({direction: u.direction, text: u.text.replace(/\s+/g, ' ').trim()}))
        .filter((u) => u.direction && u.text);
  };

  const pumpCaptions = () => {
    if (wireSeen) {
      return;
    }
    const root = captionsRoot();
    if (!root) {
      return;
    }
    readUtterances(root).forEach(({direction, text}, index) => {
      if (relayed[index] === text) {
        return;
      }
      relayed[index] = text;
      emit(Kind.TRANSCRIPT, {text, direction, index});
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
  const LIVE_TIMEOUT_FLAGS = {
    '45681081': DAY_S,   // inactivity in "listening", seconds
    '45681082': DAY_S,   // same, while a tab is shared, seconds
    '45687231': DAY_MS,  // mic silence, ms
    '45677155': DAY_MS,  // privacy cap, ms
  };
  let timeoutsPatched = false;

  /** Rewrites Glic's Live timeout flags; true once all were found. */
  const patchLiveTimeouts = () => {
    if (timeoutsPatched) {
      return true;
    }
    const namespace = window.default_BardChatUi;
    if (!namespace) {
      return false;
    }
    let found = 0;
    for (const flag of Object.values(namespace)) {
      const value = flag && typeof flag === 'object' ? LIVE_TIMEOUT_FLAGS[flag.key] : undefined;
      if (value === undefined) {
        continue;
      }
      // The flag service returns defaultValue when the server sent no value, else ctor(raw).
      flag.defaultValue = value;
      flag.ctor = () => value;
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
  let consentAccepted = false;
  let monitorTimer = null;
  let startTimer = null;

  const resume = () => {
    const now = Date.now();
    if (now - lastResume < RESUME_GAP_MS * (resumeTries + 1)) {
      return;
    }
    if (++resumeTries > MAX_RESUME_TRIES) {
      if (resumeTries === MAX_RESUME_TRIES + 1) {
        reportError(ErrorMessage.LIVE_WONT_RESUME);
      }
      return;
    }
    lastResume = now;
    clickButton(Button.START_LIVE, Button.GO_LIVE);
  };

  const monitorTick = () => {
    if (!active) {
      return;
    }
    // "Your audio couldn't be heard" is Glic's own transient notice while the mic is silent - which
    // it is whenever the user mutes or just isn't talking. Glic recovers on its own when sound
    // returns, so this is never fatal; ending the session here is what made muting un-undoable.
    if (findButton(Button.PAUSE_LIVE)) {
      resumeTries = 0;
      setState(State.LISTENING);
    } else if (findButton(Button.START_LIVE, Button.GO_LIVE)) {
      setState(State.RESUMING);
      resume();
    }
    pumpCaptions();
  };

  const beginMonitor = () => {
    if (monitorTimer) {
      return;
    }
    monitorTimer = setInterval(monitorTick, MONITOR_POLL_MS);
  };

  // First-run surfaces: consent ("Live will use your microphone") and the volume onboarding card.
  // Pressing Win+C for Gemini Live is the user's decision to start it, so clear them.
  const advanceToLive = () => {
    const ok = findButton(Button.OK);
    if (ok && findButton(Button.NO_THANKS) && pageSays(Phrase.MIC_CONSENT)) {
      ok.click();
      consentAccepted = true;
      return;
    }
    const skip = findButton(Button.SKIP);
    if (skip && findButton(Button.GO_BACK) && findButton(Button.TURN_ON_CAPTIONS)) {
      skip.click();
      return;
    }
    if (clickButton(Button.START_LIVE) || consentAccepted) {
      return;
    }
    clickButton(Button.GO_LIVE);
  };

  const start = () => {
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
      if (findButton(Button.PAUSE_LIVE)) {
        clearInterval(startTimer);
        emit(Kind.READY);
        setState(State.LISTENING);
        beginMonitor();
        return;
      }
      advanceToLive();
      if (++tries <= MAX_START_TRIES) {
        return;
      }
      clearInterval(startTimer);
      reportStartFailure(ErrorMessage.LIVE_DID_NOT_START);
    }, START_POLL_MS);
  };

  const stop = () => {
    active = false;
    clearInterval(startTimer);
    clickButton(Button.TEXT_MODE, Button.PAUSE_LIVE, Button.END);
    setState(State.IDLE);
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
    'Button that confirms actions',
    'Add event', 'Add Event', 'Create', 'Save', 'Remove', 'Delete', 'Update', 'Confirm',
  ];
  const SUBMIT = ['Submit', 'Send message', 'Send'];

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const waitFor = async (predicate, timeoutMs) => {
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

  const editor = () => document.querySelector('[contenteditable="true"]');

  /**
   * The newest model answer. Prefer the whole response container
   * (<code>.presented-response-container</code>): the app result cards - a Keep note, a Tasks list,
   * a Gmail summary - render as embedded siblings of the inner markdown, so reading only the markdown
   * node caught just the "Here are your Google Keep notes:" preamble and dropped the notes
   * themselves. Fall back to the inner nodes if that class ever changes, and strip the "Gemini said"
   * accessibility prefix the container carries.
   */
  const lastReplyText = () => {
    const containers = document.querySelectorAll('.presented-response-container');
    let last = containers[containers.length - 1];
    if (!last) {
      const nodes = document.querySelectorAll(
          'message-content, .model-response-text, .markdown, [data-response-index]');
      last = nodes[nodes.length - 1];
    }
    return (last ? last.innerText : '')
        .replace(/\s+/g, ' ').replace(/^Gemini said\s*/i, '').trim();
  };

  /** Switch to text mode and hand C# a focused, empty editor. @return {!Promise<boolean>} */
  const beginAction = async () => {
    active = false;
    clearInterval(startTimer);
    clearInterval(monitorTimer);
    monitorTimer = null;
    clickButton(Button.TEXT_MODE);
    const box = await waitFor(editor, ACTION_READY_MS);
    if (!box) {
      return false;
    }
    box.focus();
    document.execCommand('selectAll');
    document.execCommand('delete');
    return true;
  };

  /**
   * After C# has typed the request: submit it, wait for the answer to stop growing, auto-confirm a
   * card, and return the answer text. @return {!Promise<string>}
   */
  const submitAndRead = async () => {
    clickButton(...SUBMIT);
    let text = '';
    let stableSince = 0;
    const deadline = Date.now() + ACTION_REPLY_MS;
    while (Date.now() < deadline) {
      const now = lastReplyText();
      const done = findButton('Copy', 'Good response', 'Regenerate');
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
    if (clickButton(...ACTION_CONFIRM)) {
      await sleep(ACTION_SETTLE_MS);
      text = lastReplyText() || text;
    }
    return text;
  };

  // Only what GlicHost calls.
  window.__glicBridge = {start, stop, setMuted, listMics, setMic, beginAction, submitAndRead};
})();
