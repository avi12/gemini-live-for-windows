import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Monitor } from "@/contracts/monitor.ts";
import { FRAME_REFRESH_MS } from "@/live/api/constants.ts";
import { createFakeScreen, TEST_MONITOR } from "@/live/fakes.ts";
import { createFrameSender } from "@/live/frame-sender.ts";

const SECOND_MONITOR: Monitor = {
  ...TEST_MONITOR,
  deviceName: "DISPLAY2",
  index: 2
};
const FRAME_A = new Uint8Array([1, 2]);
const FRAME_B = new Uint8Array([2, 1]);

function setup(frames: readonly Uint8Array[]) {
  const screen = createFakeScreen(frames);
  const sent: Uint8Array[] = [];
  const logs: string[] = [];
  let clock = 0;
  const sender = createFrameSender({
    source: screen.source,
    monitor: TEST_MONITOR,
    send(jpeg) {
      sent.push(jpeg);
    },
    now: () => clock,
    log(message) {
      logs.push(message);
    }
  });
  return {
    sender,
    sent,
    logs,
    screen,
    advance(elapsedMs: number) {
      clock += elapsedMs;
    }
  };
}

describe("frame sender", () => {
  it("sends the first frame", async () => {
    const { sender, sent } = setup([FRAME_A]);
    await sender.tick();
    assert.deepEqual(sent, [FRAME_A]);
  });

  it("skips an unchanged frame until the refresh interval passes", async () => {
    const { sender, sent, advance } = setup([FRAME_A]);
    await sender.tick();
    advance(FRAME_REFRESH_MS - 1);
    await sender.tick();
    assert.equal(sent.length, 1);
    advance(1);
    await sender.tick();
    assert.equal(sent.length, 2);
  });

  it("sends a changed frame at once", async () => {
    const { sender, sent } = setup([FRAME_A, FRAME_B]);
    await sender.tick();
    await sender.tick();
    assert.deepEqual(sent, [FRAME_A, FRAME_B]);
  });

  it("sends immediately after sharing another display and drops the region", async () => {
    const { sender, sent, screen } = setup([FRAME_A]);
    sender.region = {
      x: 1,
      y: 2,
      width: 3,
      height: 4
    };
    await sender.tick();
    sender.share(SECOND_MONITOR);
    await sender.tick();
    assert.equal(sent.length, 2);
    assert.equal(sender.region, undefined);
    assert.deepEqual(screen.targets.at(-1), {
      monitor: SECOND_MONITOR,
      region: undefined
    });
  });

  it("captures the region once it is set", async () => {
    const { sender, screen } = setup([FRAME_A]);
    const region = {
      x: 10,
      y: 20,
      width: 30,
      height: 40
    };
    sender.region = region;
    await sender.tick();
    assert.deepEqual(screen.targets[0]?.region, region);
  });

  it("logs a failed capture and keeps going", async () => {
    const { sender, sent, logs } = setup([]);
    await sender.tick();
    assert.equal(sent.length, 0);
    assert.deepEqual(logs, ["screen capture failed: no frame"]);
  });
});
