// Every message between the glic page's bridge and the app (GlicHost), as a protocol map keyed by
// an enum. The app's side is src/GeminiLive/Glic/GlicProtocol.cs.
import type { Block } from "./page_content";

export enum GlicMessage {
  // app → page
  Start = "start",
  Stop = "stop",
  SetMuted = "setMuted",
  ListMics = "listMics",
  SetMic = "setMic",
  BeginAction = "beginAction",
  SubmitAndRead = "submitAndRead",
  // page → app
  Booted = "booted",
  Ready = "ready",
  State = "state",
  Transcript = "transcript",
  Error = "error",
  Capture = "capture",
  Read = "read"
}

/**
 * What GlicMessage.Error carries. SignedOut, Unavailable and LiveBroke are codes GlicHost matches
 * on (PageError in C#) - waiting for a fresh session for the first two, reloading the page for the
 * third; the rest are shown to the user as they are.
 */
export enum ErrorMessage {
  SignedOut = "signed-out",
  Unavailable = "unavailable",
  LiveBroke = "live-broke",
  PageDidNotStart = "Gemini page did not start",
  LiveDidNotStart = "Gemini Live did not start (sign-in or rate limit)"
}

/** The Live states the page reports. */
export enum State {
  Idle = "idle",
  Listening = "listening",
  Resuming = "resuming"
}

/** Who spoke a transcript line. */
export enum Direction {
  Assistant = "assistant",
  User = "user"
}

export interface Microphone {
  id: string;
  label: string;
}

/** One utterance so far; a later line with the same index revises it. */
export interface TranscriptLine {
  text: string;
  direction: Direction;
  index: number;
}

/** A picture for Gemini; data is base64. */
export interface Picture {
  data: string;
  mimeType: string;
  width: number;
  height: number;
}

/** The text of the window on screen (ScreenText.View in C#). */
export interface ScreenView {
  title: string;
  app: string;
  blocks: Block[];
  version: string;
}

export interface GlicProtocolMap {
  [GlicMessage.Start](): void;
  [GlicMessage.Stop](): void;
  [GlicMessage.SetMuted](muted: boolean): void;
  [GlicMessage.ListMics](): Microphone[];
  [GlicMessage.SetMic](id: string | null): void;
  /** Switches to text mode; whether a focused, empty text box is ready for typing. */
  [GlicMessage.BeginAction](): boolean;
  /** Submits the typed request; the answer's text. */
  [GlicMessage.SubmitAndRead](): string;

  [GlicMessage.Booted](): void;
  [GlicMessage.Ready](): void;
  [GlicMessage.State](state: State): void;
  [GlicMessage.Transcript](line: TranscriptLine): void;
  /** A failure: one of ErrorMessage's codes, or a message to show. */
  [GlicMessage.Error](message: ErrorMessage): void;
  /** A picture of the shared screen or camera; null when there is none. */
  [GlicMessage.Capture](): Picture | null;
  /** An exact text copy of the window on the shared display; null when there is none. */
  [GlicMessage.Read](): ScreenView | null;
}
