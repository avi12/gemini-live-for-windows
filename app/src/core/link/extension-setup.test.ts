import { defaultBrowser } from "./default-browser.ts";
import { connectExtension, refreshInstalledExtension } from "./extension-setup.ts";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

describe("default browser", () => {
  it("follows the https handler's ProgId", async () => {
    assert.deepEqual(await defaultBrowser(async () => "ChromeHTML"), {
      executable: "chrome",
      extensionsPage: "chrome://extensions"
    });
    assert.deepEqual(await defaultBrowser(async () => "BraveHTML"), {
      executable: "brave",
      extensionsPage: "brave://extensions"
    });
    assert.deepEqual(await defaultBrowser(async () => "MSEdgeHTM"), {
      executable: "msedge",
      extensionsPage: "edge://extensions"
    });
    assert.equal((await defaultBrowser(async () => "")).executable, "msedge");
  });
});

describe("extension setup", () => {
  let root = "";
  let shippedDir = "";
  let targetDir = "";
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "gl-ext-"));
    shippedDir = path.join(root, "shipped");
    targetDir = path.join(root, "installed");
    await fs.mkdir(path.join(shippedDir, "assets"), { recursive: true });
    await fs.writeFile(path.join(shippedDir, "manifest.json"), "{\"v\":2}");
    await fs.writeFile(path.join(shippedDir, "assets", "a.js"), "a");
  });
  afterEach(async () => {
    await fs.rm(root, {
      recursive: true,
      force: true
    });
  });

  it("copies the files, puts the folder on the clipboard and opens the extensions page", async () => {
    const copied: string[] = [];
    const launched: Array<{
      file: string;
      args: readonly string[];
    }> = [];
    await connectExtension({
      shippedDir,
      targetDir,
      async copyText(text) {
        copied.push(text);
      },
      launch: command => launched.push(command),
      findBrowser: async () => ({
        executable: "chrome",
        extensionsPage: "chrome://extensions"
      })
    });
    assert.equal(await fs.readFile(path.join(targetDir, "assets", "a.js"), "utf8"), "a");
    assert.deepEqual(copied, [targetDir]);
    assert.deepEqual(launched, [{
      file: "cmd.exe",
      args: ["/c", "start", "", "chrome", "chrome://extensions"]
    }]);
  });

  it("still opens the page when the clipboard is busy", async () => {
    const launched: unknown[] = [];
    await connectExtension({
      shippedDir,
      targetDir,
      async copyText() {
        throw new Error("busy");
      },
      launch: command => launched.push(command),
      findBrowser: async () => ({
        executable: "msedge",
        extensionsPage: "edge://extensions"
      })
    });
    assert.equal(launched.length, 1);
  });

  it("refreshes an installed copy but does nothing before the first setup", async () => {
    await refreshInstalledExtension({
      shippedDir,
      targetDir
    });
    await assert.rejects(fs.access(targetDir));
    await fs.mkdir(targetDir);
    await refreshInstalledExtension({
      shippedDir,
      targetDir
    });
    assert.equal(await fs.readFile(path.join(targetDir, "manifest.json"), "utf8"), "{\"v\":2}");
  });
});
