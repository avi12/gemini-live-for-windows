import { z } from "zod";

// The boundary between the app and the glic page's bridge (bridge/glic/glic_protocol.ts). That
// file declares TypeScript enums, which this package's erasable-only syntax cannot import, so the
// wire values are mirrored here as an as-const object and protocols.test.ts fails on drift.
// Every payload that crosses is loose data, so each is a zod schema checked on receipt.

export const GlicMessage = {
  start: "start",
  stop: "stop",
  setMuted: "setMuted",
  listMics: "listMics",
  setMic: "setMic",
  beginAction: "beginAction",
  submitAndRead: "submitAndRead",
  booted: "booted",
  ready: "ready",
  state: "state",
  transcript: "transcript",
  error: "error",
  capture: "capture",
  read: "read"
} as const;

// The failures the page reports by code; anything else is a message to show
export const PageError = {
  signedOut: "signed-out",
  unavailable: "unavailable",
  liveBroke: "live-broke"
} as const;

export const GlicState = {
  idle: "idle",
  listening: "listening",
  resuming: "resuming"
} as const;

export const Direction = {
  assistant: "assistant",
  user: "user"
} as const;

export const BlockKind = {
  heading: "heading",
  paragraph: "paragraph"
} as const;

export const glicStateSchema = z.enum([GlicState.idle, GlicState.listening, GlicState.resuming]);

const microphoneSchema = z.object({
  id: z.string(),
  label: z.string()
});
export const microphonesSchema = z.array(microphoneSchema);

// One utterance so far; a later line with the same index revises it
export const transcriptLineSchema = z.object({
  text: z.string(),
  direction: z.enum([Direction.assistant, Direction.user]),
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
      kind: z.enum([BlockKind.heading, BlockKind.paragraph]),
      text: z.string()
    })
  ),
  version: z.string()
});
export type ScreenView = z.infer<typeof screenViewSchema>;

// Payloads the page sends or answers with are `unknown` here and checked with the schemas above
export interface GlicProtocolMap {
  [GlicMessage.start](): void;
  [GlicMessage.stop](): void;
  [GlicMessage.setMuted](muted: boolean): void;
  [GlicMessage.listMics](): unknown;
  [GlicMessage.setMic](id: string | null): void;
  // Switches to text mode; whether a focused, empty text box is ready for typing
  [GlicMessage.beginAction](): unknown;
  // Submits the typed request; the answer and its links
  [GlicMessage.submitAndRead](): unknown;
  [GlicMessage.booted](): void;
  [GlicMessage.ready](): void;
  [GlicMessage.state](state: unknown): void;
  [GlicMessage.transcript](line: unknown): void;
  [GlicMessage.error](message: unknown): void;
  // A picture of the shared screen or camera; null when there is none
  [GlicMessage.capture](): Picture | null;
  // An exact text copy of the window on the shared display; null when there is none
  [GlicMessage.read](): ScreenView | null;
}
