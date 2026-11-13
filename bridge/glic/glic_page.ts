// Glic's page as the bridge reads and presses it: every label and phrase we match on, and the
// helpers that find them.
import { labelAndText } from "../shared/text";

/** Fragments of Glic's button aria-labels. */
export enum Button {
  ADD_EVENT = "Add event",
  ADD_EVENT_TITLE_CASE = "Add Event",
  CONFIRM = "Confirm",
  CONFIRMS_ACTIONS = "Button that confirms actions",
  COPY = "Copy",
  CREATE = "Create",
  DELETE = "Delete",
  END = "End",
  GO_BACK = "Go back",
  GO_LIVE = "Go Live",
  GOOD_RESPONSE = "Good response",
  NO_THANKS = "No thanks",
  OKAY = "OK",
  PAUSE_LIVE = "Pause live mode",
  REGENERATE = "Regenerate",
  REMOVE = "Remove",
  SAVE = "Save",
  SEND = "Send",
  SEND_MESSAGE = "Send message",
  SKIP = "Skip",
  START_LIVE = "Start live mode",
  STOP_RESPONSE = "Stop response",
  SUBMIT = "Submit",
  TEXT_MODE = "Switch to text mode",
  TRY_AGAIN = "Try again",
  TURN_ON_CAPTIONS = "Turn on live captions",
  UPDATE = "Update"
}

/** Either one shows while Live is paused; clicking it resumes. */
export const RESUME_BUTTONS = [Button.START_LIVE, Button.GO_LIVE];

/** Phrases in Glic's visible text. */
export enum Phrase {
  MIC_CONSENT = "Live will use your microphone",
  UNAVAILABLE = "isn't available right now",
  WENT_WRONG = "Something went wrong"
}

const SIGN_IN_PATTERN = /\bSign in\b/;
const SIGN_IN_HOST = "accounts.google.com";

function pageText() {
  return document.body?.innerText || "";
}

export function pageSays(phrase: Phrase) {
  return pageText().includes(phrase);
}

/** Finds the first button whose aria-label contains one of the fragments, trying them in order. */
export function findButton(...fragments: Button[]) {
  const buttons = [...document.querySelectorAll("button")];
  for (const fragment of fragments) {
    const match = buttons.find(button => (button.getAttribute("aria-label") || "").includes(fragment));
    if (match) {
      return match;
    }
  }
  return null;
}

/** Like {@link findButton}, but matching the visible text too, for buttons Glic leaves unlabelled. */
export function findButtonByText(fragment: Button) {
  return [...document.querySelectorAll("button")].find(button => labelAndText(button).includes(fragment));
}

/** Clicks the first button {@link findButton} finds; whether one was clicked. */
export function clickButton(...fragments: Button[]) {
  const button = findButton(...fragments);
  if (!button) {
    return false;
  }

  button.click();
  return true;
}

export function isSignedOut() {
  return location.hostname === SIGN_IN_HOST || (SIGN_IN_PATTERN.test(pageText()) && !findButton(Button.GO_LIVE));
}

/** Never lets Glic see its hidden WebView as hidden, or it pauses Live. */
export function keepPageVisible() {
  try {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible"
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false
    });
    document.addEventListener("visibilitychange", event => event.stopImmediatePropagation(), true);
  } catch {
    // Best effort: a page that froze these keeps its own visibility.
  }
}
