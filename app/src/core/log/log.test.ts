import { createLog, formatTimestamp, isDebugging } from "./log.ts";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

describe("log", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "gl-log-"));
  });
  afterEach(async () => {
    await fs.rm(dir, {
      recursive: true,
      force: true
    });
  });

  it("formats HH:mm:ss.fff", () => {
    assert.equal(formatTimestamp(new Date("2026-01-02T03:04:05.006")), "03:04:05.006");
  });

  it("appends timestamped CRLF lines, creating the folder", async () => {
    const nested = path.join(dir, "GeminiLive");
    const log = createLog({
      dir: nested,
      now: () => new Date("2026-01-02T13:04:05.678")
    });
    log.write("first");
    log.write("second");
    assert.equal(await fs.readFile(path.join(nested, "log.txt"), "utf8"), "13:04:05.678 first\r\n13:04:05.678 second\r\n");
  });

  it("never throws when the file can't be written", async () => {
    const blocker = path.join(dir, "file");
    await fs.writeFile(blocker, "");
    const log = createLog({
      dir: blocker,
      now: () => new Date()
    });
    assert.doesNotThrow(() => log.write("lost"));
  });

  it("debugs on the env variable or a debug.flag file", async () => {
    assert.equal(
      isDebugging({
        dir,
        env: {}
      }), false
    );
    assert.equal(
      isDebugging({
        dir,
        env: {
          GEMINI_LIVE_DEBUG: ""
        }
      }), true
    );
    await fs.writeFile(path.join(dir, "debug.flag"), "");
    assert.equal(
      isDebugging({
        dir,
        env: {}
      }), true
    );
  });
});
