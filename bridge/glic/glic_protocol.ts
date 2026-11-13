// Every message between the glic page's bridge and the app (GlicHost), as a protocol map keyed by
// an enum. The app's side is src/GeminiLive/Glic/Gemini/GlicProtocol.cs.
import type { Block } from "./page_content";

export enum GlicMessage {
  // app → page
  START = "start",
  STOP = "stop",
  SET_MUTED = "setMuted",
  LIST_MICS = "listMics",
  SET_MIC = "setMic",
  BEGIN_ACTION = "beginAction",
  SUBMIT_AND_READ = "submitAndRead",
  // page → app
  BOOTED = "booted",
  READY = "ready",
  STATE = "state",
  TRANSCRIPT = "transcript",
  ERROR = "error",
  CAPTURE = "capture",
  READ = "read"
}

/**
 * What GlicMessage.ERROR carries. SignedOut, Unavailable and LiveBroke are codes GlicHost matches
 * on (PageError in C#) - waiting for a fresh session for the first two, reloading the page for the
 * third; the rest are shown to the user as they are.
 */
export enum ErrorMessage {
  SIGNED_OUT = "signed-out",
  UNAVAILABLE = "unavailable",
  LIVE_BROKE = "live-broke",
  PAGE_DID_NOT_START = "Gemini page did not start",
  LIVE_DID_NOT_START = "Gemini Live did not start (sign-in or rate limit)"
}

/** The Live states the page reports. */
export enum State {
  IDLE = "idle",
  LISTENING = "listening",
  RESUMING = "resuming"
}

/** Who spoke a transcript line. */
export enum Direction {
  ASSISTANT = "assistant",
  USER = "user"
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

/** A link in a text answer: a search result, a cited source, a page Gemini points at. */
export interface AnswerLink {
  title: string;
  url: string;
}

/** A text turn's answer, with the links its page showed (Live can only say them). */
export interface TextAnswer {
  text: string;
  links: AnswerLink[];
}

/** The text of the window on screen (ScreenText.View in C#). */
export interface ScreenView {
  title: string;
  app: string;
  blocks: Block[];
  version: string;
}

export interface GlicProtocolMap {
  [GlicMessage.START](): void;
  [GlicMessage.STOP](): void;
  [GlicMessage.SET_MUTED](muted: boolean): void;
  [GlicMessage.LIST_MICS](): Microphone[];
  [GlicMessage.SET_MIC](id: string | null): void;
  /** Switches to text mode; whether a focused, empty text box is ready for typing. */
  [GlicMessage.BEGIN_ACTION](): boolean;
  /** Submits the typed request; the answer and its links. */
  [GlicMessage.SUBMIT_AND_READ](): TextAnswer;

  [GlicMessage.BOOTED](): void;
  [GlicMessage.READY](): void;
  [GlicMessage.STATE](state: State): void;
  [GlicMessage.TRANSCRIPT](line: TranscriptLine): void;
  /** A failure: one of ErrorMessage's codes, or a message to show. */
  [GlicMessage.ERROR](message: ErrorMessage): void;
  /** A picture of the shared screen or camera; null when there is none. */
  [GlicMessage.CAPTURE](): Picture | null;
  /** An exact text copy of the window on the shared display; null when there is none. */
  [GlicMessage.READ](): ScreenView | null;
}
