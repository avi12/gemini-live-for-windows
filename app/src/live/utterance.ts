export interface Utterance {
  readonly text: string;
  readonly isUser: boolean;
}

export const EMPTY_UTTERANCE: Utterance = {
  text: "",
  isUser: false
};

// The API streams transcripts as fragments; the engine contract is whole utterances, and a new
// one starts when the speaker changes
export function appendFragment({
  utterance,
  fragment,
  isUser
}: {
  utterance: Utterance;
  fragment: string;
  isUser: boolean;
}) {
  const isSameSpeaker = isUser === utterance.isUser;
  const kept = isSameSpeaker ? utterance.text : "";
  return {
    text: `${kept}${fragment}`,
    isUser
  } satisfies Utterance;
}
