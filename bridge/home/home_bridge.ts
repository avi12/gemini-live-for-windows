import { collapseWhitespace, labelAndText } from "../shared/text";
import { webViewTransport } from "../shared/webview_transport";
// Injected at document-start into home.google.com inside our hidden WebView2 (bundled to
// home_bridge.js by build.mjs). The Home web app is signed in with the browser's Google session and
// does all the auth and device wiring; we only locate the PC Lights tile, read whether it is on from
// its own "On"/"Off" text, and report where to click. HomeHost asks over the typed messenger
// (HomeProtocolMap in home_protocol.ts) and does the click itself as a trusted CDP mouse event,
// because the tiles ignore synthetic DOM clicks (same reason glic types with trusted keys).
// Scoped to the PC lights for now.
import { HomeMessage, type HomeProtocolMap, type PcLightsState } from "./home_protocol";
import { defineMessaging } from "@gemini-live/messaging";

const DEVICE = "PC Lights";
const CARD_MIN_W = 300;
const CARD_MIN_H = 60;
const DISMISS_TEXT = /^(ok|got it|no thanks|not now|dismiss|done)$/i;
const DISMISS_LABEL = /\b(close|dismiss)\b/i;
// The page only answers HomeHost and never asks it anything, so this bounds nothing in practice.
const MESSAGE_TIMEOUT_MS = 1000;

declare global {
  interface Window {
    __homeBridgeInstalled?: boolean;
  }
}

// Top frame only, install once.
if (!window.__homeBridgeInstalled && window.top === window) {
  window.__homeBridgeInstalled = true;
  const app = defineMessaging<HomeProtocolMap>(webViewTransport(), { timeoutMs: MESSAGE_TIMEOUT_MS });

  // Walk open shadow roots as well as the light DOM - the Home app is deep web components.
  function deepQuery(root: Document | ShadowRoot | Element, selector: string): Element[] {
    const out: Element[] = [];
    function walk(node: Document | ShadowRoot | Element): void {
      try {
        out.push(...node.querySelectorAll(selector));
      } catch {
        // A selector a particular root rejects; skip it.
      }
      for (const kid of node.querySelectorAll("*")) {
        if (kid.shadowRoot) {
          walk(kid.shadowRoot);
        }
      }
    }
    walk(root);
    return out;
  }

  // Close any onboarding or survey card covering the grid. Scoped to dialog roots, so a normal
  // "Done"/"OK" button elsewhere on the page is left alone.
  function dismissCards(): void {
    for (const overlay of deepQuery(document, "[role=\"dialog\"],[role=\"alertdialog\"]")) {
      for (const button of overlay.querySelectorAll<HTMLElement>("button,[role=\"button\"]")) {
        if (DISMISS_TEXT.test((button.textContent ?? "").trim()) || DISMISS_LABEL.test(labelAndText(button))) {
          button.click();
        }
      }
    }
  }

  // The tile card: the sizeable clickable ancestor of the device-name label.
  function deviceCard(name: string): HTMLElement | null {
    const label = deepQuery(document, "*").find(
      element => element.children.length === 0 && (element.textContent ?? "").trim() === name
    );
    for (let node = label?.parentElement ?? null; node; node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      if (rect.width > CARD_MIN_W && rect.height > CARD_MIN_H) {
        return node;
      }
    }
    return null;
  }

  // The tile prints its own state on its own line - the reliable signal (its lit appearance is not:
  // an interacted tile keeps a bright focus highlight that looks "on" whatever the real state). Read
  // it via innerText, where the lines are space-separated; textContent glues them ("PC LightsOff"),
  // where a word boundary never matches. Off wins over On, since an "on" tile may also read "On •
  // 100%" but only an off one says "Off". null until the state word has loaded in.
  function cardText(card: HTMLElement): string {
    return collapseWhitespace(card.innerText);
  }
  function stateOf(text: string): boolean | null {
    if (/\boff\b/i.test(text)) {
      return false;
    }

    if (/\bon\b/i.test(text)) {
      return true;
    }

    return null;
  }

  /** A whole pixel of the view; a layout that yields none fails the request rather than a click. */
  function pixel(value: number): number {
    const rounded = Math.round(value);
    if (!Number.isInteger(rounded)) {
      throw new Error(`Not a pixel position: ${value}`);
    }

    return rounded;
  }

  function measure(): PcLightsState {
    dismissCards();
    const card = deviceCard(DEVICE);
    if (!card) {
      return { found: false };
    }

    card.scrollIntoView({ block: "center" }); // bring it into the hidden view so the click lands
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
  }

  app.onMessage(HomeMessage.Ready, (): boolean => {
    dismissCards(); // an onboarding overlay mustn't hold the readiness gate false
    const card = deviceCard(DEVICE);
    return card !== null && stateOf(cardText(card)) !== null; // wait for the device state to load
  });
  app.onMessage(HomeMessage.PcLights, (): PcLightsState => measure());
}
