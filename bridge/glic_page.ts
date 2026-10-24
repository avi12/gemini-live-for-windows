// Glic's page as the bridge reads and presses it: every label and phrase we match on, and the
// helpers that find them.
import { labelAndText } from "./text";

/** Fragments of Glic's button aria-labels. */
export enum Button {
  AddEvent = "Add event",
  AddEventTitleCase = "Add Event",
  Confirm = "Confirm",
  ConfirmsActions = "Button that confirms actions",
  Copy = "Copy",
  Create = "Create",
  Delete = "Delete",
  End = "End",
  GoBack = "Go back",
  GoLive = "Go Live",
  GoodResponse = "Good response",
  NoThanks = "No thanks",
  Okay = "OK",
  PauseLive = "Pause live mode",
  Regenerate = "Regenerate",
  Remove = "Remove",
  Save = "Save",
  Send = "Send",
  SendMessage = "Send message",
  Skip = "Skip",
  StartLive = "Start live mode",
  StopResponse = "Stop response",
  Submit = "Submit",
  TextMode = "Switch to text mode",
  TryAgain = "Try again",
  TurnOnCaptions = "Turn on live captions",
  Update = "Update"
}

/** Either one shows while Live is paused; clicking it resumes. */
export const RESUME_BUTTONS = [Button.StartLive, Button.GoLive];

/** Phrases in Glic's visible text. */
export enum Phrase {
  MicConsent = "Live will use your microphone",
  Unavailable = "isn't available right now",
  WentWrong = "Something went wrong"
}

const SIGN_IN_PATTERN = /\bSign in\b/;
const SIGN_IN_HOST = "accounts.google.com";

function pageText(): string {
  return document.body?.innerText || "";
}

export function pageSays(phrase: Phrase): boolean {
  return pageText().includes(phrase);
}

/** Finds the first button whose aria-label contains one of the fragments, trying them in order. */
export function findButton(...fragments: Button[]): HTMLButtonElement | null {
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
export function findButtonByText(fragment: Button): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find(button => labelAndText(button).includes(fragment));
}

/** Clicks the first button {@link findButton} finds; whether one was clicked. */
export function clickButton(...fragments: Button[]): boolean {
  const button = findButton(...fragments);
  if (!button) {
    return false;
  }

  button.click();
  return true;
}

export function isSignedOut(): boolean {
  return location.hostname === SIGN_IN_HOST ||
    (SIGN_IN_PATTERN.test(pageText()) && !findButton(Button.GoLive));
}

/** Never lets Glic see its hidden WebView as hidden, or it pauses Live. */
export function keepPageVisible(): void {
  try {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible"
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false
    });
    document.addEventListener("visibilitychange", e => e.stopImmediatePropagation(), true);
  } catch {
    // Best effort: a page that froze these keeps its own visibility.
  }
}
