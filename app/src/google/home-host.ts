import { errorMessage } from "@/lib/error-message.ts";

import type { Logger } from "./ports.ts";
import { HomeMessage, type HomeProtocolMap, pcLightsSchema } from "./protocols/home.ts";
import type { SessionStore } from "./session/cookies.ts";
import type { SessionSource } from "./session/session-link.ts";
import { clickAt } from "./web-host/cdp.ts";
import { isGoogleNavigation } from "./web-host/guards/policies.ts";
import { delay } from "./web-host/timeout.ts";
import { createWebHost } from "./web-host/web-host.ts";
import type { WebViewFactory } from "./web-host/web-view-port.ts";

const HOME_URL = "https://home.google.com/";
const SIGNED_IN_PREFIX = `${HOME_URL}home`;
// Readiness is polled while the page loads, when messages are dropped; fail fast and poll again
const MESSAGE_TIMEOUT_MS = 1000;
const READY_POLL_MS = 400;
const READY_TIMEOUT_MS = 20_000;
// The tile reflects the new state
const SETTLE_MS = 1600;

const UNREACHABLE = "I couldn't reach your Google Home.";

type HomeWebHost = ReturnType<typeof createWebHost<HomeProtocolMap>>;

function onOff(isOn: boolean) {
  return isOn ? "on" : "off";
}

// Loads Home on demand with the current session and only when not already on the signed-in
// device view: first use, or after a stale session bounced the page to the welcome screen. This
// keeps the app off home.google.com in the background, where a second live Google tab could
// disturb glic's session. Brings the engine back first if a crash took it down.
async function ensureHome({ webHost, store }: { webHost: HomeWebHost; store: SessionStore }) {
  const core = await webHost.ensureCore();
  if (!core) {
    return;
  }

  core.setCookies(await store.load());

  if (core.source.startsWith(SIGNED_IN_PREFIX)) {
    return;
  }

  core.navigate(HOME_URL);
  // let the navigation start before readiness is polled
  await delay(SETTLE_MS);
}

// What the Home page's bridge answers: whether it listens yet, and the PC lights' tile
function createHomePage({ webHost, now, log }: { webHost: HomeWebHost; now: () => number; log: Logger }) {
  const { messenger } = webHost;

  // While the page is still loading the bridge isn't listening yet (no listener) or the message is
  // lost to the navigation (timeout); either just means not ready yet
  async function isReady() {
    try {
      return (await messenger.sendMessage(HomeMessage.READY)) === true;
    } catch {
      return false;
    }
  }

  async function waitReady() {
    const deadline = now() + READY_TIMEOUT_MS;
    while (now() < deadline) {
      if (!webHost.core) {
        return false;
      }

      if (await isReady()) {
        return true;
      }

      await delay(READY_POLL_MS);
    }

    return false;
  }

  async function readLights() {
    try {
      const parsed = pcLightsSchema.safeParse(await messenger.sendMessage(HomeMessage.PC_LIGHTS));
      return parsed.success ? parsed.data : undefined;
    } catch (error) {
      log.write(`home: reading the lights: ${errorMessage(error)}`);
      return undefined;
    }
  }

  return {
    waitReady,
    readLights
  };
}

type HomePage = ReturnType<typeof createHomePage>;

const FALLBACK_LIGHTS_NAME = "PC lights";

// Sets the PC lights on or off, returning a short line to speak. Reads the tile's state first, so
// an already-correct light is a no-op instead of a toggle the wrong way.
async function switchLights({
  isOn,
  webHost,
  page,
  log
}: {
  isOn: boolean;
  webHost: HomeWebHost;
  page: HomePage;
  log: Logger;
}) {
  if (!(await page.waitReady())) {
    return UNREACHABLE;
  }

  const state = await page.readLights();
  if (!state?.found) {
    return "I couldn't find the PC lights.";
  }

  const name = state.name ?? FALLBACK_LIGHTS_NAME;
  log.write(`home: ${name} text='${state.text}' on=${state.on}`);

  const isUnknown = state.on === null;
  if (isUnknown) {
    return `I couldn't tell whether the ${name} are on.`;
  }

  const isAlreadySet = state.on === isOn;
  if (isAlreadySet) {
    return `The ${name} are already ${onOff(isOn)}.`;
  }

  const core = webHost.core;
  if (!core) {
    return UNREACHABLE;
  }

  await clickAt({
    core,
    x: state.x,
    y: state.y
  });
  await delay(SETTLE_MS);
  const after = await page.readLights();
  const isUnconfirmed = !after?.found || after.on === null;
  if (isUnconfirmed) {
    return "I couldn't confirm the lights changed.";
  }

  log.write(`home: ${name} after text='${after.text}' on=${after.on}`);
  const isSwitched = after.on === isOn;
  return isSwitched ? `Turned the ${name} ${onOff(isOn)}.` : "I couldn't switch the lights.";
}

// Controls the account's Google Home devices by driving the real Home web app in a hidden WebView2,
// the same "ride the browser's Google session" approach as the glic host, for the one thing
// Gemini's text path can't reach. The page owns auth and the device graph; home_bridge.js finds a
// tile and reads its lit state when asked, and a trusted click flips it. The page is loaded on
// demand, never kept live in the background. PC lights only.
export function createHomeHost({
  factory,
  bridgeScript,
  link,
  store,
  log,
  now,
  isDebugging
}: {
  factory: WebViewFactory;
  bridgeScript: string;
  link: SessionSource;
  store: SessionStore;
  log: Logger;
  now: () => number;
  isDebugging: boolean;
}) {
  // The engine is up; the Home page itself loads on demand, so it stays blank. Home is idle most of
  // the time, so a crash has no session to resume: the next command reloads it.
  const webHost = createWebHost<HomeProtocolMap>({
    name: "home",
    factory,
    bridgeScript,
    messageTimeoutMs: MESSAGE_TIMEOUT_MS,
    isDebugging,
    isNavigationAllowed: isGoogleNavigation,
    decidePermission: undefined,
    log,
    now,
    onCoreReady(core) {
      store
        .load()
        .then(cookies => core.setCookies(cookies))
        .catch(error => log.write(`home: ${errorMessage(error)}`));
    },
    onRecovering: () => undefined,
    onRecoveryFailed: () => undefined
  });
  const page = createHomePage({
    webHost,
    now,
    log
  });

  // keep in step with the browser's session
  link.onCookies(cookies => webHost.core?.setCookies(cookies));

  return {
    warmUp: () => webHost.ensureCore(),
    async setLights(isOn: boolean) {
      await ensureHome({
        webHost,
        store
      });
      return switchLights({
        isOn,
        webHost,
        page,
        log
      });
    }
  };
}

export type HomeHost = ReturnType<typeof createHomeHost>;
