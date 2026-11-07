import { EngineKind } from "@gemini-live/protocol/view";
import { z } from "zod";

const DEFAULT_MODEL = "gemini-3.8-live";
const DEFAULT_VOICE = "Kore";
const INDENT = 2;

// The file the C# app wrote and still reads: PascalCase keys, string enums, nulls for unset
const FILE_KEY = {
  engine: "Engine",
  model: "Model",
  voice: "Voice",
  protectedApiKey: "ProtectedApiKey",
  microphoneId: "MicrophoneId",
  checkForUpdates: "CheckForUpdates"
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

export const settingsFileSchema = z.object({
  [FILE_KEY.engine]: engineSchema.default(EngineKind.google),
  [FILE_KEY.model]: z.string().default(DEFAULT_MODEL),
  [FILE_KEY.voice]: z.string().default(DEFAULT_VOICE),
  [FILE_KEY.protectedApiKey]: z.string().nullish().transform(value => value ?? null),
  [FILE_KEY.microphoneId]: z.string().nullish().transform(value => value ?? null),
  [FILE_KEY.checkForUpdates]: z.boolean().default(true)
}).transform(file => ({
  engine: file[FILE_KEY.engine],
  model: file[FILE_KEY.model],
  voice: file[FILE_KEY.voice],
  protectedApiKey: file[FILE_KEY.protectedApiKey],
  microphoneId: file[FILE_KEY.microphoneId],
  checkForUpdates: file[FILE_KEY.checkForUpdates]
}));

export type Settings = z.infer<typeof settingsFileSchema>;

export function defaultSettings() {
  return settingsFileSchema.parse({});
}

export function serializeSettings(settings: Settings) {
  return JSON.stringify({
    [FILE_KEY.engine]: settings.engine,
    [FILE_KEY.model]: settings.model,
    [FILE_KEY.voice]: settings.voice,
    [FILE_KEY.protectedApiKey]: settings.protectedApiKey,
    [FILE_KEY.microphoneId]: settings.microphoneId,
    [FILE_KEY.checkForUpdates]: settings.checkForUpdates
  }, null, INDENT);
}
