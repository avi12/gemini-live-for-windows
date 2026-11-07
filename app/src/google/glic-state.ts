import { createDeferred } from "./emitter.ts";
import type { BrowserCookie } from "@gemini-live/protocol/link";

// What the glic host's parts share: the saved session, whether a session is wanted, and the
// promise Start waits on
export interface GlicState {
  session: readonly BrowserCookie[];
  sessionPrint: string;
  microphoneId: string | null;
  isActive: boolean;
  isBooted: boolean;
  isUnavailable: boolean;
  ready: ReturnType<typeof createDeferred<void>>;
}

export function createGlicState() {
  const state: GlicState = {
    session: [],
    sessionPrint: "",
    microphoneId: null,
    isActive: false,
    isBooted: false,
    isUnavailable: false,
    ready: createDeferred<void>()
  };
  return state;
}
