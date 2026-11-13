import { collapseWhitespace } from "@/shared/text";

// Google apps and web searches via a text turn. Live can't reach Calendar, Keep, Tasks or Gmail -
// those tools are server-gated to the text path - and it can only say a link, never show one. So a
// detour pauses Live, runs the request as a text turn in the SAME conversation (where the account's
// apps and Search with its links are on), auto-confirms a result card, then C# resumes Live, which
// keeps the answer in context. C# types the request with trusted CDP key events, because synthetic
// input never enables Submit.
import { Button, clickButton, findButton } from "./glic_page";
import type { AnswerLink } from "./glic_protocol";

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
  Button.CONFIRMS_ACTIONS,
  Button.ADD_EVENT,
  Button.ADD_EVENT_TITLE_CASE,
  Button.CREATE,
  Button.SAVE,
  Button.REMOVE,
  Button.DELETE,
  Button.UPDATE,
  Button.CONFIRM
];
const SUBMIT = [Button.SUBMIT, Button.SEND_MESSAGE, Button.SEND];
/** Glic shows these under an answer only once it has finished. */
const REPLY_DONE = [Button.COPY, Button.GOOD_RESPONSE, Button.REGENERATE];
const REPLY_PREFIX = /^Gemini said\s*/i;
const WEB_LINK = /^https?:\/\//i;

function sleep(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitFor<T>({ predicate, timeoutMs }: { predicate: () => T | null; timeoutMs: number }) {
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

function editor() {
  return document.querySelector<HTMLElement>('[contenteditable="true"]');
}

/**
 * The newest model answer. Prefer the whole response container
 * (<code>.presented-response-container</code>): the app result cards - a Keep note, a Tasks list,
 * a Gmail summary - render as embedded siblings of the inner markdown, so reading only the markdown
 * node caught just the "Here are your Google Keep notes:" preamble and dropped the notes
 * themselves. Fall back to the inner nodes if that class ever changes, and strip the "Gemini said"
 * accessibility prefix the container carries.
 */
function lastReply() {
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

function lastReplyText() {
  return collapseWhitespace(lastReply()?.innerText ?? "").replace(REPLY_PREFIX, "");
}

/**
 * The web links in the newest answer: its search results, cited sources and inline links, once
 * each. Live can only say a link, so these are what turn a spoken "it's on their site" into a
 * page to open.
 */
function lastReplyLinks() {
  const links = new Map<string, AnswerLink>();
  for (const anchor of lastReply()?.querySelectorAll("a[href]") ?? []) {
    const isNotNewWebLink =
      !(anchor instanceof HTMLAnchorElement) || !WEB_LINK.test(anchor.href) || links.has(anchor.href);
    if (isNotNewWebLink) {
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
export async function openTextEditor() {
  clickButton(Button.TEXT_MODE);
  const box = await waitFor({
    predicate: editor,
    timeoutMs: ACTION_READY_MS
  });
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
export async function submitAndRead() {
  clickButton(...SUBMIT);
  let text = "";
  let stableSince = 0;
  const deadline = Date.now() + ACTION_REPLY_MS;
  while (Date.now() < deadline) {
    const now = lastReplyText();
    const done = findButton(...REPLY_DONE);
    const isSettledText = now && now === text && done;
    if (isSettledText) {
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
  if (clickButton(Button.STOP_RESPONSE)) {
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
