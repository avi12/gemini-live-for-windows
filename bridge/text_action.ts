// Google apps and web searches via a text turn. Live can't reach Calendar, Keep, Tasks or Gmail -
// those tools are server-gated to the text path - and it can only say a link, never show one. So a
// detour pauses Live, runs the request as a text turn in the SAME conversation (where the account's
// apps and Search with its links are on), auto-confirms a result card, then C# resumes Live, which
// keeps the answer in context. C# types the request with trusted CDP key events, because synthetic
// input never enables Submit.
import { Button, clickButton, findButton } from "./glic_page";
import type { AnswerLink, TextAnswer } from "./glic_protocol";
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
const WEB_LINK = /^https?:\/\//i;

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
function lastReply(): HTMLElement | undefined {
  const containers = document.querySelectorAll<HTMLElement>(".presented-response-container");
  const last = containers[containers.length - 1];
  if (last) {
    return last;
  }

  const nodes = document.querySelectorAll<HTMLElement>(
    "message-content, .model-response-text, .markdown, [data-response-index]"
  );
  return nodes[nodes.length - 1];
}

function lastReplyText(): string {
  return collapseWhitespace(lastReply()?.innerText ?? "").replace(REPLY_PREFIX, "");
}

/**
 * The web links in the newest answer: its search results, cited sources and inline links, once
 * each. Live can only say a link, so these are what turn a spoken "it's on their site" into a
 * page to open.
 */
function lastReplyLinks(): AnswerLink[] {
  const links = new Map<string, AnswerLink>();
  for (const anchor of lastReply()?.querySelectorAll("a[href]") ?? []) {
    if (!(anchor instanceof HTMLAnchorElement) || !WEB_LINK.test(anchor.href) || links.has(anchor.href)) {
      continue;
    }

    const title = collapseWhitespace(anchor.innerText) || new URL(anchor.href).hostname;
    links.set(anchor.href, {
      title,
      url: anchor.href
    });
  }
  return [...links.values()];
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
 * card, and return the answer with its links.
 */
export async function submitAndRead(): Promise<TextAnswer> {
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

  return {
    text,
    links: lastReplyLinks()
  };
}
