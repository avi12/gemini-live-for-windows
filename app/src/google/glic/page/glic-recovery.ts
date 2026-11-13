import { LiveStatus } from "@/contracts/live-engine.ts";
import type { createEmitter } from "@/google/emitter.ts";
import { type GlicHostEvent, GlicHostEventKind } from "@/google/glic/glic-events.ts";
import type { GlicState } from "@/google/glic/glic-state.ts";
import { GLIC_URL, type GlicWebHost } from "@/google/glic/glic-web-host.ts";
import type { GlicSession } from "@/google/glic/session/glic-session.ts";
import type { Logger } from "@/google/ports.ts";
import { PageError } from "@/google/protocols/glic.ts";

// A broken Live is reloaded into a new conversation, but a page that keeps breaking is given up on
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 600_000;

export function pageErrorOf(message: string) {
  return Object.values(PageError).find(error => error === message);
}

// Live broke and Glic's own Try again didn't bring it back: reload the page, whose Booted starts
// Live again since the session is still active. False once the restart budget is spent.
function createRestarter({
  state,
  webHost,
  events,
  log,
  now
}: {
  state: GlicState;
  webHost: GlicWebHost;
  events: ReturnType<typeof createEmitter<GlicHostEvent>>;
  log: Logger;
  now: () => number;
}) {
  const restarts: number[] = [];

  return function tryRestart() {
    const moment = now();
    while (restarts.length > 0 && moment - (restarts[0] ?? moment) > RESTART_WINDOW_MS) {
      restarts.shift();
    }

    const core = webHost.core;
    const isOutOfRestarts = restarts.length >= MAX_RESTARTS || !core;
    if (isOutOfRestarts) {
      return false;
    }

    restarts.push(moment);
    log.write(`glic: Live broke, reloading (${restarts.length}/${MAX_RESTARTS})`);
    events.emit({
      kind: GlicHostEventKind.NOTICE,
      notice: LiveStatus.RECONNECTING
    });
    state.isBooted = false;
    core.navigate(GLIC_URL);
    return true;
  };
}

// What the host does when the page reports an error
export function createGlicRecovery({
  state,
  webHost,
  session,
  events,
  log,
  now
}: {
  state: GlicState;
  webHost: GlicWebHost;
  session: GlicSession;
  events: ReturnType<typeof createEmitter<GlicHostEvent>>;
  log: Logger;
  now: () => number;
}) {
  const tryRestart = createRestarter({
    state,
    webHost,
    events,
    log,
    now
  });

  function onPageError(received: string | null) {
    const message = received ?? "Gemini error";
    log.write(`glic error: ${message}`);
    const error = pageErrorOf(message);
    // Signed out or a stale session: get the browser's current one
    const isSessionProblem = error === PageError.SIGNED_OUT || error === PageError.UNAVAILABLE;
    if (isSessionProblem) {
      state.isUnavailable = true;
      session.waitForSession();
      return;
    }

    if (!state.isActive) {
      return;
    }

    const isRestarted = error === PageError.LIVE_BROKE && tryRestart();
    if (isRestarted) {
      return;
    }

    const shown = error === PageError.LIVE_BROKE ? "Gemini Live stopped working" : message;
    state.ready.reject(new Error(shown));
    events.emit({
      kind: GlicHostEventKind.FAILED,
      message: shown
    });
  }

  return { onPageError };
}
