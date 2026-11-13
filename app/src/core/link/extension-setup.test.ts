import assert from "node:assert/strict";
import fileSystem from "node:fs/promises";
import operatingSystem from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { defaultBrowser } from "./default-browser.ts";
import { connectExtension, refreshInstalledExtension } from "./extension-setup.ts";

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
    root = await fileSystem.mkdtemp(path.join(operatingSystem.tmpdir(), "gl-ext-"));
    shippedDir = path.join(root, "shipped");
    targetDir = path.join(root, "installed");
    await fileSystem.mkdir(path.join(shippedDir, "assets"), { recursive: true });
    await fileSystem.writeFile(path.join(shippedDir, "manifest.json"), '{"v":2}');
    await fileSystem.writeFile(path.join(shippedDir, "assets", "a.js"), "a");
  });
  afterEach(async () => {
    await fileSystem.rm(root, {
      recursive: true,
      force: true
    });
  });

  it("copies the files, puts the folder on the clipboard and opens the extensions page", async () => {
    const copied: string[] = [];
    const launched: {
      file: string;
      args: readonly string[];
    }[] = [];
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
    assert.equal(await fileSystem.readFile(path.join(targetDir, "assets", "a.js"), "utf8"), "a");
    assert.deepEqual(copied, [targetDir]);
    assert.deepEqual(launched, [
      {
        file: "cmd.exe",
        args: ["/c", "start", "", "chrome", "chrome://extensions"]
      }
    ]);
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
    await assert.rejects(fileSystem.access(targetDir));
    await fileSystem.mkdir(targetDir);
    await refreshInstalledExtension({
      shippedDir,
      targetDir
    });
    assert.equal(await fileSystem.readFile(path.join(targetDir, "manifest.json"), "utf8"), '{"v":2}');
  });
});
