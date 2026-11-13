// Injected at document-start into gemini.google.com/glic inside our WebView2 (bundled to
// glic_bridge.js by build.mjs).
//
// Ported from agentic-gaming-assistant/src-tauri/bridges/gemini_voice_bridge.ts (RE notes in that
// repo: reverse-engineering/gemini/GLIC-FINDINGS.md). "Glic" is Gemini in Chrome: the real, signed-in
// gemini.google.com/glic web app, which runs the WHOLE Live loop itself - mic via getUserMedia (with
// Chromium's echo canceller), the Live session to geminiweb-pa.../v1/processSession, Gemini's native
// voice out. We hand it the "host" object Chrome normally would (glic_host.ts), whose getters
// include the viewport screenshots Live pulls while sharing, which we fetch from the C# side
// (ScreenGrabber).
//
// Wire to C#: the typed messenger (GlicProtocolMap in glic_protocol.ts) over chrome.webview. The page
// reports to GlicHost and asks it for frames and screen text; GlicHost sends the session commands.
//
// This file holds the session - its state, Live control and the commands - and installs the rest
// in a fixed order, before Glic's own scripts run: page visibility, the microphone, the host and
// its bootstrap, then the Live wire tap.

import { defineMessaging } from "@gemini-live/messaging";

import { webViewTransport } from "../shared/webview_transport";
import { readCaptions } from "./captions";
import { installDesktopMic } from "./desktop_mic";
import { createGlicHost, installBootstrap } from "./glic_host";
import {
  Button,
  clickButton,
  findButton,
  findButtonByText,
  isSignedOut,
  keepPageVisible,
  pageSays,
  Phrase,
  RESUME_BUTTONS
} from "./glic_page";
import { ErrorMessage, GlicMessage, type GlicProtocolMap, State } from "./glic_protocol";
import { patchLiveTimeouts } from "./live_timeouts";
import { tapLiveTranscript } from "./live_wire";
import { openTextEditor, submitAndRead } from "./text_action";
import { transcriptRelay } from "./transcript";

const REQUEST_TIMEOUT_MS = 3000;
const UNAVAILABLE_POLL_MS = 500;
const START_POLL_MS = 300;
const MAX_START_TRIES = 100;
const MONITOR_POLL_MS = 300;
// Glic pauses Live by itself (idle timeouts, a turn it treats as finished). Only the user ends a
// session here - Win+C or X - so unpause straight away, backing off up to a cap but never giving
// up: a pause only ever means resume.
const RESUME_GAP_MS = 2000;
const MAX_RESUME_BACKOFF = 5;
// Live breaking shows "Something went wrong": press Glic's own Try again, at most this often, and
// only if Live is still broken this long after it last ran, have the host reload the page.
const TRY_AGAIN_GAP_MS = 5000;
const BROKEN_AFTER_MS = 15_000;
// Live can hang without showing anything: the user's words are transcribed, the mic keeps
// streaming, yet Gemini never answers. Pausing and resuming opens a fresh Live session.
const NO_REPLY_MS = 12_000;

declare global {
  interface Window {
    glicBridgeInstalled?: boolean;
  }
}

