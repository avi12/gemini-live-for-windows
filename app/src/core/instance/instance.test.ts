import { claimInstance, isInstanceRunning } from "./instance.ts";
import { KeyTrigger, parseKeyTrigger } from "./key-trigger.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { describe, it } from "node:test";

const SETTLE_MS = 50;
const WAIT_LIMIT_MS = 2000;
const POLL_MS = 10;

function uniquePipe() {
  return String.raw`\\.\pipe\GeminiLive.Activate.test-${randomUUID()}`;
}

async function until(condition: () => boolean) {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (!condition() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

describe("key trigger", () => {
  it("knows exactly the three names", () => {
    assert.equal(parseKeyTrigger("HoldStart"), KeyTrigger.holdStart);
    assert.equal(parseKeyTrigger("holdstart"), undefined);
    assert.equal(parseKeyTrigger(""), undefined);
  });
});

describe("claimInstance", () => {
  it("makes the first process primary and forwards the second's trigger to it", async () => {
    const pipePath = uniquePipe();
    const received: string[] = [];
    const first = await claimInstance({
      pipePath,
      onTrigger: trigger => received.push(trigger)
    });
    assert.equal(first.isPrimary, true);

    const second = await claimInstance({
      pipePath,
      trigger: KeyTrigger.holdStart,
      onTrigger: () => assert.fail("a second process is never primary")
    });
    assert.deepEqual(second, {
      isPrimary: false,
      isForwarded: true
    });
    await until(() => received.length === 1);
    assert.deepEqual(received, [KeyTrigger.holdStart]);

    if (first.isPrimary) {
      await first.close();
    }
  });

  it("forwards a tap when the second launch carried no trigger", async () => {
    const pipePath = uniquePipe();
    const received: string[] = [];
    const first = await claimInstance({
      pipePath,
      onTrigger: trigger => received.push(trigger)
    });
    await claimInstance({
      pipePath,
      onTrigger: () => undefined
    });
    await until(() => received.length === 1);
    assert.deepEqual(received, [KeyTrigger.tap]);

    if (first.isPrimary) {
      await first.close();
    }
  });

  it("a ping or an unknown trigger never starts anything", async () => {
    const pipePath = uniquePipe();
    const received: string[] = [];
    const first = await claimInstance({
      pipePath,
      onTrigger: trigger => received.push(trigger)
    });
    assert.equal(await isInstanceRunning({ pipePath }), true);
    const socket = net.connect(pipePath);
    socket.write(
      `${JSON.stringify({
        id: 1,
        type: "trigger",
        data: "Bogus",
        timestamp: 1
      })}\n`
    );
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS));
    socket.destroy();
    assert.deepEqual(received, []);

    if (first.isPrimary) {
      await first.close();
    }
  });

  it("reports no instance when nothing serves the pipe", async () => {
    assert.equal(await isInstanceRunning({ pipePath: uniquePipe() }), false);
  });
});
