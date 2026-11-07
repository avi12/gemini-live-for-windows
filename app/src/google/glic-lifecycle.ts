import { fingerprint, hasSession, type SessionStore } from "./cookies.ts";
import { createDeferred } from "./emitter.ts";
import type { GlicCommands } from "./glic-commands.ts";
import type { GlicSession } from "./glic-session.ts";
import type { GlicState } from "./glic-state.ts";
import type { GlicWebHost } from "./glic-web-host.ts";
import type { Logger } from "./ports.ts";
import { errorMessage } from "@/lib/error-message.ts";

// Warming the page up, starting and stopping Live on it
export function createGlicLifecycle({ state, webHost, session, commands, store, log }: {
  state: GlicState;
  webHost: GlicWebHost;
  session: GlicSession;
  commands: GlicCommands;
  store: SessionStore;
  log: Logger;
}) {
  // Boots the engine at app start with the saved session, so the first use doesn't wait for Chromium
  async function warmUp() {
    state.session = await store.load();
    state.sessionPrint = fingerprint(state.session);
    await webHost.ensureCore();
  }

  // Starts Live; completes once Gemini is actually listening. No timeout: the page reports its own
  // start failure, and waiting for the browser's Google session can legitimately take a while.
  function start() {
    state.isActive = true;
    state.ready = createDeferred<void>();
    const pending = state.ready.promise;
    if (!webHost.core) {
      // a crash recovery gave up earlier; this is the retry. Navigation, then Booted, starts Live
      webHost.ensureCore().catch(error => {
        log.write(`glic: rebuild failed: ${errorMessage(error)}`);
        state.ready.reject(error instanceof Error ? error : new Error(errorMessage(error)));
      });
    } else if (state.isUnavailable || !hasSession(state.session)) {
      session.waitForSession();
    } else if (state.isBooted) {
      void commands.sendStart();
    }

    return pending;
  }

  function stop() {
    state.isActive = false;
    state.ready.reject(new Error("stopped"));
    return commands.sendStop();
  }

  // The page's own microphone id (null = Windows' default); re-applied on every page load
  function setMicrophone(id: string | null) {
    state.microphoneId = id;
    return commands.sendMic(id);
  }

  return {
    warmUp,
    start,
    stop,
    setMicrophone
  };
}