// Top frame only, install once.
const IS_FIRST_INSTALL_IN_TOP_WINDOW = !window.glicBridgeInstalled && window.top === window;
if (IS_FIRST_INSTALL_IN_TOP_WINDOW) {
  window.glicBridgeInstalled = true;
  const app = defineMessaging<GlicProtocolMap>(webViewTransport(), { timeoutMs: REQUEST_TIMEOUT_MS });

  // ===========================================================================
  // Session state, and reports to C#.
  // ===========================================================================

  /** The user wants Live running; screen frames flow only while it does. */
  let isSessionActive = false;
  /** The stale-session page was seen and reported; nothing will start until a reload. */
  let isUnavailableReported = false;
  /** Last state sent to C#, to send only changes. */
  let lastState: State | null = null;

  /** Sends a report to C#, which may be gone (no WebView2, or the app is closing): drops a failure. */
  function report(sent: Promise<void>) {
    sent.catch(() => {});
  }

  function reportError(message: ErrorMessage) {
    report(app.sendMessage(GlicMessage.ERROR, message));
  }

  /** Reports a failed start, preferring "signed-out" so the host can wait for a session. */
  function reportStartFailure(fallback: ErrorMessage) {
    reportError(isSignedOut() ? ErrorMessage.SIGNED_OUT : fallback);
  }

  function setState(state: State) {
    if (lastState === state) {
      return;
    }

    lastState = state;
    report(app.sendMessage(GlicMessage.STATE, state));
  }

  // ===========================================================================
  // Patches that must be in place before Glic's scripts run.
  // ===========================================================================

  keepPageVisible();

  /** Restarts a running Live, which reopens the microphone. */
  function reopenMic() {
    if (!isSessionActive) {
      return;
    }

    stop();
    start();
  }

  const mic = installDesktopMic(reopenMic);

  const glic = createGlicHost({
    isActive: () => isSessionActive,
    capture: () => app.sendMessage(GlicMessage.CAPTURE).catch(() => null),
    read: () => app.sendMessage(GlicMessage.READ).catch(() => null),
    onClosePanel: () => setState(State.IDLE)
  });

  const tryBootstrap = installBootstrap({
    host: glic.host,
    events: {
      onBooted: () => report(app.sendMessage(GlicMessage.BOOTED)),
      onFailed: () => reportStartFailure(ErrorMessage.PAGE_DID_NOT_START)
    }
  });

  // A stale Google session still loads /glic and even adopts our host, but then shows "Gemini isn't
  // available right now" (its cookie rotation 401s). Report it so the host can offer a fresh sign-in.
  const unavailableTimer = setInterval(() => {
    if (!pageSays(Phrase.UNAVAILABLE)) {
      return;
    }

    clearInterval(unavailableTimer);
    isUnavailableReported = true;
    reportError(ErrorMessage.UNAVAILABLE);
  }, UNAVAILABLE_POLL_MS);

  const transcript = transcriptRelay(line => report(app.sendMessage(GlicMessage.TRANSCRIPT, line)));
  const wire = tapLiveTranscript((index, utterance) => {
    if (isSessionActive) {
      transcript.relay(index, utterance);
    }
  });

  /** The caption scrape, only while the wire has carried no transcript. */
  function pumpCaptions() {
    if (wire.seen()) {
      return;
    }

    for (const [index, utterance] of readCaptions().entries()) {
      transcript.relay(index, utterance);
    }
  }

  // ===========================================================================
  // Live control: start, keep alive (auto-resume), stop.
  // ===========================================================================

  let lastResume = 0;
  let resumeTries = 0;
  /** When Live was last seen running. */
  let lastLive = 0;
  let lastTryAgain = 0;
  /** The unanswered words Live was last restarted for, so each restarts it once. */
  let restartedFor: number | null = null;
  /** Live breaking was reported; the host reloads us, so say it once. */
  let isBrokenReported = false;
  let isConsentAccepted = false;
  let monitorTimer: ReturnType<typeof setInterval> | undefined;
  let startTimer: ReturnType<typeof setInterval> | undefined;

  function resume(now: number) {
    if (now - lastResume < RESUME_GAP_MS * Math.min(resumeTries + 1, MAX_RESUME_BACKOFF)) {
      return;
    }

    resumeTries++;
    lastResume = now;
    clickButton(...RESUME_BUTTONS);
  }

  /** Live is running: forget any pause or breakage. */
  function markLive(now: number) {
    lastLive = now;
    resumeTries = 0;
    isBrokenReported = false;
    setState(State.LISTENING);
  }

  /** Gemini left the user's words unanswered too long: pause Live, which the monitor resumes. */
  function restartIfUnanswered(now: number) {
    const since = wire.unansweredSince();
    const isRestartUnneeded = since === null || since === restartedFor || now - since < NO_REPLY_MS;
    if (isRestartUnneeded) {
      return false;
    }

    restartedFor = since;
    return clickButton(Button.PAUSE_LIVE);
  }

  function monitorTick() {
    if (!isSessionActive) {
      return;
    }

    const now = Date.now();
    glic.refreshScreen(now);
    pumpCaptions();
    // "Your audio couldn't be heard" is Glic's own transient notice while the mic is silent - which
    // it is whenever the user mutes or just isn't talking. Glic recovers on its own when sound
    // returns, so this is never fatal; ending the session here is what made muting un-undoable.
    const wentWrong = pageSays(Phrase.WENT_WRONG);
    const isLiveRunningNormally = findButton(Button.PAUSE_LIVE) && !wentWrong && !restartIfUnanswered(now);
    if (isLiveRunningNormally) {
      markLive(now);
      return;
    }

    setState(State.RESUMING);

    const isResumable = !wentWrong && findButton(...RESUME_BUTTONS);
    if (isResumable) {
      resume(now);
      return;
    }

    // Glic's Try again is not always labelled, so match its visible text too.
    const retry = findButtonByText(Button.TRY_AGAIN);
    const isRetryDue = retry && now - lastTryAgain > TRY_AGAIN_GAP_MS;
    if (isRetryDue) {
      lastTryAgain = now;
      retry.click();
    }

    const shouldReportBroken = wentWrong && now - lastLive > BROKEN_AFTER_MS && !isBrokenReported;
    if (shouldReportBroken) {
      isBrokenReported = true;
      reportError(ErrorMessage.LIVE_BROKE);
    }
  }

  function beginMonitor() {
    if (monitorTimer !== undefined) {
      return;
    }

    monitorTimer = setInterval(monitorTick, MONITOR_POLL_MS);
  }

  // First-run surfaces: consent ("Live will use your microphone") and the volume onboarding card.
  // Pressing Win+C for Gemini Live is the user's decision to start it, so clear them.
  function advanceToLive() {
    const ok = findButton(Button.OKAY);
    const isMicConsentPrompt = ok && findButton(Button.NO_THANKS) && pageSays(Phrase.MIC_CONSENT);
    if (isMicConsentPrompt) {
      ok.click();
      isConsentAccepted = true;
      return;
    }

    const skip = findButton(Button.SKIP);
    const isCaptionsPromptSkippable = skip && findButton(Button.GO_BACK) && findButton(Button.TURN_ON_CAPTIONS);
    if (isCaptionsPromptSkippable) {
      skip.click();
      return;
    }

    const hasStartedLive = clickButton(Button.START_LIVE) || isConsentAccepted;
    if (hasStartedLive) {
      return;
    }

    clickButton(Button.GO_LIVE);
  }

  function start() {
    isSessionActive = true;
    wire.reset();
    transcript.reset();
    lastState = null;
    isConsentAccepted = false;
    resumeTries = 0;
    clearInterval(startTimer);
    let tries = 0;
    startTimer = setInterval(() => {
      // No usable session: stop quietly. The host waits for the browser's session and reloads us.
      if (!isSessionActive || isUnavailableReported) {
        clearInterval(startTimer);
        return;
      }

      const shouldRetryPatching = !patchLiveTimeouts() && tries < MAX_START_TRIES / 2;

      tryBootstrap();

      // Live must not start before its timeouts are rewritten, or it reads the defaults.
      if (shouldRetryPatching) {
        tries++;
        return;
      }

      if (findButton(Button.PAUSE_LIVE)) {
        clearInterval(startTimer);
        report(app.sendMessage(GlicMessage.READY));
        markLive(Date.now());
        beginMonitor();
        return;
      }

      advanceToLive();

      if (++tries <= MAX_START_TRIES) {
        return;
      }

      clearInterval(startTimer);
      reportStartFailure(ErrorMessage.LIVE_DID_NOT_START);
    }, START_POLL_MS);
  }

  function stop() {
    isSessionActive = false;
    clearInterval(startTimer);
    clickButton(Button.TEXT_MODE, Button.PAUSE_LIVE, Button.END);
    setState(State.IDLE);
  }

  /** Pauses Live for a Google-apps text turn (text_action.ts); C# resumes it with Start. */
  function beginAction() {
    isSessionActive = false;
    clearInterval(startTimer);
    clearInterval(monitorTimer);
    monitorTimer = undefined;
    return openTextEditor();
  }

  // ===========================================================================
  // Commands from GlicHost.
  // ===========================================================================

  app.onMessage(GlicMessage.START, () => start());
  app.onMessage(GlicMessage.STOP, () => stop());
  app.onMessage(GlicMessage.SET_MUTED, ({ data }) => mic.setMuted(data));
  app.onMessage(GlicMessage.LIST_MICS, () => mic.listMics());
  app.onMessage(GlicMessage.SET_MIC, ({ data }) => mic.setMic(data));
  app.onMessage(GlicMessage.BEGIN_ACTION, () => beginAction());
  app.onMessage(GlicMessage.SUBMIT_AND_READ, () => submitAndRead());
}
