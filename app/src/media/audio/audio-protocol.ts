import { z } from "zod";

// The two directions of the audio worker's message port. Both ends parse what they receive: the
// worker is a thread boundary, and a malformed message must fail loudly, not play garbage.
export const AudioCommandKind = {
  start: "start",
  play: "play",
  flush: "flush",
  mute: "mute",
  dispose: "dispose"
} as const;

export const AudioEventKind = {
  started: "started",
  failed: "failed",
  micChunk: "micChunk",
  micLevel: "micLevel",
  speakerLevel: "speakerLevel",
  disposed: "disposed"
} as const;

export const audioCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(AudioCommandKind.start),
    deviceId: z.string().nullable(),
    isLoopback: z.boolean()
  }),
  z.object({
    kind: z.literal(AudioCommandKind.play),
    pcm16: z.instanceof(Uint8Array)
  }),
  z.object({ kind: z.literal(AudioCommandKind.flush) }),
  z.object({
    kind: z.literal(AudioCommandKind.mute),
    isMuted: z.boolean()
  }),
  z.object({ kind: z.literal(AudioCommandKind.dispose) })
]);

export const audioEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal(AudioEventKind.started) }),
  z.object({
    kind: z.literal(AudioEventKind.failed),
    message: z.string()
  }),
  z.object({
    kind: z.literal(AudioEventKind.micChunk),
    pcm16: z.instanceof(Uint8Array)
  }),
  z.object({
    kind: z.literal(AudioEventKind.micLevel),
    peak: z.number()
  }),
  z.object({
    kind: z.literal(AudioEventKind.speakerLevel),
    peak: z.number()
  }),
  z.object({ kind: z.literal(AudioEventKind.disposed) })
]);

export type AudioCommand = z.infer<typeof audioCommandSchema>;
export type AudioEvent = z.infer<typeof audioEventSchema>;
