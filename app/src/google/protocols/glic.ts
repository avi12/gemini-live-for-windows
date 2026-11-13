import { z } from "zod";

// The boundary between the app and the glic page's bridge (bridge/glic/glic_protocol.ts). That
// file declares TypeScript enums, which this package's erasable-only syntax cannot import, so the
// wire values are mirrored here as an as-const object and protocols.test.ts fails on drift.
// Every payload that crosses is loose data, so each is a zod schema checked on receipt.

export const GlicMessage = {
  START: "start",
  STOP: "stop",
  SET_MUTED: "setMuted",
  LIST_MICS: "listMics",
  SET_MIC: "setMic",
  BEGIN_ACTION: "beginAction",
  SUBMIT_AND_READ: "submitAndRead",
  BOOTED: "booted",
  READY: "ready",
  STATE: "state",
  TRANSCRIPT: "transcript",
  ERROR: "error",
  CAPTURE: "capture",
  READ: "read"
} as const;

// The failures the page reports by code; anything else is a message to show
export const PageError = {
  SIGNED_OUT: "signed-out",
  UNAVAILABLE: "unavailable",
  LIVE_BROKE: "live-broke"
} as const;

export const GlicState = {
  IDLE: "idle",
  LISTENING: "listening",
  RESUMING: "resuming"
} as const;

export const Direction = {
  ASSISTANT: "assistant",
  USER: "user"
} as const;

export const BlockKind = {
  HEADING: "heading",
  PARAGRAPH: "paragraph"
} as const;

export const glicStateSchema = z.enum([GlicState.IDLE, GlicState.LISTENING, GlicState.RESUMING]);

const microphoneSchema = z.object({
  id: z.string(),
  label: z.string()
});
export const microphonesSchema = z.array(microphoneSchema);

// One utterance so far; a later line with the same index revises it
export const transcriptLineSchema = z.object({
  text: z.string(),
  direction: z.enum([Direction.ASSISTANT, Direction.USER]),
  index: z.number().int()
});

// A picture for Gemini; data is base64
const pictureSchema = z.object({
  data: z.string(),
  mimeType: z.string(),
  width: z.number().int(),
  height: z.number().int()
});
export type Picture = z.infer<typeof pictureSchema>;

export const textAnswerSchema = z.object({
  text: z.string(),
  links: z.array(
    z.object({
      title: z.string(),
      url: z.string()
    })
  )
});

// The text of the window on screen
const screenViewSchema = z.object({
  title: z.string(),
  app: z.string(),
  blocks: z.array(
    z.object({
      kind: z.enum([BlockKind.HEADING, BlockKind.PARAGRAPH]),
      text: z.string()
    })
  ),
  version: z.string()
});
export type ScreenView = z.infer<typeof screenViewSchema>;

// Payloads the page sends or answers with are `unknown` here and checked with the schemas above
export interface GlicProtocolMap {
  [GlicMessage.START](): void;
  [GlicMessage.STOP](): void;
  [GlicMessage.SET_MUTED](muted: boolean): void;
  [GlicMessage.LIST_MICS](): unknown;
  [GlicMessage.SET_MIC](id: string | null): void;
  // Switches to text mode; whether a focused, empty text box is ready for typing
  [GlicMessage.BEGIN_ACTION](): unknown;
  // Submits the typed request; the answer and its links
  [GlicMessage.SUBMIT_AND_READ](): unknown;
  [GlicMessage.BOOTED](): void;
  [GlicMessage.READY](): void;
  [GlicMessage.STATE](state: unknown): void;
  [GlicMessage.TRANSCRIPT](line: unknown): void;
  [GlicMessage.ERROR](message: unknown): void;
  // A picture of the shared screen or camera; null when there is none
  [GlicMessage.CAPTURE](): Picture | null;
  // An exact text copy of the window on the shared display; null when there is none
  [GlicMessage.READ](): ScreenView | null;
}
