import { createSessionWaiter } from "./glic-session-wait.ts";
import type { createEmitter } from "@/google/emitter.ts";
import { type GlicHostEvent, GlicHostEventKind } from "@/google/glic/glic-events.ts";
import type { GlicState } from "@/google/glic/glic-state.ts";
import { GLIC_URL, type GlicWebHost } from "@/google/glic/glic-web-host.ts";
import type { Logger } from "@/google/ports.ts";
import { fingerprint, type SessionStore } from "@/google/session/cookies.ts";
import type { SessionSource } from "@/google/session/session-link.ts";
import { errorMessage } from "@/lib/error-message.ts";
import type { BrowserCookie } from "@gemini-live/protocol/link";

// The browser's Google session as the page sees it: waiting for one, and taking each rotation
export function createGlicSession({ state, webHost, link, store, events, log }: {
  state: GlicState;
  webHost: GlicWebHost;
  link: SessionSource;
  store: SessionStore;
  events: ReturnType<typeof createEmitter<GlicHostEvent>>;
  log: Logger;
}) {
  function adoptSession(cookies: readonly BrowserCookie[]) {
    const print = fingerprint(cookies);
    const isUnchanged = print === state.sessionPrint;
    if (isUnchanged) {
      return;
    }

    state.session = cookies;
    state.sessionPrint = print;
    store.save(cookies).catch(error => log.write(`glic: saving the session failed: ${errorMessage(error)}`));

    const core = webHost.core;
    if (!core) {
      return;
    }

    core.setCookies(cookies);
    log.write("glic: session updated from the browser");

    // A page that loaded without a valid session has to start over with this one
    const isPageUsable = state.isBooted && !state.isUnavailable;
    if (isPageUsable) {
      return;
    }

    state.isUnavailable = false;
    core.navigate(GLIC_URL);
  }

  link.onCookies(adoptSession);
  link.onConnected(() => events.emit({
    kind: GlicHostEventKind.extensionNeeded,
    isNeeded: false
  }));

  return {
    waitForSession: createSessionWaiter({
      state,
      link,
      events
    })
  };
}

export type GlicSession = ReturnType<typeof createGlicSession>;
