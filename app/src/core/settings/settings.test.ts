import assert from "node:assert/strict";
import fileSystem from "node:fs/promises";
import operatingSystem from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { EngineKind } from "@gemini-live/protocol/view";

import type { UserSecret } from "@/core/secret/user-secret.ts";

import { createSettingsStore } from "./settings.ts";

// What the C# app writes: System.Text.Json, indented, PascalCase, JsonStringEnumConverter
const CSHARP_FILE = `{
  "Engine": "ApiKey",
  "Model": "gemini-3.8-live",
  "Voice": "Puck",
  "ProtectedApiKey": "c2VhbGVk",
  "MicrophoneId": null,
  "CheckForUpdates": false
}`;

const reversingSecret: UserSecret = {
  seal: ({ plain }) => Buffer.from(plain).reverse(),
  unseal: ({ sealed }) => Buffer.from(sealed).reverse()
};

describe("settings store", () => {
  let dir = "";
  let logs: string[] = [];
  beforeEach(async () => {
    dir = await fileSystem.mkdtemp(path.join(operatingSystem.tmpdir(), "gl-settings-"));
    logs = [];
  });
  afterEach(async () => {
    await fileSystem.rm(dir, {
      recursive: true,
      force: true
    });
  });

  function store(env: NodeJS.ProcessEnv = {}) {
    return createSettingsStore({
      dir,
      env,
      secret: reversingSecret,
      writeLog: message => logs.push(message)
    });
  }

  it("gives defaults when there is no file", async () => {
    assert.deepEqual(await store().load(), {
      engine: EngineKind.GOOGLE,
      model: "gemini-3.8-live",
      voice: "Kore",
      protectedApiKey: null,
      microphoneId: null,
      checkForUpdates: true
    });
  });

  it("reads a settings.json written by the C# app", async () => {
    await fileSystem.writeFile(path.join(dir, "settings.json"), CSHARP_FILE);
    assert.deepEqual(await store().load(), {
      engine: EngineKind.API_KEY,
      model: "gemini-3.8-live",
      voice: "Puck",
      protectedApiKey: "c2VhbGVk",
      microphoneId: null,
      checkForUpdates: false
    });
  });

  it("reads enum names in any casing, as .NET does", async () => {
    await fileSystem.writeFile(path.join(dir, "settings.json"), `{"Engine":"apikey"}`);
    assert.equal((await store().load()).engine, EngineKind.API_KEY);
  });

  it("fills missing properties with defaults", async () => {
    await fileSystem.writeFile(path.join(dir, "settings.json"), `{"Voice":"Aoede"}`);
    const settings = await store().load();
    assert.equal(settings.voice, "Aoede");
    assert.equal(settings.checkForUpdates, true);
  });

  it("falls back to defaults and logs when the file is damaged", async () => {
    await fileSystem.writeFile(path.join(dir, "settings.json"), `{"Engine": "Nope"}`);
    assert.equal((await store().load()).engine, EngineKind.GOOGLE);
    await fileSystem.writeFile(path.join(dir, "settings.json"), "not json");
    assert.equal((await store().load()).engine, EngineKind.GOOGLE);
    assert.equal(logs.length, 2);
  });

  it("writes the same shape the C# app reads: PascalCase, two-space indent, enum names", async () => {
    const settings = await store().load();
    settings.engine = EngineKind.API_KEY;
    await store().save(settings);
    const text = await fileSystem.readFile(path.join(dir, "settings.json"), "utf8");
    assert.equal(
      text,
      [
        "{",
        '  "Engine": "ApiKey",',
        '  "Model": "gemini-3.8-live",',
        '  "Voice": "Kore",',
        '  "ProtectedApiKey": null,',
        '  "MicrophoneId": null,',
        '  "CheckForUpdates": true',
        "}"
      ].join("\n")
    );
    assert.deepEqual(await fileSystem.readdir(dir), ["settings.json"]);
  });

  it("seals the key on disk and reads it back", async () => {
    const settings = await store().load();
    await store().setApiKey({
      settings,
      key: "  secret-key \n"
    });
    const onDisk = await fileSystem.readFile(path.join(dir, "settings.json"), "utf8");
    assert.ok(!onDisk.includes("secret-key"));
    assert.equal(store().apiKey(await store().load()), "secret-key");
  });

  it("lets GEMINI_API_KEY win over the sealed key", async () => {
    const settings = await store().load();
    await store().setApiKey({
      settings,
      key: "sealed"
    });
    assert.equal(store({ GEMINI_API_KEY: "from-env" }).apiKey(settings), "from-env");
    assert.equal(store({ GEMINI_API_KEY: "" }).apiKey(settings), "sealed");
  });

  it("reads an unreadable sealed key as no key, and logs it", async () => {
    const throwing = createSettingsStore({
      dir,
      env: {},
      secret: {
        seal: () => new Uint8Array(),
        unseal() {
          throw new Error("bad data");
        }
      },
      writeLog: message => logs.push(message)
    });
    const settings = await store().load();
    settings.protectedApiKey = "AAAA";
    assert.equal(throwing.apiKey(settings), "");
    assert.equal(logs.length, 1);
  });
});
