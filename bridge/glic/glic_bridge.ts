// Injected at document-start into gemini.google.com/glic inside our WebView2 (bundled to
// glic_bridge.js by build.mjs).
//
// Ported from agentic-gaming-assistant/src-tauri/bridges/gemini_voice_bridge.ts (RE notes in that
// repo: reverse-engineering/gemini/GLIC-FINDINGS.md). "Glic" is Gemini in Chrome: the real, signed-in
// gemini.google.com/glic web app, which runs the WHOLE Live loop itself - mic via getUserMedia (with
// Chromium's echo canceller), the Live session to geminiweb-pa.../v1/processSession, Gemini's native
// voice out. We hand it the "host" object Chrome normally would (host/glic_host.ts), whose getters
// include the viewport screenshots Live pulls while sharing, which we fetch from the C# side
// (ScreenGrabber).
//
// Wire to C#: the typed messenger (GlicProtocolMap in glic_protocol.ts) over chrome.webview. The page
// reports to GlicHost and asks it for frames and screen text; GlicHost sends the session commands.
//
// This file installs the parts in a fixed order, before Glic's own scripts run: page visibility,
// the tones, the microphone, the host and its bootstrap, then the Live wire tap. Live control - the
// session's state and the start, keep-alive and stop - is live/live_control.ts, and the commands
// from C# go to it.

import { installBootstrap } from "@/glic/host/bootstrap";
import { createGlicHost } from "@/glic/host/glic_host";
import { appReports } from "@/glic/live/app_reports";
import { createLiveControl } from "@/glic/live/live_control";
import { muteTones } from "@/glic/live/tone_gate";
import { installDesktopMic } from "@/glic/mic/desktop_mic";
import { keepPageVisible, pageSays, Phrase } from "@/glic/page/glic_page";
import { submitAndRead } from "@/glic/page/text_action";
import { readCaptions } from "@/glic/transcript/captions";
import { tapLiveTranscript } from "@/glic/transcript/live_wire";
import { transcriptRelay } from "@/glic/transcript/transcript";
import { BridgeFlag, claimTopWindow } from "@/shared/install_once";
import { connectToApp } from "@/shared/webview_transport";

import { ErrorMessage, GlicMessage, type GlicProtocolMap, State } from "./glic_protocol";

const REQUEST_TIMEOUT_MS = 3000;
const UNAVAILABLE_POLL_MS = 500;
if (claimTopWindow(BridgeFlag.GLIC)) {
  const app = connectToApp<GlicProtocolMap>(REQUEST_TIMEOUT_MS);
  const reports = appReports(app);

  /** The stale-session page was seen and reported; nothing will start until a reload. */
  let isUnavailableReported = false;

  // ===========================================================================
  // Patches that must be in place before Glic's scripts run. The parts that ask whether Live is
  // running read it from `live`, created below; none of them asks before Glic's scripts run.
  // ===========================================================================

  keepPageVisible();
  const tones = muteTones();

  const mic = installDesktopMic(() => live.reopenMic());

  const glic = createGlicHost({
    isActive: () => live.isActive(),
    capture: () => app.sendMessage(GlicMessage.CAPTURE).catch(() => null),
    read: () => app.sendMessage(GlicMessage.READ).catch(() => null),
    onClosePanel: () => reports.state(State.IDLE)
  });

  const tryBootstrap = installBootstrap({
    host: glic.host,
    events: {
      onBooted: () => reports.booted(),
      onFailed: () => reports.startFailure(ErrorMessage.PAGE_DID_NOT_START)
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
    reports.error(ErrorMessage.UNAVAILABLE);
  }, UNAVAILABLE_POLL_MS);

  const transcript = transcriptRelay(line => reports.transcript(line));
  const wire = tapLiveTranscript((index, utterance) => {
    if (live.isActive()) {
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

  const live = createLiveControl({
    reports,
    refreshScreen: now => glic.refreshScreen(now),
    pumpCaptions,
    wire,
    transcript,
    tryBootstrap,
    tones,
    isUnavailableReported: () => isUnavailableReported
  });

  // ===========================================================================
  // Commands from GlicHost.
  // ===========================================================================

  app.onMessage(GlicMessage.START, () => live.startCommand());
  app.onMessage(GlicMessage.STOP, () => live.stopCommand());
  app.onMessage(GlicMessage.SET_MUTED, ({ data }) => mic.setMuted(data));
  app.onMessage(GlicMessage.LIST_MICS, () => mic.listMics());
  app.onMessage(GlicMessage.SET_MIC, ({ data }) => mic.setMic(data));
  app.onMessage(GlicMessage.BEGIN_ACTION, () => live.beginAction());
  app.onMessage(GlicMessage.SUBMIT_AND_READ, () => submitAndRead());
}
