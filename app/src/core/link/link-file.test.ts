import assert from "node:assert/strict";
import fileSystem from "node:fs/promises";
import operatingSystem from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { readLinkFile, writeLinkFile } from "./link-file.ts";

describe("link file", () => {
  let dir = "";
  let filePath = "";
  beforeEach(async () => {
    dir = await fileSystem.mkdtemp(path.join(operatingSystem.tmpdir(), "gl-link-"));
    filePath = path.join(dir, "link.json");
  });
  afterEach(async () => {
    await fileSystem.rm(dir, {
      recursive: true,
      force: true
    });
  });

  async function running() {
    return true;
  }

  async function stopped() {
    return false;
  }

  it("writes {port, token} whole, leaving no temporary file", async () => {
    await writeLinkFile({
      link: {
        port: 4242,
        token: "t0k"
      },
      filePath
    });
    assert.deepEqual(JSON.parse(await fileSystem.readFile(filePath, "utf8")), {
      port: 4242,
      token: "t0k"
    });
    assert.deepEqual(await fileSystem.readdir(dir), ["link.json"]);
  });

  it("reads what the C# app wrote while the app runs", async () => {
    await fileSystem.writeFile(filePath, '{"port":4242,"token":"t0k"}');
    assert.deepEqual(
      await readLinkFile({
        filePath,
        isRunning: running
      }),
      {
        port: 4242,
        token: "t0k"
      }
    );
  });

  it("reads nothing when the app is not running", async () => {
    await fileSystem.writeFile(filePath, '{"port":4242,"token":"t0k"}');
    assert.equal(
      await readLinkFile({
        filePath,
        isRunning: stopped
      }),
      undefined
    );
  });

  it("reads nothing from a missing, damaged or empty-token file", async () => {
    assert.equal(
      await readLinkFile({
        filePath,
        isRunning: running
      }),
      undefined
    );
    for (const text of ["nope", '{"port":0,"token":"x"}', '{"port":1,"token":""}', "{}"]) {
      await fileSystem.writeFile(filePath, text);
      assert.equal(
        await readLinkFile({
          filePath,
          isRunning: running
        }),
        undefined,
        text
      );
    }
  });
});
