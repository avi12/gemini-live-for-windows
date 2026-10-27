import { collapseWhitespace } from "../shared/text";
// Captions -> transcript, the fallback when the wire tap sees nothing (a changed channel). Glic
// renders "<b>You:</b> ... <b>Gemini:</b> ..." and revises the live utterance in place, so the
// bridge relays each utterance's current full text keyed by index. Its labels are not trustworthy
// (see live_wire.ts), which is why this only runs without the wire.
import { Direction } from "./glic_protocol";
import type { Utterance } from "./transcript";

// Only a bold node that is exactly a speaker label starts an utterance. Gemini bolds words in its
// own answers too ("**your** schedule"), and those are part of the sentence, not a new speaker.
const SPEAKER_LABELS: Record<string, Direction> = {
  you: Direction.User,
  gemini: Direction.Assistant
};

function captionsRoot(): Element | null {
  const scroller = document.querySelector("captions-scroller");
  if (!scroller) {
    return null;
  }

  return (
    scroller.querySelector(".captions-scroller-container .captions-scroller") ||
    scroller.querySelector(".captions-scroller-container") ||
    scroller
  );
}

/** The transcript direction a bold node stands for, or null for bold text. */
function directionOf(node: Node): Direction | null {
  if (!(node instanceof Element) || node.tagName !== "B") {
    return null;
  }

  const label = (node.textContent || "").trim().replace(/:$/, "").toLowerCase();
  return SPEAKER_LABELS[label] ?? null;
}

/** The utterances Glic's captions show, in order; none when there are no captions. */
export function readCaptions(): Utterance[] {
  const root = captionsRoot();
  if (!root) {
    return [];
  }

  const found: Utterance[] = [];
  let current: Utterance | null = null;
  for (const node of root.childNodes) {
    const direction = directionOf(node);
    if (direction) {
      current = {
        direction,
        text: ""
      };
      found.push(current);
    } else if (current) {
      current.text += node.textContent || "";
    }
  }
  return found
    .map(utterance => ({
      direction: utterance.direction,
      text: collapseWhitespace(utterance.text)
    }))
    .filter(utterance => utterance.text);
}
