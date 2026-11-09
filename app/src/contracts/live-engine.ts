import type { Monitor, Region } from "@/contracts/monitor.ts";
import { EngineKind, LiveStatus } from "@gemini-live/protocol/view";

// The one contract both engines satisfy (the Google account engine over the Gemini web client and
// the API-key engine over the public Live API). Mirrors ILiveEngine.cs; the pill controller
// builds the pill's view from these events and knows nothing else about an engine.

export { EngineKind, LiveStatus };

export interface FoundLink {
  readonly title: string;
  readonly uri: string;
}

export const LiveEventKind = {
  status: "status",
  transcript: "transcript",
  links: "links",
  level: "level",
  ended: "ended"
} as const;

// One typed event union instead of five callbacks; the controller switches on `kind`
export type LiveEvent =
  | {
    readonly kind: typeof LiveEventKind.status;
    readonly status: string;
  }
  // The current utterance's full text so far; a new utterance starts when the speaker changes
  | {
    readonly kind: typeof LiveEventKind.transcript;
    readonly text: string;
    readonly isUser: boolean;
  }
  // Links an answer came with, beyond the ones the caption card finds in the spoken words
  | {
    readonly kind: typeof LiveEventKind.links;
    readonly links: readonly FoundLink[];
  }
  // Audio peak 0..1 for the glow; only sent when the engine reportsLevels
  | {
    readonly kind: typeof LiveEventKind.level;
    readonly peak: number;
    readonly isUser: boolean;
  }
  | {
    readonly kind: typeof LiveEventKind.ended;
    readonly reason: string;
  };

export type LiveEventListener = (event: LiveEvent) => void;

export interface LiveEngine {
  readonly kind: EngineKind;
  // False when Gemini's own client owns the audio, so there are no levels
  readonly reportsLevels: boolean;
  readonly monitor: Monitor;
  isMuted: boolean;
  // The part of the shared display Gemini sees, in the display's physical pixels, or undefined for
  // the whole display; Gemini keeps seeing it live until it is set back
  region: Region | undefined;

  // True while Gemini sees the webcam in place of the shared display
  readonly isCameraShared: boolean;

  onEvent(listener: LiveEventListener): () => void;
  // Raised with true while a session is wanted but the companion extension has never connected, and
  // with false once it has; an engine with no extension to wait for never raises it
  onExtensionNeeded(listener: (isNeeded: boolean) => void): () => void;
  // Shares the webcam instead of the display, or switches back; false when the camera could not be
  // opened (the display stays the source) or the engine has none
  useCamera(isOn: boolean): Promise<boolean>;
  // Resolves once Gemini is listening; the caller disposes the engine if it rejects
  start(): Promise<void>;
  // Shares another display, all of it (any region is dropped)
  share(monitor: Monitor): void;
  dispose(): Promise<void>;
}
