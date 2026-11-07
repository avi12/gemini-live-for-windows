import { BROWSER_KEYS, hostKey, ORIGINS_KEY, registerNativeHost } from "./native-host-registration.ts";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

describe("registerNativeHost", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "gl-host-"));
  });
  afterEach(async () => {
    await fs.rm(dir, {
      recursive: true,
      force: true
    });
  });

  it("writes the manifest the browsers read", async () => {
    await registerNativeHost({
      hostPath: "C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps\\GeminiLiveHost.exe",
      dir,
      setDefaultValue: async () => undefined
    });
    const manifest = JSON.parse(await fs.readFile(path.join(dir, "com.avi12.gemini_live.json"), "utf8"));
    assert.deepEqual(manifest, {
      name: "com.avi12.gemini_live",
      description: "Tells the Gemini Live extension where the running app listens",
      path: "C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps\\GeminiLiveHost.exe",
      type: "stdio",
      [ORIGINS_KEY]: ["chrome-extension://bejbkccodipbnbjeagmihnhnfadnjgeh/"]
    });
  });

  it("points Chrome, Edge, Brave and Chromium at the manifest", async () => {
    const written: Array<{
      key: string;
      value: string;
    }> = [];
    await registerNativeHost({
      hostPath: "host.exe",
      dir,
      async setDefaultValue(command) {
        written.push(command);
      }
    });
    const manifest = path.join(dir, "com.avi12.gemini_live.json");
    assert.deepEqual(written.map(entry => entry.key).sort(), [
      "HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\com.avi12.gemini_live",
      "HKCU\\Software\\Chromium\\NativeMessagingHosts\\com.avi12.gemini_live",
      "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.avi12.gemini_live",
      "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.avi12.gemini_live"
    ]);
    assert.ok(written.every(entry => entry.value === manifest));
    assert.equal(written.length, BROWSER_KEYS.length);
    assert.equal(hostKey(BROWSER_KEYS[0]), written.find(entry => entry.key.includes("Chrome"))?.key);
  });
});
