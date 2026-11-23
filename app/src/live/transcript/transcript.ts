import { type LiveEvent, LiveEventKind } from "@/contracts/live-engine.ts";

import { appendFragment, EMPTY_UTTERANCE } from "./utterance.ts";

// Turns the session's transcript fragments into transcript events, each carrying the whole
// utterance so far
export function createTranscript(emit: (event: LiveEvent) => void) {
  let utterance = EMPTY_UTTERANCE;

  return function appendTranscript({ fragment, isUser }: { fragment: string; isUser: boolean }) {
    utterance = appendFragment({
      utterance,
      fragment,
      isUser
    });
    emit({
      kind: LiveEventKind.TRANSCRIPT,
      text: utterance.text.trim(),
      isUser
    });
  };
}
