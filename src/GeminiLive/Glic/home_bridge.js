// GENERATED from bridge/home_bridge.ts - edit the TypeScript, then `pnpm --dir bridge build`.
"use strict";
(() => {
  // text.ts
  function collapseWhitespace(text) {
    return text.replace(/\s+/g, " ").trim();
  }
  function labelAndText(element) {
    return `${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`;
  }

  // webview_transport.ts
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

  // home_bridge.ts
  var DEVICE = "PC Lights";
  var CARD_MIN_W = 300;
  var CARD_MIN_H = 60;
  var DISMISS_TEXT = /^(ok|got it|no thanks|not now|dismiss|done)$/i;
  var DISMISS_LABEL = /\b(close|dismiss)\b/i;
  var MESSAGE_TIMEOUT_MS = 1e3;
  if (!window.__homeBridgeInstalled && window.top === window) {
    let deepQuery = function(root, selector) {
      const out = [];
      function walk(node) {
        try {
          out.push(...node.querySelectorAll(selector));
        } catch {
        }
        for (const kid of node.querySelectorAll("*")) {
          if (kid.shadowRoot) {
            walk(kid.shadowRoot);
          }
        }
      }
      walk(root);
      return out;
    }, dismissCards = function() {
      for (const overlay of deepQuery(document, '[role="dialog"],[role="alertdialog"]')) {
        for (const button of overlay.querySelectorAll('button,[role="button"]')) {
          if (DISMISS_TEXT.test((button.textContent ?? "").trim()) || DISMISS_LABEL.test(labelAndText(button))) {
            button.click();
          }
        }
      }
    }, deviceCard = function(name) {
      const label = deepQuery(document, "*").find(
        (element) => element.children.length === 0 && (element.textContent ?? "").trim() === name
      );
      for (let node = label?.parentElement ?? null; node; node = node.parentElement) {
        const rect = node.getBoundingClientRect();
        if (rect.width > CARD_MIN_W && rect.height > CARD_MIN_H) {
          return node;
        }
      }
      return null;
    }, cardText = function(card) {
      return collapseWhitespace(card.innerText);
    }, stateOf = function(text) {
      if (/\boff\b/i.test(text)) {
        return false;
      }
      if (/\bon\b/i.test(text)) {
        return true;
      }
      return null;
    }, pixel = function(value) {
      const rounded = Math.round(value);
      if (!Number.isInteger(rounded)) {
        throw new Error(`Not a pixel position: ${value}`);
      }
      return rounded;
    }, measure = function() {
      dismissCards();
      const card = deviceCard(DEVICE);
      if (!card) {
        return { found: false };
      }
      card.scrollIntoView({ block: "center" });
      const rect = card.getBoundingClientRect();
      const text = cardText(card);
      return {
        found: true,
        name: DEVICE,
        on: stateOf(text),
        text,
        x: pixel(rect.x + rect.width / 2),
        y: pixel(rect.y + rect.height / 2)
      };
    };
    deepQuery2 = deepQuery, dismissCards2 = dismissCards, deviceCard2 = deviceCard, cardText2 = cardText, stateOf2 = stateOf, pixel2 = pixel, measure2 = measure;
    window.__homeBridgeInstalled = true;
    const app = defineMessaging(webViewTransport(), { timeoutMs: MESSAGE_TIMEOUT_MS });
    app.onMessage("ready" /* Ready */, () => {
      dismissCards();
      const card = deviceCard(DEVICE);
      return card !== null && stateOf(cardText(card)) !== null;
    });
    app.onMessage("pcLights" /* PcLights */, () => measure());
  }
  var deepQuery2;
  var dismissCards2;
  var deviceCard2;
  var cardText2;
  var stateOf2;
  var pixel2;
  var measure2;
})();
