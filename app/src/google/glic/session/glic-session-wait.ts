import type { createEmitter } from "@/google/emitter.ts";
import { type GlicHostEvent, GlicHostEventKind } from "@/google/glic/glic-events.ts";
import type { GlicState } from "@/google/glic/glic-state.ts";
import type { SessionSource } from "@/google/session/session-link.ts";

const REFRESH_GRACE_MS = 25_000;

const SessionNotice = {
  refreshing: "Refreshing your Google session…",
  signIn: "Sign in to Google in your browser",
  waitingForBrowser: "Waiting for your browser…",
  setup: "One-time setup"
} as const;

export function sessionNoticeFor({ isConnected, isInstalled, isStale }: {
  isConnected: boolean;
  isInstalled: boolean;
  isStale: boolean;
}) {
  if (isConnected) {
    return isStale ? SessionNotice.refreshing : SessionNotice.signIn;
  }

  return isInstalled ? SessionNotice.waitingForBrowser : SessionNotice.setup;
}

// No usable session yet: say why, and ask the extension for a fresh one
export function createSessionWaiter({ state, link, events }: {
  state: GlicState;
  link: SessionSource;
  events: ReturnType<typeof createEmitter<GlicHostEvent>>;
}) {
  return function waitForSession() {
    if (!state.isActive) {
      return;
    }

    const isConnected = link.isExtensionConnected;
    // A saved session only ever comes from the extension, so having one means it's installed: it
    // is just asleep or the browser is closed
    const isInstalled = isConnected || state.session.length > 0;
    // Holding a session that failed means it went stale: Google's pages keep it fresh only while
    // they run, so have the browser refresh it. Usually that's all a "sign in" needs.
    const isStale = state.session.length > 0;
    events.emit({
      kind: GlicHostEventKind.notice,
      notice: sessionNoticeFor({
        isConnected,
        isInstalled,
        isStale
      })
    });
    events.emit({
      kind: GlicHostEventKind.extensionNeeded,
      isNeeded: !isInstalled
    });

    if (!isStale) {
      link.requestCookies();
      return;
    }

    link.requestRefresh();
    // The extension's refresh page runs ~15 s; still failing after that means really signed out
    setTimeout(() => {
      const isStillSignedOut = state.isActive && state.isUnavailable;
      if (isStillSignedOut) {
        events.emit({
          kind: GlicHostEventKind.notice,
          notice: SessionNotice.signIn
        });
      }
    }, REFRESH_GRACE_MS);
  };
}
