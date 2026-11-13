import { createEmitter } from "@/google/emitter.ts";
import type { Logger } from "@/google/ports.ts";
import type { SessionStore } from "@/google/session/cookies.ts";
import type { SessionSource } from "@/google/session/session-link.ts";
import type { SharedView } from "@/google/shared-view.ts";
import type { WebViewFactory } from "@/google/web-host/web-view-port.ts";

import { createGlicCommands } from "./glic-commands.ts";
import type { GlicHostEvent } from "./glic-events.ts";
import { createGlicLifecycle } from "./glic-lifecycle.ts";
import { createGlicState } from "./glic-state.ts";
import { createGlicWebHost } from "./glic-web-host.ts";
import { registerGlicPageMessages } from "./page/glic-page-messages.ts";
import { createGlicPageRequests } from "./page/glic-page-requests.ts";
import { createGlicSession } from "./session/glic-session.ts";

// Hosts the real Gemini web client (gemini.google.com/glic, what powers Gemini in Chrome) in a
// WebView2 that lives off-screen for the whole app lifetime, so starting Live needs no page load.
// The page owns mic, echo cancellation, the Live connection and Gemini's voice; the app supplies
// the frames it pulls and reads back state and captions.
//
// It is signed in with the browser's Google session, pushed by the companion extension. The
// browser is the only owner of that session: this WebView2 never rotates the cookies itself, it
// just takes each rotation the browser makes, otherwise the two copies would invalidate each other.
export function createGlicHost({
  factory,
  bridgeScript,
  link,
  store,
  view,
  log,
  now,
  isDebugging
}: {
  factory: WebViewFactory;
  bridgeScript: string;
  link: SessionSource;
  store: SessionStore;
  view: SharedView;
  log: Logger;
  now: () => number;
  isDebugging: boolean;
}) {
  const events = createEmitter<GlicHostEvent>();
  const state = createGlicState();
  const webHost = createGlicWebHost({
    factory,
    bridgeScript,
    link,
    state,
    events,
    log,
    now,
    isDebugging
  });
  const parts = {
    state,
    webHost,
    events,
    log
  };
  const commands = createGlicCommands(parts);
  const pageRequests = createGlicPageRequests(parts);
  const session = createGlicSession({
    ...parts,
    link,
    store
  });
  registerGlicPageMessages({
    ...parts,
    commands,
    session,
    view,
    now
  });
  const lifecycle = createGlicLifecycle({
    ...parts,
    session,
    commands,
    store
  });

  return {
    ...lifecycle,
    onEvent: events.subscribe,
    setMuted: commands.sendMuted,
    listMicrophones: pageRequests.listMicrophones,
    runAction: pageRequests.runAction,
    get isActive() {
      return state.isActive;
    }
  };
}

export type GlicHost = ReturnType<typeof createGlicHost>;
