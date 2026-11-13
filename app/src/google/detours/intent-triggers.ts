import type { LiveEventSink } from "@/google/live-event-sink.ts";

import type { Detours, SpeechRecord } from "./detours.ts";
import { unescapeMarkdown } from "./screen-prompt.ts";
import { classifyRefusal, classifyUtterance, IntentKind, type SpokenIntent } from "./spoken-intent.ts";

// Long enough that the user's utterance has settled before the app acts on it, short enough to
// beat Gemini's spoken refusal most of the time
const INTENT_SETTLE_MS = 1100;

function runIntent({ detours, request, intent }: { detours: Detours; request: string; intent: SpokenIntent }) {
  const isLights = intent.kind === IntentKind.LIGHTS;
  if (isLights) {
    return detours.runLights({
      request,
      isOn: intent.isOn
    });
  }

  return intent.kind === IntentKind.APP ? detours.runAppAction(request) : detours.runWebSearch(request);
}

// The user's request has stopped changing: if it plainly targets a Google app, the lights or the
// web, handle it now
function createSettledHandler({ detours, speech }: { detours: Detours; speech: SpeechRecord }) {
  return function onIntentSettled() {
    const isHandled = detours.isRunning || speech.lastUserUtterance === detours.handledUtterance;
    if (isHandled) {
      return;
    }

    const intent = classifyUtterance(speech.lastUserUtterance);
    if (!intent) {
      return;
    }

    void runIntent({
      detours,
      request: speech.lastUserUtterance,
      intent
    });
  };
}

// Fallback: Gemini got there first and refused something the text path can do. Fix it there.
function createRefusalHandler({ detours, speech }: { detours: Detours; speech: SpeechRecord }) {
  let handledRefusalIndex = -1;

  return function onGeminiLine({ line, index }: { line: string; index: number }) {
    const isOpen =
      index !== handledRefusalIndex &&
      speech.lastUserUtterance.length > 0 &&
      speech.lastUserUtterance !== detours.handledUtterance;
    if (!isOpen) {
      return;
    }

    const refusal = classifyRefusal(line);
    if (!refusal) {
      return;
    }

    handledRefusalIndex = index;
    const request = speech.lastUserUtterance;
    void (refusal === IntentKind.APP ? detours.runAppAction(request) : detours.runWebSearch(request));
  };
}

// Decides when a caption means a request Live cannot serve, and hands it to the detours
export function createIntentTriggers({
  detours,
  speech,
  sink,
  now
}: {
  detours: Detours;
  speech: SpeechRecord;
  sink: LiveEventSink;
  now: () => number;
}) {
  const onIntentSettled = createSettledHandler({
    detours,
    speech
  });
  const onGeminiLine = createRefusalHandler({
    detours,
    speech
  });
  let intentTimer: NodeJS.Timeout | undefined;

  function onCaption({ text, isUser, index }: { text: string; isUser: boolean; index: number }) {
    const clean = unescapeMarkdown(text);
    sink.transcript({
      text: clean,
      isUser
    });

    if (!isUser) {
      speech.lastGeminiLine = clean;
      speech.lastGeminiCaptionAt = now();
      onGeminiLine({
        line: clean,
        index
      });
      return;
    }

    // The utterance revises in place, so restart the settle timer on each update
    speech.lastUserUtterance = clean;

    if (detours.isRunning) {
      return;
    }

    clearTimeout(intentTimer);
    intentTimer = setTimeout(onIntentSettled, INTENT_SETTLE_MS);
  }

  return {
    onCaption,
    dispose() {
      clearTimeout(intentTimer);
    }
  };
}
