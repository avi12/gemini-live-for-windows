// Live control: start, keep alive (auto-resume), stop, and the pause for a Google-apps text turn.
// Glic runs Live itself; this presses its buttons and watches its page.
import { ErrorMessage, State } from "@/glic/glic_protocol";
import {
  Button,
  clickButton,
  findButton,
  findButtonByText,
  pageSays,
  Phrase,
  RESUME_BUTTONS
} from "@/glic/page/glic_page";
import { openTextEditor } from "@/glic/page/text_action";

import type { AppReports } from "./app_reports";
import { patchLiveTimeouts } from "./live_timeouts";

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
// How long Live's tones may play after the user starts or ends it
const TONE_WINDOW_MS = 4000;

/** What Live control drives and watches, installed before it. */
interface LiveParts {
  reports: AppReports;
  /** Re-reads the shared screen when it is due (the Glic host). */
  refreshScreen: (now: number) => void;
  /** Relays the caption transcript while the wire carries none. */
  pumpCaptions: () => void;
  wire: {
    reset(): void;
    unansweredSince(): number | null;
  };
  transcript: { reset(): void };
  /** Offers Glic our host once more. */
  tryBootstrap: () => void;
  tones: { allowFor(milliseconds: number): void };
  /** The stale-session page was seen and reported; nothing will start until a reload. */
  isUnavailableReported: () => boolean;
}

export function createLiveControl({
  reports,
  refreshScreen,
  pumpCaptions,
  wire,
  transcript,
  tryBootstrap,
  tones,
  isUnavailableReported
}: LiveParts) {
  /** The user wants Live running; screen frames flow only while it does. */
  let isSessionActive = false;
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
  /** A text turn paused Live, and the next start only resumes it. */
  let isActionPending = false;
  let monitorTimer: ReturnType<typeof setInterval> | undefined;
  let startTimer: ReturnType<typeof setInterval> | undefined;

  function resume(now: number) {
    if (now - lastResume < RESUME_GAP_MS * Math.min(resumeTries + 1, MAX_RESUME_BACKOFF)) {
      return;
    }

    resumeTries++;
    lastResume = now;
    reports.diagnostic("resuming a pause");
    clickButton(...RESUME_BUTTONS);
  }

  /** Live is running: forget any pause or breakage. */
  function markLive(now: number) {
    lastLive = now;
    resumeTries = 0;
    isBrokenReported = false;
    reports.state(State.LISTENING);
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
    refreshScreen(now);
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

    reports.state(State.RESUMING);

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
      reports.error(ErrorMessage.LIVE_BROKE);
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
    reports.forgetState();
    isConsentAccepted = false;
    resumeTries = 0;
    clearInterval(startTimer);
    let tries = 0;
    startTimer = setInterval(() => {
      // No usable session: stop quietly. The host waits for the browser's session and reloads us.
      const isSessionUnusable = !isSessionActive || isUnavailableReported();
      if (isSessionUnusable) {
        clearInterval(startTimer);
        return;
      }

      tryBootstrap();

      const shouldRetryPatching = !patchLiveTimeouts() && tries < MAX_START_TRIES / 2;
      // Live must not start before its timeouts are rewritten, or it reads the defaults.
      if (shouldRetryPatching) {
        tries++;
        return;
      }

      if (findButton(Button.PAUSE_LIVE)) {
        clearInterval(startTimer);
        reports.ready();
        markLive(Date.now());
        beginMonitor();
        return;
      }

      advanceToLive();

      if (++tries <= MAX_START_TRIES) {
        return;
      }

      clearInterval(startTimer);
      reports.startFailure(ErrorMessage.LIVE_DID_NOT_START);
    }, START_POLL_MS);
  }

  function stop() {
    isSessionActive = false;
    clearInterval(startTimer);
    clickButton(Button.TEXT_MODE, Button.PAUSE_LIVE, Button.END);
    reports.state(State.IDLE);
  }

  return {
    /** Whether the user wants Live running. */
    isActive: () => isSessionActive,
    /** Restarts a running Live, which reopens the microphone. */
    reopenMic() {
      if (!isSessionActive) {
        return;
      }

      stop();
      start();
    },
    // The tones play for the user's own start and end; the restart after a text turn, and Live's
    // pauses that the bridge resumes, stay quiet
    /** C#'s Start: the user's, or the resume after a text turn. */
    startCommand() {
      if (!isActionPending) {
        tones.allowFor(TONE_WINDOW_MS);
      }

      isActionPending = false;
      start();
    },
    /** C#'s Stop: the user ended Live. */
    stopCommand() {
      tones.allowFor(TONE_WINDOW_MS);
      isActionPending = false;
      stop();
    },
    /** Pauses Live for a Google-apps text turn (page/text_action.ts); C# resumes it with Start. */
    beginAction() {
      isActionPending = true;
      isSessionActive = false;
      clearInterval(startTimer);
      clearInterval(monitorTimer);
      monitorTimer = undefined;
      return openTextEditor();
    }
  };
}
