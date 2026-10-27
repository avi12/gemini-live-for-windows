// GENERATED from bridge/glic/glic_bridge.ts - edit the TypeScript, then `pnpm --dir bridge build`.
"use strict";
(() => {
  // shared/webview_transport.ts
  function webViewTransport() {
    const channel = window.chrome?.webview;
    return {
      post(envelope) {
        try {
          channel?.postMessage(envelope);
        } catch {
        }
      },
      listen(receive) {
        channel?.addEventListener("message", (e) => receive(e.data));
      }
    };
  }

  // shared/text.ts
  function collapseWhitespace(text) {
    return text.replace(/\s+/g, " ").trim();
  }
  function labelAndText(element) {
    return `${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`;
  }

  // glic/captions.ts
  var SPEAKER_LABELS = {
    you: "user" /* User */,
    gemini: "assistant" /* Assistant */
  };
  function captionsRoot() {
    const scroller = document.querySelector("captions-scroller");
    if (!scroller) {
      return null;
    }
    return scroller.querySelector(".captions-scroller-container .captions-scroller") || scroller.querySelector(".captions-scroller-container") || scroller;
  }
  function directionOf(node) {
    if (!(node instanceof Element) || node.tagName !== "B") {
      return null;
    }
    const label = (node.textContent || "").trim().replace(/:$/, "").toLowerCase();
    return SPEAKER_LABELS[label] ?? null;
  }
  function readCaptions() {
    const root = captionsRoot();
    if (!root) {
      return [];
    }
    const found = [];
    let current = null;
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
    return found.map((utterance) => ({
      direction: utterance.direction,
      text: collapseWhitespace(utterance.text)
    })).filter((utterance) => utterance.text);
  }

  // glic/mic_gate.ts
  var COMFORT_NOISE_LEVEL = 1e-3;
  var GATE_RAMP_SECONDS = 0.01;
  var RESUME_TIMEOUT_MS = 1e3;
  function comfortNoise(context) {
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = (Math.random() * 2 - 1) * COMFORT_NOISE_LEVEL;
    }
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    noise.start();
    return noise;
  }
  function trackGate(microphone) {
    return {
      stream: microphone,
      setOpen(open) {
        for (const track of microphone.getAudioTracks()) {
          track.enabled = open;
        }
      }
    };
  }
  async function gateMicrophone(microphone) {
    return await audioGate(microphone).catch(() => null) ?? trackGate(microphone);
  }
  async function audioGate(microphone) {
    const context = new AudioContext();
    const running = await Promise.race([
      context.resume().then(() => context.state === "running"),
      new Promise((resolve) => setTimeout(() => resolve(false), RESUME_TIMEOUT_MS))
    ]).catch(() => false);
    if (!running) {
      void context.close();
      return null;
    }
    const destination = context.createMediaStreamDestination();
    const gate = context.createGain();
    context.createMediaStreamSource(microphone).connect(gate).connect(destination);
    comfortNoise(context).connect(destination);
    const [gated] = destination.stream.getAudioTracks();
    if (gated) {
      const stopGated = gated.stop.bind(gated);
      gated.stop = () => {
        stopGated();
        for (const track of microphone.getTracks()) {
          track.stop();
        }
        void context.close();
      };
    }
    return {
      stream: destination.stream,
      setOpen(open) {
        gate.gain.setTargetAtTime(open ? 1 : 0, context.currentTime, GATE_RAMP_SECONDS);
      }
    };
  }

  // glic/desktop_mic.ts
  var MicAlias = /* @__PURE__ */ ((MicAlias2) => {
    MicAlias2["Default"] = "default";
    MicAlias2["Communications"] = "communications";
    return MicAlias2;
  })(MicAlias || {});
  var MIC_ALIAS_IDS = new Set(Object.values(MicAlias));
  async function defaultMicLabel() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.find((d) => d.kind === "audioinput" && d.deviceId === "default" /* Default */)?.label ?? "";
  }
  function installDesktopMic(reopen) {
    const micGates = /* @__PURE__ */ new Set();
    let muted = false;
    let micId = null;
    function withDesktopConstraints(constraints) {
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
      const audio = {
        ...requested,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        voiceIsolation: true,
        // ideal, not exact: an unplugged pick falls back to the default instead of failing Live.
        ...micId ? {
          deviceId: {
            ideal: micId
          }
        } : {}
      };
      return {
        ...rest,
        audio
      };
    }
    try {
      const media = navigator.mediaDevices;
      const getUserMedia = media.getUserMedia.bind(media);
      media.getUserMedia = async (constraints) => {
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
    }
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
        if (!micId) {
          reopen();
        }
      });
    } catch {
    }
    return {
      setMuted(value) {
        muted = value;
        for (const gate of micGates) {
          if (gate.stream.getAudioTracks().some((track) => track.readyState === "live")) {
            gate.setOpen(!value);
          } else {
            micGates.delete(gate);
          }
        }
      },
      setMic(id) {
        const next = id || null;
        if (next === micId) {
          return;
        }
        micId = next;
        reopen();
      },
      async listMics() {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter((d) => d.kind === "audioinput" && d.deviceId && !MIC_ALIAS_IDS.has(d.deviceId)).map((d) => ({
          id: d.deviceId,
          label: d.label || "Microphone"
        }));
      }
    };
  }

  // glic/page_content.ts
  var APC_VERSION_1_0 = 1;
  var VARINT_CONTINUE = 128;
  var VARINT_LOW_BITS = 127;
  var TAG_WIRE_TYPE_BITS = 3;
  var BLOCK_TYPE = {
    ["heading" /* Heading */]: 5 /* Heading */,
    ["paragraph" /* Paragraph */]: 4 /* Paragraph */
  };
  var encoder = new TextEncoder();
  function varint(value) {
    const bytes = [];
    let rest = value;
    while (rest >= VARINT_CONTINUE) {
      bytes.push(rest & VARINT_LOW_BITS | VARINT_CONTINUE);
      rest = Math.floor(rest / VARINT_CONTINUE);
    }
    bytes.push(rest);
    return bytes;
  }
  function tag(field, wireType) {
    return varint(field << TAG_WIRE_TYPE_BITS | wireType);
  }
  function varintField(field, value) {
    return [...tag(field, 0 /* Varint */), ...varint(value)];
  }
  function bytesField(field, bytes) {
    return [
      ...tag(field, 2 /* Bytes */),
      ...varint(bytes.length),
      ...Array.from(bytes)
    ];
  }
  function stringField(field, text) {
    return bytesField(field, encoder.encode(text));
  }
  function contentNode(type, id, text, children = []) {
    const attributes = [
      ...varintField(2 /* DomNodeId */, id),
      ...varintField(3 /* Type */, type),
      ...text === void 0 ? [] : bytesField(10 /* TextData */, stringField(1 /* TextContent */, text))
    ];
    return [
      ...children.flatMap((child) => bytesField(1 /* Children */, child)),
      ...bytesField(2 /* Attributes */, attributes)
    ];
  }
  function annotatedPageContent(title, url, blocks) {
    let nextId = 1;
    const children = blocks.map(({ kind, text }) => {
      const blockId = ++nextId;
      const textNode = contentNode(20 /* Text */, ++nextId, text);
      return contentNode(BLOCK_TYPE[kind], blockId, void 0, [textNode]);
    });
    const root = contentNode(1 /* Root */, 1, void 0, children);
    const frame = [...stringField(4 /* Url */, url), ...stringField(5 /* Title */, title)];
    return new Uint8Array([
      ...varintField(1 /* Version */, APC_VERSION_1_0),
      ...bytesField(2 /* RootNode */, root),
      ...bytesField(3 /* MainFrameData */, frame)
    ]);
  }
  function byteStream(bytes) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      }
    });
  }

  // glic/glic_host.ts
  var TAB_ID = "desktop";
  var PANEL_STATE = {
    kind: 2 /* Attached */,
    windowId: TAB_ID
  };
  var SCREEN_NUDGE_MS = 1e3;
  var BOOT_POLL_MS = 100;
  var MAX_BOOT_TRIES = 150;
  function notify(subscriber, value) {
    try {
      subscriber(value);
    } catch {
    }
  }
  function observable(value) {
    return {
      subscribe(change) {
        notify(change, value);
        return { unsubscribe() {
        } };
      }
    };
  }
  function settableObservable(initial) {
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
  }
  function resolved(value) {
    return () => Promise.resolve(value);
  }
  function toScreenshot(picture) {
    const bytes = Uint8Array.from(atob(picture.data), (char) => char.charCodeAt(0));
    return {
      data: bytes.buffer,
      mimeType: picture.mimeType,
      widthPixels: picture.width,
      heightPixels: picture.height
    };
  }
  function createGlicHost(session) {
    async function captureFrame() {
      if (!session.isActive()) {
        return null;
      }
      const picture = await session.capture();
      return picture ? toScreenshot(picture) : null;
    }
    let latestView = null;
    const captionSetting = settableObservable(true);
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
    function nudgeScreen(now) {
      lastNudge = now;
      nudges++;
      focusedTabSetting.set(focusedTabState());
    }
    let reading = false;
    async function readThenNudge(now) {
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
    function tabContext(options) {
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
      getFocusedTabStateV2: () => focusedTabSetting,
      getContextFromFocusedTab: (options) => Promise.resolve(tabContext(options)),
      captureScreenshot: () => captureFrame(),
      // Live's viewport: Glic pulls a screenshot and the page content through here for each new
      // focused tab id.
      async getContextFromTab(_tabId, options) {
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
      resizeWindow: resolved(void 0),
      setTabContextPermissionState: resolved(void 0),
      setMicrophonePermissionState: resolved(void 0),
      setLocationPermissionState: resolved(void 0),
      setClosedCaptioningSetting: resolved(void 0),
      // keep captions on: they are our text tap
      attachPanel: resolved(void 0),
      detachPanel: resolved(void 0),
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
    };
  }
  function installBootstrap(host, events) {
    let booted = false;
    const registry = {
      registerWebClient(webClient) {
        return Promise.resolve().then(() => webClient.initialize(host)).then(() => {
          booted = true;
          events.onBooted();
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
      data: {
        type: "glic-bootstrap",
        glicApiSource: "data:text/javascript,//desktop"
      }
    });
    function tryBootstrap() {
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

  // glic/glic_page.ts
  var RESUME_BUTTONS = ["Start live mode" /* StartLive */, "Go Live" /* GoLive */];
  var SIGN_IN_PATTERN = /\bSign in\b/;
  var SIGN_IN_HOST = "accounts.google.com";
  function pageText() {
    return document.body?.innerText || "";
  }
  function pageSays(phrase) {
    return pageText().includes(phrase);
  }
  function findButton(...fragments) {
    const buttons = [...document.querySelectorAll("button")];
    for (const fragment of fragments) {
      const match = buttons.find((button) => (button.getAttribute("aria-label") || "").includes(fragment));
      if (match) {
        return match;
      }
    }
    return null;
  }
  function findButtonByText(fragment) {
    return [...document.querySelectorAll("button")].find((button) => labelAndText(button).includes(fragment));
  }
  function clickButton(...fragments) {
    const button = findButton(...fragments);
    if (!button) {
      return false;
    }
    button.click();
    return true;
  }
  function isSignedOut() {
    return location.hostname === SIGN_IN_HOST || SIGN_IN_PATTERN.test(pageText()) && !findButton("Go Live" /* GoLive */);
  }
  function keepPageVisible() {
    try {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible"
      });
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false
      });
      document.addEventListener("visibilitychange", (e) => e.stopImmediatePropagation(), true);
    } catch {
    }
  }

  // glic/live_timeouts.ts
  var DAY_S = 24 * 60 * 60;
  var DAY_MS = DAY_S * 1e3;
  var LIVE_TIMEOUT_FLAGS = {
    45681081: DAY_S,
    // inactivity in "listening", seconds
    45681082: DAY_S,
    // same, while a tab is shared, seconds
    45687231: DAY_MS,
    // mic silence, ms
    45677155: DAY_MS
    // privacy cap, ms
  };
  function isClientFlag(value) {
    return typeof value === "object" && value !== null;
  }
  var timeoutsPatched = false;
  function patchLiveTimeouts() {
    if (timeoutsPatched) {
      return true;
    }
    const namespace = window.default_BardChatUi;
    if (!namespace) {
      return false;
    }
    let found = 0;
    for (const flag of Object.values(namespace)) {
      if (!isClientFlag(flag) || !flag.key) {
        continue;
      }
      const value = LIVE_TIMEOUT_FLAGS[flag.key];
      if (value === void 0) {
        continue;
      }
      flag.defaultValue = value;
      flag.ctor = () => value;
      found++;
    }
    timeoutsPatched = found === Object.keys(LIVE_TIMEOUT_FLAGS).length;
    return timeoutsPatched;
  }

  // glic/live_wire.ts
  var LIVE_CHANNEL_PATH = "/v1/processSession";
  function firstString(value) {
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
  }
  function tapLiveTranscript(relay) {
    let utterances = [];
    let openUser = -1;
    let unfinishedUser = -1;
    let openAssistant = -1;
    let wireSeen = false;
    let unansweredSince = null;
    function relayUtterance(index) {
      relay(index, utterances[index]);
    }
    function openUtterance(direction) {
      return utterances.push({
        direction,
        text: ""
      }) - 1;
    }
    function inputUtterance(isFinal) {
      if (openUser >= 0) {
        return openUser;
      }
      if (isFinal && unfinishedUser >= 0) {
        return unfinishedUser;
      }
      return openUtterance("user" /* User */);
    }
    function onInputTranscript(field) {
      const text = firstString(field);
      if (text === null) {
        return;
      }
      const isFinal = field[0] === null;
      const index = inputUtterance(isFinal);
      utterances[index].text = text;
      openUser = isFinal ? -1 : index;
      unfinishedUser = -1;
      unansweredSince = Date.now();
      relayUtterance(index);
    }
    function onOutputTranscript(field) {
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
    }
    function onServerMessage(msg) {
      if (!Array.isArray(msg) || typeof msg[0 /* Seq */] !== "string") {
        return;
      }
      const input = msg[7 /* InputTranscription */];
      if (Array.isArray(input)) {
        wireSeen = true;
        onInputTranscript(input);
      }
      if (Array.isArray(msg[3 /* Status */])) {
        unansweredSince = null;
      }
      const content = msg[1 /* ServerContent */];
      if (!Array.isArray(content)) {
        return;
      }
      unansweredSince = null;
      const output = content[5 /* OutputTranscription */];
      if (Array.isArray(output)) {
        wireSeen = true;
        onOutputTranscript(output);
      }
      if (content[2 /* GenerationComplete */] != null || content[3 /* Interrupted */] != null) {
        openAssistant = -1;
      }
    }
    function onChannelChunk(chunk) {
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
    }
    function readChunk(chunk) {
      try {
        onChannelChunk(chunk);
      } catch {
      }
    }
    function tapDownlink(xhr) {
      let offset = 0;
      function read() {
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
          readChunk(chunk);
        }
      }
      xhr.addEventListener("progress", read);
      xhr.addEventListener("readystatechange", read);
    }
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
        xhrOpen.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function(...args) {
        if (downlinks.has(this)) {
          tapDownlink(this);
        }
        return xhrSend.apply(this, args);
      };
    } catch {
    }
    return {
      reset() {
        utterances = [];
        openUser = -1;
        unfinishedUser = -1;
        openAssistant = -1;
        unansweredSince = null;
      },
      seen: () => wireSeen,
      unansweredSince: () => unansweredSince
    };
  }

  // glic/text_action.ts
  var ACTION_READY_MS = 6e3;
  var EDITOR_POLL_MS = 150;
  var ACTION_REPLY_MS = 3e4;
  var REPLY_POLL_MS = 200;
  var ACTION_SETTLE_MS = 1400;
  var ACTION_CONFIRM = [
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
  var SUBMIT = ["Submit" /* Submit */, "Send message" /* SendMessage */, "Send" /* Send */];
  var REPLY_DONE = ["Copy" /* Copy */, "Good response" /* GoodResponse */, "Regenerate" /* Regenerate */];
  var REPLY_PREFIX = /^Gemini said\s*/i;
  var WEB_LINK = /^https?:\/\//i;
  function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
  async function waitFor(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = predicate();
      if (value) {
        return value;
      }
      await sleep(EDITOR_POLL_MS);
    }
    return null;
  }
  function editor() {
    return document.querySelector('[contenteditable="true"]');
  }
  function lastReply() {
    const containers = document.querySelectorAll(".presented-response-container");
    const last = containers[containers.length - 1];
    if (last) {
      return last;
    }
    const nodes = document.querySelectorAll(
      "message-content, .model-response-text, .markdown, [data-response-index]"
    );
    return nodes[nodes.length - 1];
  }
  function lastReplyText() {
    return collapseWhitespace(lastReply()?.innerText ?? "").replace(REPLY_PREFIX, "");
  }
  function lastReplyLinks() {
    const links = /* @__PURE__ */ new Map();
    for (const anchor of lastReply()?.querySelectorAll("a[href]") ?? []) {
      if (!(anchor instanceof HTMLAnchorElement) || !WEB_LINK.test(anchor.href) || links.has(anchor.href)) {
        continue;
      }
      const title = collapseWhitespace(anchor.innerText) || new URL(anchor.href).hostname;
      links.set(anchor.href, {
        title,
        url: anchor.href
      });
    }
    return [...links.values()];
  }
  async function openTextEditor() {
    clickButton("Switch to text mode" /* TextMode */);
    const box = await waitFor(editor, ACTION_READY_MS);
    if (!box) {
      return false;
    }
    box.focus();
    document.execCommand("selectAll");
    document.execCommand("delete");
    return true;
  }
  async function submitAndRead() {
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
      await sleep(REPLY_POLL_MS);
    }
    if (clickButton("Stop response" /* StopResponse */)) {
      await sleep(ACTION_SETTLE_MS);
    }
    if (clickButton(...ACTION_CONFIRM)) {
      await sleep(ACTION_SETTLE_MS);
      text = lastReplyText() || text;
    }
    return {
      text,
      links: lastReplyLinks()
    };
  }

  // glic/transcript.ts
  function transcriptRelay(send) {
    let relayed = [];
    return {
      relay(index, { direction, text }) {
        const trimmed = collapseWhitespace(text);
        if (!trimmed || relayed[index] === trimmed) {
          return;
        }
        relayed[index] = trimmed;
        send({
          text: trimmed,
          direction,
          index
        });
      },
      reset() {
        relayed = [];
      }
    };
  }

  // ../messaging/src/index.ts
  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }
  function isRequest(value) {
    return isRecord(value) && typeof value.id === "number" && typeof value.type === "string" && typeof value.timestamp === "number";
  }
  function isReply(value) {
    return isRecord(value) && typeof value.replyTo === "number" && (value.err === void 0 || value.err === null || typeof value.err === "string");
  }
  function defineMessaging(transport, config) {
    const handlers = /* @__PURE__ */ new Map();
    const pending = /* @__PURE__ */ new Map();
    let nextId = 1;
    function isMessageOf(request, type) {
      return request.type === String(type);
    }
    async function answer(request) {
      const handler = handlers.get(request.type);
      if (!handler) {
        transport.post({
          replyTo: request.id,
          err: `No listener for "${request.type}"`
        });
        return;
      }
      try {
        const res = await handler(request);
        transport.post({
          replyTo: request.id,
          res: res ?? null
        });
      } catch (error) {
        transport.post({
          replyTo: request.id,
          err: error instanceof Error ? error.message : String(error)
        });
      }
    }
    function settle(reply) {
      const waiting = pending.get(reply.replyTo);
      if (!waiting) {
        return;
      }
      pending.delete(reply.replyTo);
      if (reply.err != null) {
        waiting.reject(new Error(reply.err));
        return;
      }
      waiting.resolve(reply.res);
    }
    transport.listen((envelope) => {
      if (isRequest(envelope)) {
        void answer(envelope);
        return;
      }
      if (isReply(envelope)) {
        settle(envelope);
      }
    });
    function sendMessage(type, data) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, {
          resolve,
          reject
        });
        setTimeout(() => {
          if (pending.delete(id)) {
            reject(new Error(`No reply to "${String(type)}" in ${config.timeoutMs} ms`));
          }
        }, config.timeoutMs);
        transport.post({
          id,
          type,
          data: data ?? null,
          timestamp: Date.now()
        });
      });
    }
    return {
      sendMessage,
      onMessage(type, onReceived) {
        const key = String(type);
        if (handlers.has(key)) {
          throw new Error(`"${key}" already has a listener`);
        }
        handlers.set(key, (request) => {
          if (!isMessageOf(request, type)) {
            throw new Error(`"${request.type}" reached the listener for "${key}"`);
          }
          return onReceived(request);
        });
        return () => handlers.delete(key);
      },
      removeAllListeners: () => handlers.clear()
    };
  }

  // glic/glic_bridge.ts
  var REQUEST_TIMEOUT_MS = 3e3;
  var UNAVAILABLE_POLL_MS = 500;
  var START_POLL_MS = 300;
  var MAX_START_TRIES = 100;
  var MONITOR_POLL_MS = 300;
  var RESUME_GAP_MS = 2e3;
  var MAX_RESUME_BACKOFF = 5;
  var TRY_AGAIN_GAP_MS = 5e3;
  var BROKEN_AFTER_MS = 15e3;
  var NO_REPLY_MS = 12e3;
  if (!window.__glicBridgeInstalled && window.top === window) {
    let report = function(sent) {
      sent.catch(() => {
      });
    }, reportError = function(message) {
      report(app.sendMessage("error" /* Error */, message));
    }, reportStartFailure = function(fallback) {
      reportError(isSignedOut() ? "signed-out" /* SignedOut */ : fallback);
    }, setState = function(state) {
      if (lastState === state) {
        return;
      }
      lastState = state;
      report(app.sendMessage("state" /* State */, state));
    }, reopenMic = function() {
      if (!active) {
        return;
      }
      stop();
      start();
    }, pumpCaptions = function() {
      if (wire.seen()) {
        return;
      }
      readCaptions().forEach((utterance, index) => transcript.relay(index, utterance));
    }, resume = function(now) {
      if (now - lastResume < RESUME_GAP_MS * Math.min(resumeTries + 1, MAX_RESUME_BACKOFF)) {
        return;
      }
      resumeTries++;
      lastResume = now;
      clickButton(...RESUME_BUTTONS);
    }, markLive = function(now) {
      lastLive = now;
      resumeTries = 0;
      brokenReported = false;
      setState("listening" /* Listening */);
    }, restartIfUnanswered = function(now) {
      const since = wire.unansweredSince();
      if (since === null || since === restartedFor || now - since < NO_REPLY_MS) {
        return false;
      }
      restartedFor = since;
      return clickButton("Pause live mode" /* PauseLive */);
    }, monitorTick = function() {
      if (!active) {
        return;
      }
      const now = Date.now();
      glic.refreshScreen(now);
      pumpCaptions();
      const wentWrong = pageSays("Something went wrong" /* WentWrong */);
      if (findButton("Pause live mode" /* PauseLive */) && !wentWrong && !restartIfUnanswered(now)) {
        markLive(now);
        return;
      }
      setState("resuming" /* Resuming */);
      if (!wentWrong && findButton(...RESUME_BUTTONS)) {
        resume(now);
        return;
      }
      const retry = findButtonByText("Try again" /* TryAgain */);
      if (retry && now - lastTryAgain > TRY_AGAIN_GAP_MS) {
        lastTryAgain = now;
        retry.click();
      }
      if (wentWrong && now - lastLive > BROKEN_AFTER_MS && !brokenReported) {
        brokenReported = true;
        reportError("live-broke" /* LiveBroke */);
      }
    }, beginMonitor = function() {
      if (monitorTimer !== void 0) {
        return;
      }
      monitorTimer = setInterval(monitorTick, MONITOR_POLL_MS);
    }, advanceToLive = function() {
      const ok = findButton("OK" /* Okay */);
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
    }, start = function() {
      active = true;
      wire.reset();
      transcript.reset();
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
          report(app.sendMessage("ready" /* Ready */));
          markLive(Date.now());
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
    }, stop = function() {
      active = false;
      clearInterval(startTimer);
      clickButton("Switch to text mode" /* TextMode */, "Pause live mode" /* PauseLive */, "End" /* End */);
      setState("idle" /* Idle */);
    }, beginAction = function() {
      active = false;
      clearInterval(startTimer);
      clearInterval(monitorTimer);
      monitorTimer = void 0;
      return openTextEditor();
    };
    report2 = report, reportError2 = reportError, reportStartFailure2 = reportStartFailure, setState2 = setState, reopenMic2 = reopenMic, pumpCaptions2 = pumpCaptions, resume2 = resume, markLive2 = markLive, restartIfUnanswered2 = restartIfUnanswered, monitorTick2 = monitorTick, beginMonitor2 = beginMonitor, advanceToLive2 = advanceToLive, start2 = start, stop2 = stop, beginAction2 = beginAction;
    window.__glicBridgeInstalled = true;
    const app = defineMessaging(webViewTransport(), { timeoutMs: REQUEST_TIMEOUT_MS });
    let active = false;
    let unavailableReported = false;
    let lastState = null;
    keepPageVisible();
    const mic = installDesktopMic(reopenMic);
    const glic = createGlicHost({
      isActive: () => active,
      capture: () => app.sendMessage("capture" /* Capture */).catch(() => null),
      read: () => app.sendMessage("read" /* Read */).catch(() => null),
      onClosePanel: () => setState("idle" /* Idle */)
    });
    const tryBootstrap = installBootstrap(glic.host, {
      onBooted: () => report(app.sendMessage("booted" /* Booted */)),
      onFailed: () => reportStartFailure("Gemini page did not start" /* PageDidNotStart */)
    });
    const unavailableTimer = setInterval(() => {
      if (!pageSays("isn't available right now" /* Unavailable */)) {
        return;
      }
      clearInterval(unavailableTimer);
      unavailableReported = true;
      reportError("unavailable" /* Unavailable */);
    }, UNAVAILABLE_POLL_MS);
    const transcript = transcriptRelay((line) => report(app.sendMessage("transcript" /* Transcript */, line)));
    const wire = tapLiveTranscript((index, utterance) => {
      if (active) {
        transcript.relay(index, utterance);
      }
    });
    let lastResume = 0;
    let resumeTries = 0;
    let lastLive = 0;
    let lastTryAgain = 0;
    let restartedFor = null;
    let brokenReported = false;
    let consentAccepted = false;
    let monitorTimer;
    let startTimer;
    app.onMessage("start" /* Start */, () => start());
    app.onMessage("stop" /* Stop */, () => stop());
    app.onMessage("setMuted" /* SetMuted */, ({ data }) => mic.setMuted(data));
    app.onMessage("listMics" /* ListMics */, () => mic.listMics());
    app.onMessage("setMic" /* SetMic */, ({ data }) => mic.setMic(data));
    app.onMessage("beginAction" /* BeginAction */, () => beginAction());
    app.onMessage("submitAndRead" /* SubmitAndRead */, () => submitAndRead());
  }
  var report2;
  var reportError2;
  var reportStartFailure2;
  var setState2;
  var reopenMic2;
  var pumpCaptions2;
  var resume2;
  var markLive2;
  var restartIfUnanswered2;
  var monitorTick2;
  var beginMonitor2;
  var advanceToLive2;
  var start2;
  var stop2;
  var beginAction2;
})();
