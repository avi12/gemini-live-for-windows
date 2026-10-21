// GENERATED from bridge/glic_bridge.ts - edit the TypeScript, then `pnpm --dir bridge build`.
"use strict";
(() => {
  // glic_bridge.ts
  var RESUME_BUTTONS = ["Start live mode" /* StartLive */, "Go Live" /* GoLive */];
  var SIGN_IN_PATTERN = /\bSign in\b/;
  var MIC_ALIAS_IDS = /* @__PURE__ */ new Set(["default", "communications"]);
  var PANEL_STATE = { kind: 2 /* Attached */, windowId: "desktop" };
  var BOOT_POLL_MS = 100;
  var MAX_BOOT_TRIES = 150;
  var UNAVAILABLE_POLL_MS = 500;
  var START_POLL_MS = 300;
  var MAX_START_TRIES = 100;
  var MONITOR_POLL_MS = 300;
  var FRAME_TIMEOUT_MS = 3e3;
  var RESUME_GAP_MS = 2e3;
  var MAX_RESUME_TRIES = 5;
  if (!window.__glicBridge && window.top === window) {
    let booted = false;
    let active = false;
    let unavailableReported = false;
    let lastState = null;
    const native = window.chrome?.webview;
    const emit = (kind, extra) => {
      if (!native) {
        return;
      }
      try {
        native.postMessage({ kind, ...extra });
      } catch {
      }
    };
    const reportError = (message) => emit("error" /* Error */, { message });
    const pageText = () => document.body?.innerText || "";
    const pageSays = (phrase) => pageText().includes(phrase);
    const findButton = (...fragments) => {
      const buttons = [...document.querySelectorAll("button")];
      for (const fragment of fragments) {
        const match = buttons.find((b) => (b.getAttribute("aria-label") || "").includes(fragment));
        if (match) {
          return match;
        }
      }
      return null;
    };
    const clickButton = (...fragments) => {
      const button = findButton(...fragments);
      if (!button) {
        return false;
      }
      button.click();
      return true;
    };
    const isSignedOut = () => location.hostname === "accounts.google.com" || SIGN_IN_PATTERN.test(pageText()) && !findButton("Go Live" /* GoLive */);
    const reportStartFailure = (fallback) => reportError(isSignedOut() ? "signed-out" /* SignedOut */ : fallback);
    const setState = (state) => {
      if (lastState === state) {
        return;
      }
      lastState = state;
      emit("state" /* State */, { state });
    };
    try {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.addEventListener("visibilitychange", (e) => e.stopImmediatePropagation(), true);
    } catch {
    }
    const micTracks = /* @__PURE__ */ new Set();
    let muted = false;
    let micId = null;
    const withDesktopConstraints = (constraints) => {
      if (!constraints) {
        return constraints;
      }
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
          ...{ voiceIsolation: true },
          // ideal, not exact: an unplugged pick falls back to the default instead of failing Live.
          ...micId ? { deviceId: { ideal: micId } } : {}
        }
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
    }
    const setMuted = (value) => {
      muted = value;
      for (const track of micTracks) {
        if (track.readyState === "live") {
          track.enabled = !value;
        } else {
          micTracks.delete(track);
        }
      }
    };
    const listMics = async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === "audioinput" && d.deviceId && !MIC_ALIAS_IDS.has(d.deviceId)).map((d) => ({ id: d.deviceId, label: d.label || "Microphone" }));
    };
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
    const defaultMicLabel = async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.find((d) => d.kind === "audioinput" && d.deviceId === "default")?.label ?? "";
    };
    try {
      let followedDefault = "";
      defaultMicLabel().then(
        (label) => followedDefault = label,
        () => {
        }
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
    }
    let nextFrameId = 1;
    const pendingFrames = /* @__PURE__ */ new Map();
    const decodeFrame = (message) => {
      if (!message.base64) {
        return null;
      }
      const bytes = Uint8Array.from(atob(message.base64), (c) => c.charCodeAt(0));
      return {
        data: bytes.buffer,
        mimeType: message.mimeType,
        widthPixels: message.width,
        heightPixels: message.height
      };
    };
    native?.addEventListener("message", (e) => {
      const message = e.data;
      if (!message || message.kind !== "frame" /* Frame */) {
        return;
      }
      const resolve = pendingFrames.get(message.id);
      if (!resolve) {
        return;
      }
      pendingFrames.delete(message.id);
      resolve(decodeFrame(message));
    });
    const captureFrame = () => {
      if (!active) {
        return Promise.resolve(null);
      }
      const id = nextFrameId++;
      return new Promise((resolve) => {
        pendingFrames.set(id, resolve);
        emit("capture" /* Capture */, { id });
        setTimeout(() => {
          if (pendingFrames.delete(id)) {
            resolve(null);
          }
        }, FRAME_TIMEOUT_MS);
      });
    };
    const notify = (subscriber, value) => {
      try {
        subscriber(value);
      } catch {
      }
    };
    const observable = (value) => ({
      subscribe(change) {
        notify(change, value);
        return { unsubscribe() {
        } };
      }
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
            }
          };
        }
      };
    };
    const captionSetting = settableObservable(true);
    const FOCUSED_TAB = {
      tabId: "desktop",
      url: "https://localhost/desktop",
      title: "Desktop",
      faviconUrl: "",
      documentMimeType: "text/html",
      isMediaActive: false
    };
    const resolved = (value) => () => Promise.resolve(value);
    const host = {
      getChromeVersion: resolved({ major: 130, minor: 0, build: 0, patch: 0 }),
      getPlatform: () => 3 /* Linux */,
      getFormFactor: () => 1 /* Desktop */,
      getHostCapabilities: () => /* @__PURE__ */ new Set([3 /* MultiInstance */, 7 /* PdfZeroState */, 8 /* Invoke */]),
      getUserProfileInfo: resolved({
        displayName: "You",
        email: "",
        givenName: "You",
        localProfileName: "You",
        isManaged: false,
        avatarIcon: resolved(void 0)
      }),
      getPanelState: () => observable(PANEL_STATE),
      panelActive: () => observable(true),
      getFocusedTabStateV2: () => observable({ hasFocus: { tabData: FOCUSED_TAB } }),
      getContextFromFocusedTab: resolved({ tabData: FOCUSED_TAB }),
      captureScreenshot: () => captureFrame(),
      // Live's continuous viewport: Glic pulls a screenshot per frame through here.
      async getContextFromTab(_tabId, options) {
        const context = { tabData: FOCUSED_TAB };
        if (!options?.viewportScreenshot) {
          return context;
        }
        const shot = await captureFrame();
        if (shot) {
          context.viewportScreenshot = shot;
          context.screenshotInfo = { widthPixels: shot.widthPixels, heightPixels: shot.heightPixels };
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
      resizeWindow: resolved(void 0),
      setTabContextPermissionState: resolved(void 0),
      setMicrophonePermissionState: resolved(void 0),
      setLocationPermissionState: resolved(void 0),
      setClosedCaptioningSetting: resolved(void 0),
      // keep captions on: they are our text tap
      attachPanel: resolved(void 0),
      detachPanel: resolved(void 0),
      closePanel() {
        setState("idle" /* Idle */);
        return Promise.resolve();
      }
    };
    const registry = {
      registerWebClient(webClient) {
        return Promise.resolve().then(() => webClient.initialize(host)).then(() => {
          booted = true;
          emit("booted" /* Booted */);
          setTimeout(() => {
            if (webClient.notifyPanelWillOpen) {
              notify((state) => webClient.notifyPanelWillOpen?.(state), PANEL_STATE);
            }
          }, 0);
        });
      }
    };
    window.internalAutoGlicBoot = () => registry;
    const bootstrapHandlers = [];
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    Object.defineProperty(window, "addEventListener", {
      configurable: true,
      writable: true,
      value(type, listener, options) {
        if (type === "message" && typeof listener === "function") {
          bootstrapHandlers.push(listener);
        }
        originalAddEventListener.call(window, type, listener, options);
      }
    });
    const bootstrapEvent = new MessageEvent("message", {
      origin: "chrome://glic",
      source: window,
      data: { type: "glic-bootstrap", glicApiSource: "data:text/javascript,//desktop" }
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
        reportStartFailure("Gemini page did not start" /* PageDidNotStart */);
      }
    }, BOOT_POLL_MS);
    const unavailableTimer = setInterval(() => {
      if (!pageSays("isn't available right now" /* Unavailable */)) {
        return;
      }
      clearInterval(unavailableTimer);
      unavailableReported = true;
      reportError("unavailable" /* Unavailable */);
    }, UNAVAILABLE_POLL_MS);
    const LIVE_CHANNEL_PATH = "/v1/processSession";
    let MsgField;
    ((MsgField2) => {
      MsgField2[MsgField2["Seq"] = 0] = "Seq";
      MsgField2[MsgField2["ServerContent"] = 1] = "ServerContent";
      MsgField2[MsgField2["InputTranscription"] = 7] = "InputTranscription";
    })(MsgField || (MsgField = {}));
    let ContentField;
    ((ContentField2) => {
      ContentField2[ContentField2["GenerationComplete"] = 2] = "GenerationComplete";
      ContentField2[ContentField2["Interrupted"] = 3] = "Interrupted";
      ContentField2[ContentField2["OutputTranscription"] = 5] = "OutputTranscription";
    })(ContentField || (ContentField = {}));
    let utterances = [];
    let openUser = -1;
    let unfinishedUser = -1;
    let openAssistant = -1;
    let wireSeen = false;
    let relayed = [];
    const resetTranscript = () => {
      utterances = [];
      openUser = -1;
      unfinishedUser = -1;
      openAssistant = -1;
      relayed = [];
    };
    const relayUtterance = (index) => {
      const { direction, text } = utterances[index];
      const trimmed = text.replace(/\s+/g, " ").trim();
      if (!active || !trimmed || relayed[index] === trimmed) {
        return;
      }
      relayed[index] = trimmed;
      emit("transcript" /* Transcript */, { text: trimmed, direction, index });
    };
    const openUtterance = (direction) => utterances.push({ direction, text: "" }) - 1;
    const firstString = (value) => {
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
    const onInputTranscript = (field) => {
      const text = firstString(field);
      if (text === null) {
        return;
      }
      const isFinal = field[0] === null;
      const index = openUser >= 0 ? openUser : isFinal && unfinishedUser >= 0 ? unfinishedUser : openUtterance("user" /* User */);
      utterances[index].text = text;
      openUser = isFinal ? -1 : index;
      unfinishedUser = -1;
      relayUtterance(index);
    };
    const onOutputTranscript = (field) => {
      const [fragment, , , first] = field;
      if (typeof fragment !== "string") {
        return;
      }
      if (openAssistant < 0 || first === 1) {
        openAssistant = openUtterance("assistant" /* Assistant */);
        unfinishedUser = openUser;
        openUser = -1;
      }
      utterances[openAssistant].text += fragment;
      relayUtterance(openAssistant);
    };
    const onServerMessage = (msg) => {
      if (!Array.isArray(msg) || typeof msg[0 /* Seq */] !== "string") {
        return;
      }
      const input = msg[7 /* InputTranscription */];
      if (Array.isArray(input)) {
        wireSeen = true;
        onInputTranscript(input);
      }
      const content = msg[1 /* ServerContent */];
      if (!Array.isArray(content)) {
        return;
      }
      const output = content[5 /* OutputTranscription */];
      if (Array.isArray(output)) {
        wireSeen = true;
        onOutputTranscript(output);
      }
      if (content[2 /* GenerationComplete */] != null || content[3 /* Interrupted */] != null) {
        openAssistant = -1;
      }
    };
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
    const tapDownlink = (xhr) => {
      let offset = 0;
      const read = () => {
        let text;
        try {
          text = xhr.responseText;
        } catch {
          return;
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
          }
        }
      };
      xhr.addEventListener("progress", read);
      xhr.addEventListener("readystatechange", read);
    };
    try {
      const xhrOpen = XMLHttpRequest.prototype.open;
      const xhrSend = XMLHttpRequest.prototype.send;
      const downlinks = /* @__PURE__ */ new WeakSet();
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        if (String(method).toUpperCase() === "GET" && String(url).includes(LIVE_CHANNEL_PATH)) {
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
    }
    const captionsRoot = () => {
      const scroller = document.querySelector("captions-scroller");
      if (!scroller) {
        return null;
      }
      return scroller.querySelector(".captions-scroller-container .captions-scroller") || scroller.querySelector(".captions-scroller-container") || scroller;
    };
    const SPEAKER_LABELS = { you: "user" /* User */, gemini: "assistant" /* Assistant */ };
    const directionOf = (node) => {
      if (!(node instanceof Element) || node.tagName !== "B") {
        return null;
      }
      const label = (node.textContent || "").trim().replace(/:$/, "").toLowerCase();
      return SPEAKER_LABELS[label] ?? null;
    };
    const readUtterances = (root) => {
      const found = [];
      let current = null;
      for (const node of root.childNodes) {
        const direction = directionOf(node);
        if (direction) {
          current = { direction, text: "" };
          found.push(current);
        } else if (current) {
          current.text += node.textContent || "";
        }
      }
      return found.map((u) => ({ direction: u.direction, text: u.text.replace(/\s+/g, " ").trim() })).filter((u) => u.text);
    };
    const pumpCaptions = () => {
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
        emit("transcript" /* Transcript */, { text, direction, index });
      });
    };
    const DAY_S = 24 * 60 * 60;
    const DAY_MS = DAY_S * 1e3;
    const LIVE_TIMEOUT_FLAGS = {
      "45681081": DAY_S,
      // inactivity in "listening", seconds
      "45681082": DAY_S,
      // same, while a tab is shared, seconds
      "45687231": DAY_MS,
      // mic silence, ms
      "45677155": DAY_MS
      // privacy cap, ms
    };
    let timeoutsPatched = false;
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
        const value = flag && typeof flag === "object" && flag.key ? LIVE_TIMEOUT_FLAGS[flag.key] : void 0;
        if (value === void 0) {
          continue;
        }
        flag.defaultValue = value;
        flag.ctor = () => value;
        found++;
      }
      timeoutsPatched = found === Object.keys(LIVE_TIMEOUT_FLAGS).length;
      return timeoutsPatched;
    };
    let lastResume = 0;
    let resumeTries = 0;
    let consentAccepted = false;
    let monitorTimer = null;
    let startTimer;
    const resume = () => {
      const now = Date.now();
      if (now - lastResume < RESUME_GAP_MS * (resumeTries + 1)) {
        return;
      }
      if (++resumeTries > MAX_RESUME_TRIES) {
        if (resumeTries === MAX_RESUME_TRIES + 1) {
          reportError("Gemini Live paused and won't resume" /* LiveWontResume */);
        }
        return;
      }
      lastResume = now;
      clickButton(...RESUME_BUTTONS);
    };
    const monitorTick = () => {
      if (!active) {
        return;
      }
      if (findButton("Pause live mode" /* PauseLive */)) {
        resumeTries = 0;
        setState("listening" /* Listening */);
      } else if (findButton(...RESUME_BUTTONS)) {
        setState("resuming" /* Resuming */);
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
    const advanceToLive = () => {
      const ok = findButton("OK" /* Ok */);
      if (ok && findButton("No thanks" /* NoThanks */) && pageSays("Live will use your microphone" /* MicConsent */)) {
        ok.click();
        consentAccepted = true;
        return;
      }
      const skip = findButton("Skip" /* Skip */);
      if (skip && findButton("Go back" /* GoBack */) && findButton("Turn on live captions" /* TurnOnCaptions */)) {
        skip.click();
        return;
      }
      if (clickButton("Start live mode" /* StartLive */) || consentAccepted) {
        return;
      }
      clickButton("Go Live" /* GoLive */);
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
        if (!active || unavailableReported) {
          clearInterval(startTimer);
          return;
        }
        tryBootstrap();
        if (!patchLiveTimeouts() && tries < MAX_START_TRIES / 2) {
          tries++;
          return;
        }
        if (findButton("Pause live mode" /* PauseLive */)) {
          clearInterval(startTimer);
          emit("ready" /* Ready */);
          setState("listening" /* Listening */);
          beginMonitor();
          return;
        }
        advanceToLive();
        if (++tries <= MAX_START_TRIES) {
          return;
        }
        clearInterval(startTimer);
        reportStartFailure("Gemini Live did not start (sign-in or rate limit)" /* LiveDidNotStart */);
      }, START_POLL_MS);
    };
    const stop = () => {
      active = false;
      clearInterval(startTimer);
      clickButton("Switch to text mode" /* TextMode */, "Pause live mode" /* PauseLive */, "End" /* End */);
      setState("idle" /* Idle */);
    };
    const ACTION_READY_MS = 6e3;
    const ACTION_REPLY_MS = 3e4;
    const ACTION_SETTLE_MS = 1400;
    const ACTION_CONFIRM = [
      "Button that confirms actions" /* ConfirmsActions */,
      "Add event" /* AddEvent */,
      "Add Event" /* AddEventTitleCase */,
      "Create" /* Create */,
      "Save" /* Save */,
      "Remove" /* Remove */,
      "Delete" /* Delete */,
      "Update" /* Update */,
      "Confirm" /* Confirm */
    ];
    const SUBMIT = ["Submit" /* Submit */, "Send message" /* SendMessage */, "Send" /* Send */];
    const REPLY_DONE = ["Copy" /* Copy */, "Good response" /* GoodResponse */, "Regenerate" /* Regenerate */];
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
    const lastReplyText = () => {
      const containers = document.querySelectorAll(".presented-response-container");
      let last = containers[containers.length - 1];
      if (!last) {
        const nodes = document.querySelectorAll(
          "message-content, .model-response-text, .markdown, [data-response-index]"
        );
        last = nodes[nodes.length - 1];
      }
      return (last ? last.innerText : "").replace(/\s+/g, " ").replace(/^Gemini said\s*/i, "").trim();
    };
    const beginAction = async () => {
      active = false;
      clearInterval(startTimer);
      if (monitorTimer) {
        clearInterval(monitorTimer);
      }
      monitorTimer = null;
      clickButton("Switch to text mode" /* TextMode */);
      const box = await waitFor(editor, ACTION_READY_MS);
      if (!box) {
        return false;
      }
      box.focus();
      document.execCommand("selectAll");
      document.execCommand("delete");
      return true;
    };
    const submitAndRead = async () => {
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
      if (clickButton("Stop response" /* StopResponse */)) {
        await sleep(ACTION_SETTLE_MS);
      }
      if (clickButton(...ACTION_CONFIRM)) {
        await sleep(ACTION_SETTLE_MS);
        text = lastReplyText() || text;
      }
      return text;
    };
    window.__glicBridge = { start, stop, setMuted, listMics, setMic, beginAction, submitAndRead };
  }
})();
