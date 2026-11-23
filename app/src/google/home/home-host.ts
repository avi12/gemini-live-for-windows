import type { Logger } from "@/google/ports.ts";
import type { HomeProtocolMap } from "@/google/protocols/home.ts";
import type { SessionStore } from "@/google/session/cookies.ts";
import type { SessionSource } from "@/google/session/session-link.ts";
import { decideHiddenPagePermission, isGoogleNavigation } from "@/google/web-host/guards/policies.ts";
import { delay } from "@/google/web-host/timeout.ts";
import { createWebHost } from "@/google/web-host/web-host.ts";
import type { WebViewFactory } from "@/google/web-host/web-view-port.ts";
import { errorMessage } from "@/lib/error-message.ts";

import { createHomePage, type HomeWebHost, SETTLE_MS } from "./home-page.ts";
import { switchLights } from "./lights.ts";

const HOME_URL = "https://home.google.com/";
const SIGNED_IN_PREFIX = `${HOME_URL}home`;
// Readiness is polled while the page loads, when messages are dropped; fail fast and poll again
const MESSAGE_TIMEOUT_MS = 1000;

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
    decidePermission: decideHiddenPagePermission,
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
