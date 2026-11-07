import type { createEmitter } from "./emitter.ts";
import { type GlicHostEvent, GlicHostEventKind } from "./glic-events.ts";
import type { GlicState } from "./glic-state.ts";
import type { Logger } from "./ports.ts";
import type { GlicProtocolMap } from "./protocols/glic.ts";
import type { SessionSource } from "./session-link.ts";
import { decideGlicPermission, isGoogleNavigation } from "./web-host/policies.ts";
import { createWebHost, RecoveryFailure } from "./web-host/web-host.ts";
import type { WebViewFactory } from "./web-host/web-view-port.ts";
import { LiveStatus } from "@/contracts/live-engine.ts";

export const GLIC_URL = "https://gemini.google.com/glic";
export const SEND_TIMEOUT_MS = 3000;
// The page waits up to 6 s for its text box, and up to 30 s for an answer plus a few settles
export const SUBMIT_TIMEOUT_MS = 45_000;

export function createGlicWebHost({ factory, bridgeScript, link, state, events, log, now, isDebugging }: {
  factory: WebViewFactory;
  bridgeScript: string;
  link: SessionSource;
  state: GlicState;
  events: ReturnType<typeof createEmitter<GlicHostEvent>>;
  log: Logger;
  now: () => number;
  isDebugging: boolean;
}) {
  return createWebHost<GlicProtocolMap>({
    name: "glic",
    factory,
    bridgeScript,
    messageTimeoutMs: SUBMIT_TIMEOUT_MS,
    isDebugging,
    isNavigationAllowed: isGoogleNavigation,
    decidePermission: decideGlicPermission,
    log,
    now,
    onCoreReady(core) {
      state.isBooted = false;
      log.write(`glic: ${state.session.length} saved Google cookies, extension connected=${link.isExtensionConnected}`);
      core.setCookies(state.session);
      core.navigate(GLIC_URL);
    },
    onRecovering() {
      state.isBooted = false;
      events.emit({
        kind: GlicHostEventKind.notice,
        notice: LiveStatus.reconnecting
      });
    },
    onRecoveryFailed({ reason, cause }) {
      state.ready.reject(cause ?? new Error("Gemini keeps crashing."));
      events.emit({
        kind: GlicHostEventKind.failed,
        message: reason === RecoveryFailure.crashLoop ? "Gemini keeps crashing; try again shortly." : "Couldn't restart Gemini."
      });
    }
  });
}

export type GlicWebHost = ReturnType<typeof createGlicWebHost>;
