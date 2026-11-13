import { z } from "zod";

// The public Gemini Live API's wire messages (BidiGenerateContent, https://ai.google.dev/api/live),
// only the parts the session sends or reads. Strict where the app depends on a field, lenient
// elsewhere: fields Google adds later pass through and are reported once as unhandled.

export const Modality = {
  AUDIO: "AUDIO",
  TEXT: "TEXT"
} as const;

export const MediaResolution = {
  LOW: "MEDIA_RESOLUTION_LOW",
  MEDIUM: "MEDIA_RESOLUTION_MEDIUM",
  HIGH: "MEDIA_RESOLUTION_HIGH"
} as const;

const blobSchema = z.object({
  mimeType: z.string(),
  data: z.string()
});

const contentSchema = z.object({
  parts: z.array(
    z.object({
      text: z.string().optional(),
      inlineData: blobSchema.optional()
    })
  )
});

const emptyConfigSchema = z.object({});

const setupSchema = z.object({
  model: z.string(),
  generationConfig: z.object({
    responseModalities: z.array(z.enum(Modality)),
    mediaResolution: z.enum(MediaResolution),
    speechConfig: z.object({
      voiceConfig: z.object({
        prebuiltVoiceConfig: z.object({ voiceName: z.string() })
      })
    })
  }),
  systemInstruction: contentSchema,
  tools: z.array(z.object({ googleSearch: emptyConfigSchema.optional() })),
  inputAudioTranscription: emptyConfigSchema,
  outputAudioTranscription: emptyConfigSchema,
  contextWindowCompression: z.object({ slidingWindow: emptyConfigSchema.optional() }),
  sessionResumption: z.object({ handle: z.string().optional() })
});

const realtimeInputSchema = z.object({
  audio: blobSchema.optional(),
  video: blobSchema.optional()
});

export type RealtimeInput = z.infer<typeof realtimeInputSchema>;

export const clientMessageSchema = z.union([
  z.object({ setup: setupSchema }),
  z.object({ realtimeInput: realtimeInputSchema })
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// Proto JSON leaves empty strings and false booleans off the wire, so missing reads as empty
const transcriptionSchema = z.object({ text: z.string().default("") });

const serverContentSchema = z.object({
  interrupted: z.boolean().default(false),
  modelTurn: contentSchema.optional(),
  inputTranscription: transcriptionSchema.optional(),
  outputTranscription: transcriptionSchema.optional()
});

const serverMessageSchema = z.looseObject({
  setupComplete: z.looseObject({}).optional(),
  serverContent: serverContentSchema.optional(),
  goAway: z.looseObject({ timeLeft: z.string().optional() }).optional(),
  sessionResumptionUpdate: z
    .object({
      resumable: z.boolean().default(false),
      newHandle: z.string().optional()
    })
    .optional()
});

export type ServerMessage = z.infer<typeof serverMessageSchema>;

export const HANDLED_SERVER_FIELDS: ReadonlySet<string> = new Set(Object.keys(serverMessageSchema.shape));

export function serializeClientMessage(message: ClientMessage) {
  return JSON.stringify(clientMessageSchema.parse(message));
}

const serverFrameSchema = z
  .string()
  .transform((text, context) => {
    try {
      return JSON.parse(text);
    } catch {
      context.addIssue({
        code: "custom",
        message: "not JSON"
      });
      return z.NEVER;
    }
  })
  .pipe(serverMessageSchema);

export function parseServerFrame(text: string) {
  return serverFrameSchema.safeParse(text);
}
