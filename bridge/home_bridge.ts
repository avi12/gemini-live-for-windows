// Injected at document-start into home.google.com inside our hidden WebView2 (bundled to
// home_bridge.js by build.mjs). The Home web app is signed in with the browser's Google session and
// does all the auth and device wiring; we only locate the PC Lights tile, read whether it is on from
// its own "On"/"Off" text, and report where to click. HomeHost does the click as a trusted CDP mouse
// event, because the tiles ignore synthetic DOM clicks (same reason glic types with trusted keys).
// Scoped to the PC lights for now.
import { z } from 'zod';

const DEVICE = 'PC Lights';
const CARD_MIN_W = 300;
const CARD_MIN_H = 60;
const DISMISS_TEXT = /^(ok|got it|no thanks|not now|dismiss|done)$/i;

// The shape HomeHost reads back. Zod enforces it at runtime, so a Home-app DOM change that breaks our
// reading surfaces as a validation error here instead of a silently wrong value in C#.
const PcLightsState = z.discriminatedUnion('found', [
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    name: z.string(),
    on: z.boolean().nullable(), // null when the tile shows no state word yet
    text: z.string(),
    x: z.number().int(),
    y: z.number().int(),
  }),
]);
type PcLightsState = z.infer<typeof PcLightsState>;

interface HomeBridge {
  ready(): boolean;
  pcLights(): PcLightsState;
}

declare global {
  interface Window {
    __homeBridge?: HomeBridge;
  }
}

// Top frame only, install once.
if (!window.__homeBridge && window.top === window) {
  // Walk open shadow roots as well as the light DOM - the Home app is deep web components.
  const deepQuery = (root: Document | ShadowRoot | Element, selector: string): Element[] => {
    const out: Element[] = [];
    const walk = (node: Document | ShadowRoot | Element): void => {
      try {
        out.push(...node.querySelectorAll(selector));
      } catch {
        // A selector a particular root rejects; skip it.
      }
      for (const kid of node.querySelectorAll('*')) {
        if (kid.shadowRoot) walk(kid.shadowRoot);
      }
    };
    walk(root);
    return out;
  };

  // Close any onboarding or survey card covering the grid. Scoped to dialog roots, so a normal
  // "Done"/"OK" button elsewhere on the page is left alone.
  const dismissCards = (): void => {
    for (const overlay of deepQuery(document, '[role="dialog"],[role="alertdialog"]')) {
      for (const button of overlay.querySelectorAll<HTMLElement>('button,[role="button"]')) {
        const label = `${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`;
        if (DISMISS_TEXT.test((button.textContent ?? '').trim()) || /\b(close|dismiss)\b/i.test(label)) {
          button.click();
        }
      }
    }
  };

  // The tile card: the sizeable clickable ancestor of the device-name label.
  const deviceCard = (name: string): HTMLElement | null => {
    const label = deepQuery(document, '*').find(
      (el) => el.children.length === 0 && (el.textContent ?? '').trim() === name,
    );
    for (let node = label?.parentElement ?? null; node; node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      if (rect.width > CARD_MIN_W && rect.height > CARD_MIN_H) return node;
    }
    return null;
  };

  // The tile prints its own state on its own line - the reliable signal (its lit appearance is not:
  // an interacted tile keeps a bright focus highlight that looks "on" whatever the real state). Read
  // it via innerText, where the lines are space-separated; textContent glues them ("PC LightsOff"),
  // where a word boundary never matches. Off wins over On, since an "on" tile may also read "On •
  // 100%" but only an off one says "Off". null until the state word has loaded in.
  const cardText = (card: HTMLElement): string => card.innerText.replace(/\s+/g, ' ').trim();
  const stateOf = (text: string): boolean | null =>
    /\boff\b/i.test(text) ? false : /\bon\b/i.test(text) ? true : null;

  const measure = (): PcLightsState => {
    dismissCards();
    const card = deviceCard(DEVICE);
    if (!card) return PcLightsState.parse({ found: false });
    card.scrollIntoView({ block: 'center' }); // bring it into the hidden view so the click lands
    const rect = card.getBoundingClientRect();
    const text = cardText(card);
    return PcLightsState.parse({
      found: true,
      name: DEVICE,
      on: stateOf(text),
      text,
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2),
    });
  };

  window.__homeBridge = {
    ready: (): boolean => {
      dismissCards(); // an onboarding overlay mustn't hold the readiness gate false
      const card = deviceCard(DEVICE);
      return card !== null && stateOf(cardText(card)) !== null; // wait for the device state to load
    },
    pcLights: (): PcLightsState => measure(),
  };
}
