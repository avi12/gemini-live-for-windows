import { HANDLED_SERVER_FIELDS, type ServerMessage } from "@/live/api/protocol.ts";

export const SessionEventKind = {
  audio: "audio",
  interrupted: "interrupted",
  userText: "userText",
  modelText: "modelText",
  resumeHandle: "resumeHandle",
  goAway: "goAway"
} as const;

type SessionEvent =
  | {
    readonly kind: typeof SessionEventKind.audio;
    readonly pcm16: Uint8Array;
  }
  | { readonly kind: typeof SessionEventKind.interrupted }
  | {
    readonly kind: typeof SessionEventKind.userText;
    readonly text: string;
  }
  | {
    readonly kind: typeof SessionEventKind.modelText;
    readonly text: string;
  }
  | {
    readonly kind: typeof SessionEventKind.resumeHandle;
    readonly handle: string;
  }
  | {
    readonly kind: typeof SessionEventKind.goAway;
    readonly timeLeft: string | undefined;
  };

// Same order LiveSession.cs handles one message: content (interrupt, audio, transcripts), then
// the resume handle, then goAway last, since it retires the socket
export function toSessionEvents(message: ServerMessage) {
  const events: SessionEvent[] = [];
  const content = message.serverContent;
  if (content?.interrupted) {
    events.push({ kind: SessionEventKind.interrupted });
  }

  for (const part of content?.modelTurn?.parts ?? []) {
    if (part.inlineData) {
      events.push({
        kind: SessionEventKind.audio,
        pcm16: new Uint8Array(Buffer.from(part.inlineData.data, "base64"))
      });
    }
  }
  const heard = content?.inputTranscription?.text ?? "";
  const hasHeard = heard.length > 0;
  if (hasHeard) {
    events.push({
      kind: SessionEventKind.userText,
      text: heard
    });
  }

  const said = content?.outputTranscription?.text ?? "";
  const hasSaid = said.length > 0;
  if (hasSaid) {
    events.push({
      kind: SessionEventKind.modelText,
      text: said
    });
  }

  const update = message.sessionResumptionUpdate;
  const handle = update?.resumable ? update.newHandle : undefined;
  if (handle) {
    events.push({
      kind: SessionEventKind.resumeHandle,
      handle
    });
  }

  if (message.goAway) {
    events.push({
      kind: SessionEventKind.goAway,
      timeLeft: message.goAway.timeLeft
    });
  }

  return events;
}

export function unhandledFields(message: ServerMessage) {
  return Object.keys(message).filter(field => !HANDLED_SERVER_FIELDS.has(field));
}
