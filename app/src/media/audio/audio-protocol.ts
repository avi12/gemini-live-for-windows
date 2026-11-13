import { z } from "zod";

// The two directions of the audio worker's message port. Both ends parse what they receive: the
// worker is a thread boundary, and a malformed message must fail loudly, not play garbage.
export const AudioCommandKind = {
  START: "start",
  PLAY: "play",
  FLUSH: "flush",
  MUTE: "mute",
  DISPOSE: "dispose"
} as const;

export const AudioEventKind = {
  STARTED: "started",
  FAILED: "failed",
  MIC_CHUNK: "micChunk",
  MIC_LEVEL: "micLevel",
  SPEAKER_LEVEL: "speakerLevel",
  DISPOSED: "disposed"
} as const;

export const audioCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(AudioCommandKind.START),
    deviceId: z.string().nullable(),
    isLoopback: z.boolean()
  }),
  z.object({
    kind: z.literal(AudioCommandKind.PLAY),
    pcm16: z.instanceof(Uint8Array)
  }),
  z.object({ kind: z.literal(AudioCommandKind.FLUSH) }),
  z.object({
    kind: z.literal(AudioCommandKind.MUTE),
    isMuted: z.boolean()
  }),
  z.object({ kind: z.literal(AudioCommandKind.DISPOSE) })
]);

export const audioEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal(AudioEventKind.STARTED) }),
  z.object({
    kind: z.literal(AudioEventKind.FAILED),
    message: z.string()
  }),
  z.object({
    kind: z.literal(AudioEventKind.MIC_CHUNK),
    pcm16: z.instanceof(Uint8Array)
  }),
  z.object({
    kind: z.literal(AudioEventKind.MIC_LEVEL),
    peak: z.number()
  }),
  z.object({
    kind: z.literal(AudioEventKind.SPEAKER_LEVEL),
    peak: z.number()
  }),
  z.object({ kind: z.literal(AudioEventKind.DISPOSED) })
]);

export type AudioCommand = z.infer<typeof audioCommandSchema>;
export type AudioEvent = z.infer<typeof audioEventSchema>;
