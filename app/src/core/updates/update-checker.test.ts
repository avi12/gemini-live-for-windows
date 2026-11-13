import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { noop } from "@/lib/noop.ts";

import type { AppRelease } from "./app-release.ts";
import { createUpdateChecker, UPDATE_INTERVAL_MS, UpdateCheck } from "./update-checker.ts";
import { UpdateMessage } from "./update-protocol.ts";

const SHA256_HEX_LENGTH = 64;
const NEWER: AppRelease = {
  version: "0.2.0.0",
  msixUrl: "https://example.com/a.msix",
  sha256: "0".repeat(SHA256_HEX_LENGTH)
};

function checkerWith(overrides: Partial<Parameters<typeof createUpdateChecker>[0]> = {}) {
  const installs: string[] = [];
  const logs: string[] = [];
  const checker = createUpdateChecker({
    installed: "0.1.0.0",
    isCheckEnabled: () => true,
    findLatest: async () => NEWER,
    download: async () => "C:\\temp\\a.msix",
    install: filePath => installs.push(filePath),
    writeLog: message => logs.push(message),
    ...overrides
  });
  return {
    checker,
    installs,
    logs
  };
}

describe("createUpdateChecker", () => {
  it("skips when unpackaged", async () => {
    const { checker } = checkerWith({ installed: undefined });
    assert.equal(await checker.check({ isManual: true }), UpdateCheck.SKIPPED);
  });

  it("skips an automatic check when the setting is off, but not a manual one", async () => {
    const { checker } = checkerWith({ isCheckEnabled: () => false });
    assert.equal(await checker.check({ isManual: false }), UpdateCheck.SKIPPED);
    assert.equal(await checker.check({ isManual: true }), UpdateCheck.READY);
  });

  it("is up to date for an equal or older release, and when there is none", async () => {
    const feeds = [
      async () => ({
        ...NEWER,
        version: "0.1.0.0"
      }),
      async () => ({
        ...NEWER,
        version: "0.0.9.0"
      }),
      async () => undefined
    ];
    for (const findLatest of feeds) {
      const { checker } = checkerWith({ findLatest });
      assert.equal(await checker.check({ isManual: false }), UpdateCheck.UP_TO_DATE);
      assert.equal(checker.ready, undefined);
    }
  });

  it("becomes ready, tells listeners, and installs the downloaded file", async () => {
    const { checker, installs } = checkerWith();
    const seen: (AppRelease | null)[] = [];
    checker.events.onMessage(UpdateMessage.READY_CHANGED, message => {
      seen.push(message.data);
    });
    assert.equal(checker.install(), false);
    assert.equal(await checker.check({ isManual: false }), UpdateCheck.READY);
    assert.deepEqual(seen, [NEWER]);
    assert.equal(checker.ready, NEWER);
    assert.equal(checker.install(), true);
    assert.deepEqual(installs, ["C:\\temp\\a.msix"]);
  });

  it("fails when the download fails its hash", async () => {
    const { checker } = checkerWith({ download: async () => undefined });
    assert.equal(await checker.check({ isManual: false }), UpdateCheck.FAILED);
    assert.equal(checker.ready, undefined);
  });

  it("fails and logs when the feed throws", async () => {
    const { checker, logs } = checkerWith({
      async findLatest() {
        throw new Error("offline");
      }
    });
    assert.equal(await checker.check({ isManual: false }), UpdateCheck.FAILED);
    assert.ok(logs.some(line => line.includes("offline")));
  });

  it("watches now and every six hours until stopped", async () => {
    let looks = 0;
    let tick: () => void = noop;
    let delay = 0;
    let isStopped = false;
    const { checker } = checkerWith({
      async findLatest() {
        looks += 1;
        return undefined;
      },
      schedule({ work, delayMs }) {
        tick = work;
        delay = delayMs;
        return () => {
          isStopped = true;
        };
      }
    });
    const stop = checker.watch();
    assert.equal(delay, UPDATE_INTERVAL_MS);
    tick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(looks, 2);
    stop();
    assert.equal(isStopped, true);
  });
});
