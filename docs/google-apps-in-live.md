# Google apps (Calendar, Keep, Tasks, Gmail) from Gemini Live

Investigated 2026-10-06 against the live `gemini.google.com/glic` build
(`BardChatUi.en_US.0hoJcIFXMQI.2018`), signed in with the app's saved session in a separate
headless Edge (own profile, port 9444, `RotateCookies` blocked). The app's WebView2 / port 9333 were
not touched.

## Verdict

| Surface (same page, same bridge, same account) | Google apps? |
|---|---|
| Glic **text** turn | **Yes.** "Connected to Google Calendar": read events, created and deleted an event |
| Glic **Live** turn | **No.** "I don't have access to your personal Google Calendar" (sometimes stalls on "Let me take a look...") |

Nothing the host controls turns apps on in Live. The Live backend (`geminiweb-pa/v1/processSession`)
just isn't given the Workspace tools for this client. **Fix: a hybrid.** Pause Live, run the request
as a text turn in the *same* Glic conversation, then resume Live. Proven end to end (see Evidence).

## What gates it (and what doesn't)

- **Host capabilities.** Our `[3,7,8]` = `MULTI_INSTANCE, PDF_ZERO_STATE, INVOKE` (Chromium
  `glic_api_generated.ts` `HostCapability`, 0..19). No capability names apps or connectors. Glic's
  own dev fake host uses `[3,7,8,2,14,12]` and Chrome `150`. Switching to Chrome 150 and
  `[2,3,7,8,12,14,16,17,18]` did not change the Live answer or the Live setup message.
- **Live setup message** (first `processSession` frame):
  `[[2,"<modeId>","en"],ts,…,[null,null,[[4,28,1,3],[4,1]],[uuid]],null,[]]`, then context frames
  for location, focused tab and audio config. It has no tools, extensions or apps field, and nothing
  derived from host capabilities or the Chrome version.
- **Apps are server-side and account-scoped.** The bundle knows the tool ids (`google_calendar`,
  `keep`, `reminder`, `workspace_tool`, `gmail_bard`, `google_reminders`, …) only for the
  "Apps" list UI and server flags (`45761586`, …). The text path turns them on per request on the
  server. The account already has them on, because text works with no change.
- **`CHROME_TOOLS` (16) is text-only too.** A host `tools()` with `getChromeTools` / `executeTool` is
  loaded by `GlicToolsService` and attached to *text* requests (`ClientFunctionCallOpExecutor`). In
  Live, a test tool `get_secret_word` was fetched but never called, and Live web-searched instead.
  (Not used by this fix. It could later let our app run actions natively from text turns.)

## Evidence (headless Edge, our bridge)

1. Text: "What is on my Google Calendar tomorrow?" returned the 2 real events plus a Calendar card.
2. Live (spoken via an injected AudioContext mic): the same question got "I don't have access to
   your personal Google Calendar". Same result with v150 and extra capabilities.
3. Hybrid: `__glicBridge.stop()` (switches to text mode; the Live turns are now in the same
   conversation), then a text turn read the Calendar, then `start()`. Asked by voice "What meeting did
   you just find for me tomorrow?", Live answered "Meeting with Danit at 11:00". **Live sees the text
   turn's result.** It does not see card-only fields such as the location.
4. Write path: a text turn "Create a Google Calendar event titled CLAUDE TEST delete me…" showed a
   confirmation card (**Add Event** / Cancel). Clicking it created the event. "Delete…" showed
   **Remove**, clicking it deleted the event, and a follow-up listing confirmed it was gone.

## Change to make (hybrid, same page)

**C# (`GlicConversation` / `GlicHost`)**
1. **Detect** an action in the Live transcript the bridge already relays (`transcript`, `dir:"user"`):
   - an intent regex on the user utterance: schedule / meeting / event / calendar / remind / reminder /
     task / to-do / note / list / Keep / email / Gmail / inbox; and
   - a fallback on Gemini's refusal text: `don't have (access|the ability)` combined with
     calendar / reminder / schedule / note / email, or a "Let me take a look…" with no follow-up
     after a timeout.
2. **Run** `runAction(utterance)` in the bridge (below), then resume Live.
3. **Say the result.** Live has no text input and will not speak on resume by itself. Either show
   and speak the turn's reply text with the app's own voice, or just resume and let the user follow up
   ("what did you add?"). Live already knows the result.

**Bridge (`glic_bridge.js`)**: add `runAction(prompt)`, exposed on `window.__glicBridge`:
1. `stop()` (clicks "Switch to text mode", sets `active=false` so the monitor won't resume).
2. Wait for `[contenteditable=true]`.
3. Type the prompt. **It must be trusted input:** `execCommand('insertText')` / synthetic
   `InputEvent` fill the box but do not enable **Submit**. Real key events do. From C#, focus the
   editor, then call `CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", {type:"keyDown",text:ch})`
   for each character (proven). `Input.insertText` alone did not work.
4. Click `button[aria-label="Submit"]`. Wait until the last "Gemini said" block is stable and has a
   "Copy" button.
5. If a confirmation card appears, click its primary button. Seen: **Add Event**, **Remove**. Expect
   similar ones for Tasks and Keep. The user asked for it by voice, so auto-confirm, or make
   that a setting.
6. Return the last reply text, then `start()`.

Cost: Live pauses for roughly 10-25 s per action (stop, text turn, restart). Captions keep the history.

## Remaining unknowns

- Keep, Tasks, Gmail and Reminders were not exercised. Only Calendar (read, create, delete) was
  proven. Their confirmation button labels are unknown.
- Whether a **second** hidden page could run the text turn in the *same* conversation (avoiding the
  Live pause). This is untested. A separate conversation would not feed Live's context.
- The setup list `[[4,28,1,3],[4,1]]` is unmapped. A future server flag could give Live tools
  natively, so re-test Live after Glic build bumps.
- The Robin path (`robinfrontend-pa`) was not assessed. The hybrid works, so it was not needed.
