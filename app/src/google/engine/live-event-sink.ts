import { type LiveEvent, LiveEventKind } from "@/contracts/live-engine.ts";

interface TranscriptCaption {
  text: string;
  isUser: boolean;
}

export interface LiveEventSink {
  emit(event: LiveEvent): void;
  status(text: string): void;
  transcript(caption: TranscriptCaption): void;
}

export function createLiveEventSink(emit: (event: LiveEvent) => void) {
  return {
    emit,
    status(text) {
      emit({
        kind: LiveEventKind.STATUS,
        status: text
      });
    },
    transcript({ text, isUser }) {
      emit({
        kind: LiveEventKind.TRANSCRIPT,
        text,
        isUser
      });
    }
  } satisfies LiveEventSink;
}
