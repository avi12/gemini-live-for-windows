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

## Keep / Tasks / Gmail / Home, verified 2026-10-06 (own headless Edge, port 9444)

Same recipe as Evidence above: the DPAPI-decrypted session (`%LOCALAPPDATA%\GeminiLive\google-session.bin`,
CurrentUser scope, no entropy) seeded via CDP `Network.setCookies`, `RotateCookies` blocked with
`Fetch.failRequest`, the bridge injected at document-start, then `/glic` **reloaded**. Reloading matters:
without the host handshake (`registerWebClient` → `initialize(host)`) the page is a dead zero-state
("Type @ to add tabs") and the composer's Submit silently does nothing. Once the bridge boots, the
conversation greets "Hello, You" and text turns submit. Read-only turns; one write per app was triggered
only to read its card button, then **Cancelled** - nothing was created or sent (re-reads confirmed).

| App | Text path | Notes |
|---|---|---|
| **Keep** | **Yes** | Read real notes (incl. a long Hebrew note). Write shows a confirmation card. |
| **Tasks** | **Yes** | Read real active + completed tasks. Write shows a confirmation card. |
| **Gmail** | **Read yes, send no** | Summarised real unread emails. Compose+send is refused: "I cannot send emails on your behalf." No send card is offered. |
| **Home** | **No** | "I don't have access to your real-time smart home device registry or API status." It only infers devices from past chat memory - no live state, no device card. Unsupported on this path. Re-checked 2026-10-06 on `/app` text too: "unable to retrieve the real-time status" (a bare "is my AC on?" got a "yes" guessed from chat history). The account's web Connected Apps page (`/apps`) lists no Google Home at all, and a Glic text turn "Turn off the AC lights" hung in a tool call until stopped. So Home (and alarms/timers) no longer take the text path: Live answers them itself. Re-add them to `AppTopic` when `/apps` lists Google Home. |

### Confirmation card labels (the load-bearing fix)

Keep and Tasks write cards are **one shared Material component**, and its buttons carry **generic
aria-labels**, not the visible verb:

- primary: `aria-label="Button that confirms actions."` · visible text **"Add"** · `data-test-id="add-confirmation-button"` · class `confirmation-button`
- cancel: `aria-label="Button that cancels actions."` · visible text "Cancel" · `cancel-confirmation-button`

`clickButton` matches on **aria-label**, so the old `ACTION_CONFIRM` (`'Add','Save','Create',…` = the
*visible* text) never matched this card. Worse, its bare `'Add'` matched the always-present composer
button `"Add tabs. Press Enter to activate"`, so `submitAndRead` auto-clicked "Add tabs" on every turn.

Changes to `glic_bridge.js`:

- **`ACTION_CONFIRM`** now leads with `'Button that confirms actions'` (the generic confirm aria-label
  - covers every app on this shared card), then specific legacy verbs (`Add event`, `Add Event`,
  `Create`, `Save`, `Remove`, `Delete`, `Update`, `Confirm`). Dropped the over-generic
  `Add`/`Yes`/`Done`/`Send`/`Turn on`/`Turn off` (e.g. `Turn on` would hit `"Turn on live captions"`).
  Verified live against a real card: `findButton` picks the confirm button, never "Add tabs" or Cancel.
- **`lastReplyText`** now prefers the whole `.presented-response-container` (stripping the "Gemini said"
  a11y prefix), falling back to the old inner-node selector. App result cards render as embedded
  siblings of the inner `.markdown`, so the old selector returned only the "Here are your Google Keep
  notes:" preamble (~32 chars); the new one returned the full 1692-char note.

Calendar's legacy labels ("Add Event"/"Remove") are kept as fallbacks but were not re-checked today -
they may be this same shared generic card now. Home is unsupported, so no device/toggle label exists.

## Google Home through Gemini: what exists (2026-10-06)

Requirement: the app stays independent (no phone), Home goes through Gemini's own tools, and nothing
impersonates Google's apps. Findings:

- **Web client is ready, server isn't.** The Glic bundle renders app-result type **30** as a Home device
  list (`action.devices.types.*` → icon map, fallback `home_iot_device`) and type **4** as camera events.
  The server never sends them to this account: `/apps` (Connected Apps) lists Workspace, YouTube, Maps
  and third-party apps but no Google Home, and Google's help says Home "isn't available in the Gemini
  web app". Expect it to appear there first; then add Home words back to `AppTopic`.
- **Per-request tool slot doesn't unlock it.** StreamGenerate inner slot 8 is the composer's single tool
  pick, `[[mode, null, toolName]]` (e.g. `browser_agent`). Forcing `google_home` / `smart_home` /
  `home_automation` / `google_home_tool` (modes 0 and 3) is silently ignored: live-only questions (room
  temperature, TV volume) all got "can't access". A "24°C" answer was recalled from chat memory, not read.
- **Flag `45761586`** (`generic_calendar, generic_reminders, notes_and_lists, google_home`) only feeds
  analytics VE metadata.
- **Ask Home** (Home for web's Gemini agent, `GenAiHomeAgentService/ProcessQuery` type 8) is Gemini on the
  web, but "isn't available in your home yet" - Google lists it for US/CA/UK/IE/AU/NZ (early access in
  more countries), not Israel.
- **Robin** gets Home by advertising `GOOGLE_HOME_EXTENSION_IN_LIVE(311)`, but only with tokens minted for
  Google's signed Android app - off limits. Google Home APIs (incl. Gemini features) are Android/iOS SDKs.
  The Assistant SDK is the retiring Assistant, not Gemini.
- Verified on the phone that Gemini (Robin) itself answers Home correctly ("AC is on, 24°C, cool"), so
  the account and devices are fine; only the surface is missing.
