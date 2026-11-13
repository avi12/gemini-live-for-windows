import fileSystem from "node:fs/promises";
import path from "node:path";

import { log } from "@/core/log/log.ts";
import { userSecret } from "@/core/secret/user-secret.ts";
import type { UserSecret } from "@/core/secret/user-secret.ts";
import { writeFileAtomic } from "@/lib/atomic-file.ts";
import { errorMessage } from "@/lib/error-message.ts";
import { dataDir } from "@/lib/paths.ts";

import { defaultSettings, serializeSettings, settingsFileSchema } from "./settings-file.ts";
import type { Settings } from "./settings-file.ts";

const SETTINGS_FILE = "settings.json";
const API_KEY_VARIABLE = "GEMINI_API_KEY";

interface SettingsDependencies {
  dir: string;
  env: NodeJS.ProcessEnv;
  secret: UserSecret;
  writeLog(message: string): void;
}

async function readText({ filePath, writeLog }: { filePath: string; writeLog: (message: string) => void }) {
  try {
    return await fileSystem.readFile(filePath, "utf8");
  } catch (error) {
    const isMissing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!isMissing) {
      writeLog(`settings unreadable, using defaults: ${errorMessage(error)}`);
    }

    return undefined;
  }
}

async function loadFrom({ filePath, writeLog }: { filePath: string; writeLog: (message: string) => void }) {
  const text = await readText({
    filePath,
    writeLog
  });
  const isMissing = text === undefined;
  if (isMissing) {
    return defaultSettings();
  }

  try {
    const parsed = settingsFileSchema.safeParse(JSON.parse(text));
    if (parsed.success) {
      return parsed.data;
    }

    writeLog(`settings unreadable, using defaults: ${parsed.error.message}`);
  } catch (error) {
    writeLog(`settings unreadable, using defaults: ${errorMessage(error)}`);
  }

  return defaultSettings();
}

function unsealApiKey({
  protectedKey,
  secret,
  writeLog
}: {
  protectedKey: string;
  secret: UserSecret;
  writeLog: (message: string) => void;
}) {
  try {
    const plain = secret.unseal({ sealed: Buffer.from(protectedKey, "base64") });
    const key = Buffer.from(plain).toString("utf8");
    plain.fill(0);
    return key;
  } catch (error) {
    writeLog(`api key unreadable: ${errorMessage(error)}`);
    return "";
  }
}

export function createSettingsStore({ dir, env, secret, writeLog }: SettingsDependencies) {
  const filePath = path.join(dir, SETTINGS_FILE);

  function load() {
    return loadFrom({
      filePath,
      writeLog
    });
  }

  function save(settings: Settings) {
    return writeFileAtomic({
      filePath,
      content: serializeSettings(settings)
    });
  }

  // GEMINI_API_KEY wins, so a key can be rotated without touching the app
  function apiKey(settings: Settings) {
    const fromEnv = env[API_KEY_VARIABLE];
    if (fromEnv) {
      return fromEnv;
    }

    const protectedKey = settings.protectedApiKey;
    if (!protectedKey) {
      return "";
    }

    return unsealApiKey({
      protectedKey,
      secret,
      writeLog
    });
  }

  async function setApiKey({ settings, key }: { settings: Settings; key: string }) {
    const plain = Buffer.from(key.trim(), "utf8");
    try {
      settings.protectedApiKey = Buffer.from(secret.seal({ plain })).toString("base64");
    } finally {
      plain.fill(0);
    }

    await save(settings);
  }

  return {
    load,
    save,
    apiKey,
    setApiKey
  };
}

let shared: ReturnType<typeof createSettingsStore> | undefined;

function sharedStore() {
  shared ??= createSettingsStore({
    dir: dataDir(),
    env: process.env,
    secret: userSecret,
    writeLog: message => log.write(message)
  });
  return shared;
}

export function loadSettings() {
  return sharedStore().load();
}

export function saveSettings(settings: Settings) {
  return sharedStore().save(settings);
}

export function apiKey(settings: Settings) {
  return sharedStore().apiKey(settings);
}

export function hasApiKey(settings: Settings) {
  return apiKey(settings).length > 0;
}

export function setApiKey({ settings, key }: { settings: Settings; key: string }) {
  return sharedStore().setApiKey({
    settings,
    key
  });
}
