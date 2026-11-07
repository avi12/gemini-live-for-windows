import { readLinkFile, writeLinkFile } from "./link-file.ts";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

describe("link file", () => {
  let dir = "";
  let filePath = "";
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "gl-link-"));
    filePath = path.join(dir, "link.json");
  });
  afterEach(async () => {
    await fs.rm(dir, {
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
    assert.deepEqual(JSON.parse(await fs.readFile(filePath, "utf8")), {
      port: 4242,
      token: "t0k"
    });
    assert.deepEqual(await fs.readdir(dir), ["link.json"]);
  });

  it("reads what the C# app wrote while the app runs", async () => {
    await fs.writeFile(filePath, "{\"port\":4242,\"token\":\"t0k\"}");
    assert.deepEqual(
      await readLinkFile({
        filePath,
        isRunning: running
      }), {
        port: 4242,
        token: "t0k"
      }
    );
  });

  it("reads nothing when the app is not running", async () => {
    await fs.writeFile(filePath, "{\"port\":4242,\"token\":\"t0k\"}");
    assert.equal(
      await readLinkFile({
        filePath,
        isRunning: stopped
      }), undefined
    );
  });

  it("reads nothing from a missing, damaged or empty-token file", async () => {
    assert.equal(
      await readLinkFile({
        filePath,
        isRunning: running
      }), undefined
    );
    for (const text of ["nope", "{\"port\":0,\"token\":\"x\"}", "{\"port\":1,\"token\":\"\"}", "{}"]) {
      await fs.writeFile(filePath, text);
      assert.equal(
        await readLinkFile({
          filePath,
          isRunning: running
        }), undefined, text
      );
    }
  });
});
