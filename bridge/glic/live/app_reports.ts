// What the page reports to the app (GlicHost). The app may be gone - no WebView2, or it is closing -
// so a report that fails is dropped.
import type { Messenger } from "@gemini-live/messaging";

import { ErrorMessage, GlicMessage, type GlicProtocolMap, type State, type TranscriptLine } from "@/glic/glic_protocol";
import { isSignedOut } from "@/glic/page/glic_page";

/** Sends a report to C#, which may be gone (no WebView2, or the app is closing): drops a failure. */
function report(sent: Promise<void>) {
  sent.catch(() => {});
}

export function appReports(app: Messenger<GlicProtocolMap>) {
  /** Last state sent to C#, to send only changes. */
  let lastState: State | null = null;

  function error(message: ErrorMessage) {
    report(app.sendMessage(GlicMessage.ERROR, message));
  }

  return {
    booted: () => report(app.sendMessage(GlicMessage.BOOTED)),
    ready: () => report(app.sendMessage(GlicMessage.READY)),
    transcript: (line: TranscriptLine) => report(app.sendMessage(GlicMessage.TRANSCRIPT, line)),
    diagnostic: (text: string) => report(app.sendMessage(GlicMessage.DIAGNOSTIC, text)),
    error,
    /** Reports a failed start, preferring "signed-out" so the host can wait for a session. */
    startFailure(fallback: ErrorMessage) {
      error(isSignedOut() ? ErrorMessage.SIGNED_OUT : fallback);
    },
    state(state: State) {
      if (lastState === state) {
        return;
      }

      lastState = state;
      report(app.sendMessage(GlicMessage.STATE, state));
    },
    /** Forgets the last state sent, so the next one goes out even if it is the same. */
    forgetState() {
      lastState = null;
    }
  };
}

export type AppReports = ReturnType<typeof appReports>;
