// The transcript the app shows, from either source: the Live wire (live_wire.ts) or, without it,
// Glic's captions (captions.ts). Each relays an utterance's current full text keyed by its index.
import type { Direction, TranscriptLine } from "./glic_protocol";
import { collapseWhitespace } from "./text";

export interface Utterance {
  direction: Direction;
  text: string;
}

export interface TranscriptRelay {
  /** Sends the utterance at `index` unless it is empty or unchanged since it was last sent. */
  relay(index: number, utterance: Utterance): void;
  /** Forgets what was sent; indices restart at 0. */
  reset(): void;
}

export function transcriptRelay(send: (line: TranscriptLine) => void): TranscriptRelay {
  /** Last text relayed per index, to send only changes. */
  let relayed: string[] = [];
  return {
    relay(index, { direction, text }) {
      const trimmed = collapseWhitespace(text);
      if (!trimmed || relayed[index] === trimmed) {
        return;
      }

      relayed[index] = trimmed;
      send({
        text: trimmed,
        direction,
        index
      });
    },
    reset() {
      relayed = [];
    }
  };
}
