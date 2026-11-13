import { EngineKind } from "@gemini-live/protocol/view";
import { z } from "zod";

const DEFAULT_MODEL = "gemini-3.8-live";
const DEFAULT_VOICE = "Kore";
const INDENT = 2;

// The file the C# app wrote and still reads: PascalCase keys, string enums, nulls for unset
const FILE_KEY = {
  ENGINE: "Engine",
  MODEL: "Model",
  VOICE: "Voice",
  PROTECTED_API_KEY: "ProtectedApiKey",
  MICROPHONE_ID: "MicrophoneId",
  CHECK_FOR_UPDATES: "CheckForUpdates"
} as const;

// .NET's JsonStringEnumConverter reads names in any casing
function canonicalEngine(value: unknown) {
  const isText = typeof value === "string";
  if (!isText) {
    return value;
  }

  const lowered = value.toLowerCase();
  return Object.values(EngineKind).find(kind => kind.toLowerCase() === lowered) ?? value;
}

const engineSchema = z.preprocess(canonicalEngine, z.enum(EngineKind));

export const settingsFileSchema = z
  .object({
    [FILE_KEY.ENGINE]: engineSchema.default(EngineKind.GOOGLE),
    [FILE_KEY.MODEL]: z.string().default(DEFAULT_MODEL),
    [FILE_KEY.VOICE]: z.string().default(DEFAULT_VOICE),
    [FILE_KEY.PROTECTED_API_KEY]: z
      .string()
      .nullish()
      .transform(value => value ?? null),
    [FILE_KEY.MICROPHONE_ID]: z
      .string()
      .nullish()
      .transform(value => value ?? null),
    [FILE_KEY.CHECK_FOR_UPDATES]: z.boolean().default(true)
  })
  .transform(file => ({
    engine: file[FILE_KEY.ENGINE],
    model: file[FILE_KEY.MODEL],
    voice: file[FILE_KEY.VOICE],
    protectedApiKey: file[FILE_KEY.PROTECTED_API_KEY],
    microphoneId: file[FILE_KEY.MICROPHONE_ID],
    checkForUpdates: file[FILE_KEY.CHECK_FOR_UPDATES]
  }));

export type Settings = z.infer<typeof settingsFileSchema>;

export function defaultSettings() {
  return settingsFileSchema.parse({});
}

export function serializeSettings(settings: Settings) {
  return JSON.stringify(
    {
      [FILE_KEY.ENGINE]: settings.engine,
      [FILE_KEY.MODEL]: settings.model,
      [FILE_KEY.VOICE]: settings.voice,
      [FILE_KEY.PROTECTED_API_KEY]: settings.protectedApiKey,
      [FILE_KEY.MICROPHONE_ID]: settings.microphoneId,
      [FILE_KEY.CHECK_FOR_UPDATES]: settings.checkForUpdates
    },
    null,
    INDENT
  );
}
