import { HANDLED_SERVER_FIELDS, type ServerMessage } from "@/live/api/protocol.ts";

export const SessionEventKind = {
  AUDIO: "audio",
  INTERRUPTED: "interrupted",
  USER_TEXT: "userText",
  MODEL_TEXT: "modelText",
  RESUME_HANDLE: "resumeHandle",
  GO_AWAY: "goAway"
} as const;

type SessionEvent =
  | {
      readonly kind: typeof SessionEventKind.AUDIO;
      readonly pcm16: Uint8Array;
    }
  | { readonly kind: typeof SessionEventKind.INTERRUPTED }
  | {
      readonly kind: typeof SessionEventKind.USER_TEXT;
      readonly text: string;
    }
  | {
      readonly kind: typeof SessionEventKind.MODEL_TEXT;
      readonly text: string;
    }
  | {
      readonly kind: typeof SessionEventKind.RESUME_HANDLE;
      readonly handle: string;
    }
  | {
      readonly kind: typeof SessionEventKind.GO_AWAY;
      readonly timeLeft: string | undefined;
    };

// Same order LiveSession.cs handles one message: content (interrupt, audio, transcripts), then
// the resume handle, then goAway last, since it retires the socket
export function toSessionEvents(message: ServerMessage) {
  const events: SessionEvent[] = [];
  const content = message.serverContent;
  if (content?.interrupted) {
    events.push({ kind: SessionEventKind.INTERRUPTED });
  }

  for (const part of content?.modelTurn?.parts ?? []) {
    if (part.inlineData) {
      events.push({
        kind: SessionEventKind.AUDIO,
        pcm16: new Uint8Array(Buffer.from(part.inlineData.data, "base64"))
      });
    }
  }
  const heard = content?.inputTranscription?.text ?? "";
  const hasHeard = heard.length > 0;
  if (hasHeard) {
    events.push({
      kind: SessionEventKind.USER_TEXT,
      text: heard
    });
  }

  const said = content?.outputTranscription?.text ?? "";
  const hasSaid = said.length > 0;
  if (hasSaid) {
    events.push({
      kind: SessionEventKind.MODEL_TEXT,
      text: said
    });
  }

  const update = message.sessionResumptionUpdate;
  const handle = update?.resumable ? update.newHandle : undefined;
  if (handle) {
    events.push({
      kind: SessionEventKind.RESUME_HANDLE,
      handle
    });
  }

  if (message.goAway) {
    events.push({
      kind: SessionEventKind.GO_AWAY,
      timeLeft: message.goAway.timeLeft
    });
  }

  return events;
}

export function unhandledFields(message: ServerMessage) {
  return Object.keys(message).filter(field => !HANDLED_SERVER_FIELDS.has(field));
}
