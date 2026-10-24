// Google apps via a text turn. Live can't reach Calendar, Keep, Tasks, Gmail or Home - those tools
// are server-gated to the text path - so an action pauses Live, runs the request as a text turn in
// the SAME conversation (where the account's apps are on), auto-confirms the result card, then C#
// resumes Live, which keeps the answer in context. C# types the request with trusted CDP key
// events, because synthetic input never enables Submit.
import { Button, clickButton, findButton } from "./glic_page";
import { collapseWhitespace } from "./text";

const ACTION_READY_MS = 6000;
const EDITOR_POLL_MS = 150;
const ACTION_REPLY_MS = 30000;
const REPLY_POLL_MS = 200;
const ACTION_SETTLE_MS = 1400;
// The primary button on the confirmation card an app shows for a write; the user asked by voice,
// so auto-confirm it. clickButton matches on aria-label, and the modern shared card (verified
// live for Keep and Tasks) gives its primary button the generic aria-label
// "Button that confirms actions." while only its VISIBLE text varies ("Add"), so that aria-label
// is what we match. Its cancel button reads "Button that cancels actions.", which this never
// matches. The rest are legacy/alternate cards whose aria-label is the visible verb; each is
// specific enough not to hit an always-present composer button. A bare "Add" is deliberately
// absent: it matched "Add tabs. Press Enter to activate" and auto-clicked it on every turn.
const ACTION_CONFIRM = [
  Button.ConfirmsActions,
  Button.AddEvent,
  Button.AddEventTitleCase,
  Button.Create,
  Button.Save,
  Button.Remove,
  Button.Delete,
  Button.Update,
  Button.Confirm
];
const SUBMIT = [Button.Submit, Button.SendMessage, Button.Send];
/** Glic shows these under an answer only once it has finished. */
const REPLY_DONE = [Button.Copy, Button.GoodResponse, Button.Regenerate];
const REPLY_PREFIX = /^Gemini said\s*/i;

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitFor<T>(predicate: () => T | null, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) {
      return value;
    }

    await sleep(EDITOR_POLL_MS);
  }
  return null;
}

function editor(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[contenteditable=\"true\"]");
}

/**
 * The newest model answer. Prefer the whole response container
 * (<code>.presented-response-container</code>): the app result cards - a Keep note, a Tasks list,
 * a Gmail summary - render as embedded siblings of the inner markdown, so reading only the markdown
 * node caught just the "Here are your Google Keep notes:" preamble and dropped the notes
 * themselves. Fall back to the inner nodes if that class ever changes, and strip the "Gemini said"
 * accessibility prefix the container carries.
 */
function lastReplyText(): string {
  const containers = document.querySelectorAll<HTMLElement>(".presented-response-container");
  let last = containers[containers.length - 1];
  if (!last) {
    const nodes = document.querySelectorAll<HTMLElement>(
      "message-content, .model-response-text, .markdown, [data-response-index]"
    );
    last = nodes[nodes.length - 1];
  }

  return collapseWhitespace(last ? last.innerText : "").replace(REPLY_PREFIX, "");
}

/** Switches to text mode; whether a focused, empty editor is ready for C# to type into. */
export async function openTextEditor(): Promise<boolean> {
  clickButton(Button.TextMode);
  const box = await waitFor(editor, ACTION_READY_MS);
  if (!box) {
    return false;
  }

  box.focus();
  document.execCommand("selectAll");
  document.execCommand("delete");
  return true;
}

/**
 * After C# has typed the request: submit it, wait for the answer to stop growing, auto-confirm a
 * card, and return the answer text.
 */
export async function submitAndRead(): Promise<string> {
  clickButton(...SUBMIT);
  let text = "";
  let stableSince = 0;
  const deadline = Date.now() + ACTION_REPLY_MS;
  while (Date.now() < deadline) {
    const now = lastReplyText();
    const done = findButton(...REPLY_DONE);
    if (now && now === text && done) {
      stableSince = stableSince || Date.now();

      if (Date.now() - stableSince > ACTION_SETTLE_MS) {
        break;
      }
    } else {
      stableSince = 0;
      text = now;
    }

    await sleep(REPLY_POLL_MS);
  }

  // Out of time with the reply still running (a tool call that never returns): stop it. While a
  // reply runs Glic hides its Live button, so Live could never resume.
  if (clickButton(Button.StopResponse)) {
    await sleep(ACTION_SETTLE_MS);
  }

  if (clickButton(...ACTION_CONFIRM)) {
    await sleep(ACTION_SETTLE_MS);
    text = lastReplyText() || text;
  }

  return text;
}
