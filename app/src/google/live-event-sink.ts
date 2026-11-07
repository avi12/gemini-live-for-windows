import { type LiveEvent, LiveEventKind } from "@/contracts/live-engine.ts";

export interface LiveEventSink {
  emit(event: LiveEvent): void;
  status(text: string): void;
  transcript(caption: {
    text: string;
    isUser: boolean;
  }): void;
}

export function createLiveEventSink(emit: (event: LiveEvent) => void) {
  return {
    emit,
    status(text) {
      emit({
        kind: LiveEventKind.status,
        status: text
      });
    },
    transcript({ text, isUser }) {
      emit({
        kind: LiveEventKind.transcript,
        text,
        isUser
      });
    }
  } satisfies LiveEventSink;
}
