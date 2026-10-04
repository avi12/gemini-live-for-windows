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
(function () {
  if (window.__glicBridge || window.top !== window) return;

  const native = window.chrome && window.chrome.webview;
  const send = payload => { try { native && native.postMessage(payload); } catch { /* host gone */ } };
  const emit = (kind, extra) => send({ kind, ...extra });

  // Hidden WebView: never let Glic see itself as hidden, or it pauses Live.
  try {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.addEventListener("visibilitychange", e => e.stopImmediatePropagation(), true);
  } catch { /* best effort */ }

  // --- Mic: keep AEC, add auto-gain + voice isolation so barge-in works over desktop speakers.
  // Also keep the tracks so the pill's mute button can silence them.
  const micTracks = new Set();
  let muted = false;
  try {
    const media = navigator.mediaDevices;
    const original = media.getUserMedia.bind(media);
    media.getUserMedia = async constraints => {
      if (constraints && constraints.audio) {
        const requested = constraints.audio === true ? {} : constraints.audio;
        constraints = {
          ...constraints,
          audio: { ...requested, echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceIsolation: true },
        };
      }
      const stream = await original(constraints);
      for (const t of stream.getAudioTracks()) { t.enabled = !muted; micTracks.add(t); }
      return stream;
    };
  } catch { /* frozen mediaDevices */ }

  // --- Screen frames from C#: request/response over the WebView2 message channel.
  let nextId = 1;
  const pending = new Map();
  native && native.addEventListener("message", e => {
    const m = e.data;
    if (m && m.kind === "frame" && pending.has(m.id)) {
      const resolve = pending.get(m.id);
      pending.delete(m.id);
      if (!m.base64) return resolve(null);
      const bin = atob(m.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      resolve({ data: bytes.buffer, mimeType: m.mimeType, widthPixels: m.width, heightPixels: m.height });
    }
  });
  function captureFrame() {
    if (!sharing) return Promise.resolve(null);
    const id = nextId++;
    return new Promise(resolve => {
      pending.set(id, resolve);
      send({ kind: "capture", id });
      setTimeout(() => { if (pending.delete(id)) resolve(null); }, 3000);
    });
  }

  // --- The GlicBrowserHost we hand the web client (ported from Chrome's own dev host).
  function obs(value) {
    return { subscribe(change) { try { change(value); } catch { } return { unsubscribe() { } }; } };
  }
  function settableObs(initial) {
    let value = initial;
    const subs = [];
    return {
      get: () => value,
      set(next) { value = next; for (const s of subs) { try { s(next); } catch { } } },
      subscribe(change) {
        subs.push(change);
        try { change(value); } catch { }
        return { unsubscribe() { const i = subs.indexOf(change); if (i >= 0) subs.splice(i, 1); } };
      },
    };
  }

  // Captions on: Glic's caption overlay is the only page-visible source of the spoken text.
  const captionSetting = settableObs(true);
  const FOCUSED_TAB = {
    tabId: "desktop", url: "https://localhost/desktop", title: "Desktop",
    faviconUrl: "", documentMimeType: "text/html", isMediaActive: false,
  };
  let sharing = false;

  const host = {
    getChromeVersion: () => Promise.resolve({ major: 130, minor: 0, build: 0, patch: 0 }),
    getPlatform: () => 3,
    getFormFactor: () => 1,
    getHostCapabilities: () => new Set([3, 7, 8]),
    getUserProfileInfo: () => Promise.resolve({
      displayName: "You", email: "", givenName: "You", localProfileName: "You", isManaged: false,
      avatarIcon: () => Promise.resolve(undefined),
    }),
    getPanelState: () => obs({ kind: 2, windowId: "desktop" }),
    panelActive: () => obs(true),
    getFocusedTabStateV2: () => obs({ hasFocus: { tabData: FOCUSED_TAB } }),
    getContextFromFocusedTab: () => Promise.resolve({ tabData: FOCUSED_TAB }),
    captureScreenshot: () => captureFrame(),
    // Live's continuous viewport: Glic pulls a screenshot per frame through here.
    async getContextFromTab(_tabId, options) {
      const context = { tabData: FOCUSED_TAB };
      if (options && options.viewportScreenshot) {
        const shot = await captureFrame();
        if (shot) {
          context.viewportScreenshot = shot;
          context.screenshotInfo = { widthPixels: shot.widthPixels, heightPixels: shot.heightPixels };
        }
      }
      return context;
    },
    getTabContextPermissionStateV2: () => obs(true),
    getMicrophonePermissionState: () => obs(true),
    getLocationPermissionState: () => obs(true),
    getTabContextPermissionState: () => obs(true),
    getClosedCaptioningSetting: () => captionSetting,
    getDefaultTabContextPermissionState: () => obs(true),
    canAttachPanel: () => obs(false),
    isBrowserOpen: () => obs(true),
    isManuallyResizing: () => obs(false),
    getOsMicrophonePermissionStatus: () => Promise.resolve(true),
    getOsHotkeyState: () => obs({ hotkey: "" }),
    resizeWindow: () => Promise.resolve(),
    setTabContextPermissionState: () => Promise.resolve(),
    setMicrophonePermissionState: () => Promise.resolve(),
    setLocationPermissionState: () => Promise.resolve(),
    setClosedCaptioningSetting: () => Promise.resolve(), // keep captions on: they are our text tap
    attachPanel: () => Promise.resolve(),
    detachPanel: () => Promise.resolve(),
    closePanel() { setState("idle"); return Promise.resolve(); },
  };

  // --- Bootstrap: pre-define internalAutoGlicBoot, then replay Glic's own message listener with a
  // synthetic chrome://glic event (it needs a non-null source).
  let booted = false;
  const registry = {
    registerWebClient(webClient) {
      return Promise.resolve()
        .then(() => webClient.initialize(host))
        .then(() => {
          booted = true;
          emit("booted");
          setTimeout(() => { try { webClient.notifyPanelWillOpen && webClient.notifyPanelWillOpen({ kind: 2, windowId: "desktop" }); } catch { } }, 0);
        });
    },
  };
  window.internalAutoGlicBoot = () => registry;

  const bootstrapHandlers = [];
  const origAdd = EventTarget.prototype.addEventListener;
  Object.defineProperty(window, "addEventListener", {
    configurable: true, writable: true,
    value(type, listener, options) {
      if (type === "message" && typeof listener === "function") bootstrapHandlers.push(listener);
      origAdd.call(window, type, listener, options);
    },
  });
  const syntheticEvent = new MessageEvent("message", {
    origin: "chrome://glic", source: window,
    data: { type: "glic-bootstrap", glicApiSource: "data:text/javascript,//desktop" },
  });
  function tryBootstrap() {
    if (booted) return;
    for (const h of bootstrapHandlers) { try { h(syntheticEvent); } catch { } }
  }
  // A stale Google session still loads /glic and even adopts our host, but then shows "Gemini isn't
  // available right now" (its cookie rotation 401s). Report it so the host can offer a fresh sign-in.
  let unavailableReported = false;
  setInterval(() => {
    if (!unavailableReported && pageText().includes("isn't available right now")) {
      unavailableReported = true;
      emit("error", { message: "unavailable" });
    }
  }, 500);

  let bootTries = 0;
  const bootTimer = setInterval(() => {
    tryBootstrap();
    if (booted || ++bootTries > 150) {
      clearInterval(bootTimer);
      if (!booted) emit("error", { message: signedOut() ? "signed-out" : "Gemini page did not start" });
    }
  }, 100);

  // --- Page state helpers
  const button = fragment => {
    for (const b of document.querySelectorAll("button"))
      if ((b.getAttribute("aria-label") || "").includes(fragment)) return b;
    return null;
  };
  const pageText = () => (document.body && document.body.innerText) || "";
  function signedOut() {
    return location.hostname === "accounts.google.com" || /\bSign in\b/.test(pageText()) && !button("Go Live");
  }

  let lastState = null;
  function setState(state) {
    if (lastState === state) return;
    lastState = state;
    emit("state", { state });
  }

  // --- Captions -> transcript. Glic renders "<b>You:</b> ... <b>Gemini:</b> ..." and revises the live
  // utterance in place, so relay each utterance's current full text keyed by index.
  let relayed = [];
  function pumpCaptions() {
    const scroller = document.querySelector("captions-scroller");
    if (!scroller) return;
    const root = scroller.querySelector(".captions-scroller-container .captions-scroller")
      || scroller.querySelector(".captions-scroller-container") || scroller;
    const raw = [];
    let cur = null;
    for (const node of root.childNodes) {
      if (node.nodeType === 1 && node.tagName === "B") {
        const label = (node.textContent || "").toLowerCase();
        cur = { dir: label.includes("you") ? "user" : label.includes("gemini") ? "assistant" : null, text: "" };
        raw.push(cur);
      } else if (cur) cur.text += node.textContent || "";
    }
    const entries = raw.map(r => ({ dir: r.dir, text: r.text.replace(/\s+/g, " ").trim() })).filter(r => r.dir && r.text);
    entries.forEach((e, i) => {
      if (relayed[i] === e.text) return;
      relayed[i] = e.text;
      emit("transcript", { text: e.text, direction: e.dir, index: i });
    });
  }

  let monitor = null;
  function beginMonitor() {
    if (monitor) return;
    monitor = setInterval(() => {
      if (!active) return;
      if (pageText().includes("Your audio couldn't be heard"))
        emit("error", { message: "Gemini couldn't hear your microphone - check the Windows input device." });
      if (button("Pause live mode")) setState("listening");
      else if (button("Start live mode")) setState("paused");
      else if (button("Go Live")) setState("idle");
      pumpCaptions();
    }, 300);
  }

  // --- First-run surfaces: consent ("Live will use your microphone") and the volume onboarding card.
  // Pressing Win+C for Gemini Live is the user's decision to start it, so clear them.
  let consentAccepted = false;
  function advanceToLive() {
    const ok = button("OK");
    if (ok && button("No thanks") && pageText().includes("Live will use your microphone")) {
      ok.click(); consentAccepted = true; return;
    }
    const skip = button("Skip");
    if (skip && button("Go back") && button("Turn on live captions")) { skip.click(); return; }
    const startBtn = button("Start live mode");
    if (startBtn) { startBtn.click(); return; }
    if (consentAccepted) return;
    const goLive = button("Go Live");
    if (goLive) goLive.click();
  }

  let active = false;
  let goLiveTimer = null;
  function start() {
    active = true;
    sharing = true;
    relayed = [];
    lastState = null;
    consentAccepted = false;
    clearInterval(goLiveTimer);
    let tries = 0;
    goLiveTimer = setInterval(() => {
      // No usable session: stop quietly. The host waits for the browser's session and reloads us.
      if (!active || unavailableReported) return clearInterval(goLiveTimer);
      if (!booted) tryBootstrap();
      if (button("Pause live mode")) {
        clearInterval(goLiveTimer);
        emit("ready");
        setState("listening");
        beginMonitor();
        return;
      }
      advanceToLive();
      if (++tries > 100) {
        clearInterval(goLiveTimer);
        emit("error", { message: signedOut() ? "signed-out" : "Gemini Live did not start (sign-in or rate limit)" });
      }
    }, 300);
  }

  function stop() {
    active = false;
    sharing = false;
    clearInterval(goLiveTimer);
    for (const label of ["Switch to text mode", "Pause live mode", "End"]) {
      const b = button(label);
      if (b) { b.click(); break; }
    }
    setState("idle");
  }

  function setMuted(value) {
    muted = value;
    for (const t of micTracks) { if (t.readyState === "live") t.enabled = !value; else micTracks.delete(t); }
  }

  window.__glicBridge = { start, stop, setMuted, isBooted: () => booted, isSignedOut: signedOut };
})();
