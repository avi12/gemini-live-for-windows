import type { createEmitter } from "@/google/emitter.ts";
import { type GlicHostEvent, GlicHostEventKind } from "@/google/glic/glic-events.ts";
import type { GlicState } from "@/google/glic/glic-state.ts";
import type { SessionSource } from "@/google/session/session-link.ts";

const REFRESH_GRACE_MS = 25_000;

const SessionNotice = {
  REFRESHING: "Refreshing your Google session…",
  SIGN_IN: "Sign in to Google in your browser",
  WAITING_FOR_BROWSER: "Waiting for your browser…",
  SETUP: "One-time setup"
} as const;

export function sessionNoticeFor({
  isConnected,
  isInstalled,
  isStale
}: {
  isConnected: boolean;
  isInstalled: boolean;
  isStale: boolean;
}) {
  if (isConnected) {
    return isStale ? SessionNotice.REFRESHING : SessionNotice.SIGN_IN;
  }

  return isInstalled ? SessionNotice.WAITING_FOR_BROWSER : SessionNotice.SETUP;
}

// No usable session yet: say why, and ask the extension for a fresh one
export function createSessionWaiter({
  state,
  link,
  events
}: {
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
      kind: GlicHostEventKind.NOTICE,
      notice: sessionNoticeFor({
        isConnected,
        isInstalled,
        isStale
      })
    });
    events.emit({
      kind: GlicHostEventKind.EXTENSION_NEEDED,
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
          kind: GlicHostEventKind.NOTICE,
          notice: SessionNotice.SIGN_IN
        });
      }
    }, REFRESH_GRACE_MS);
  };
}
