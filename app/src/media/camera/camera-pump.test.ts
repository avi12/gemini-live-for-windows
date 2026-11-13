import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Clock } from "@/media/clock.ts";

import { CAMERA_POLL_MILLISECONDS, createCameraPump } from "./camera-pump.ts";
import type { CameraFrame } from "./camera-pump.ts";

const NUMBER_9 = 9;
const NUMBER_7 = 7;

function doNothing() {
  return undefined;
}

function createManualClock() {
  const ticks: (() => void)[] = [];
  const intervals: number[] = [];
  const clock: Clock = {
    now: () => 0,
    setInterval(tick, milliseconds) {
      ticks.push(tick);
      intervals.push(milliseconds);
      return () => ticks.splice(ticks.indexOf(tick), 1);
    }
  };
  return {
    clock,
    intervals,
    fire() {
      for (const tick of ticks) {
        tick();
      }
    },
    get active() {
      return ticks.length;
    }
  };
}

function createFrame({ jpeg, releases, gate }: { jpeg: number; releases: number[]; gate?: Promise<void> }) {
  return {
    async encode() {
      await gate;
      return {
        jpeg: Uint8Array.of(jpeg),
        width: 1280,
        height: 720
      };
    },
    release() {
      releases.push(jpeg);
    }
  };
}

describe("camera pump", () => {
  it("polls twice a second and has nothing until the first frame is encoded", () => {
    const manual = createManualClock();
    createCameraPump({
      source: {
        acquireLatest: () => undefined
      },
      clock: manual.clock,
      onError: () => undefined
    });
    assert.deepEqual(manual.intervals, [CAMERA_POLL_MILLISECONDS]);
  });

  it("keeps the newest encoded frame in the slot and releases every frame it took", async () => {
    const manual = createManualClock();
    const releases: number[] = [];
    const frames = [1, 2].map(jpeg =>
      createFrame({
        jpeg,
        releases
      })
    );
    const pump = createCameraPump({
      source: {
        acquireLatest: () => frames.shift()
      },
      clock: manual.clock,
      onError: () => undefined
    });
    assert.equal(pump.latest(), undefined);
    await pump.tick();
    assert.deepEqual([...(pump.latest()?.jpeg ?? [])], [1]);
    await pump.tick();
    assert.deepEqual([...(pump.latest()?.jpeg ?? [])], [2]);
    assert.deepEqual(releases, [1, 2]);
  });

  it("keeps the old frame when the reader has none yet", async () => {
    const manual = createManualClock();
    const releases: number[] = [];
    const queue: (CameraFrame | undefined)[] = [
      createFrame({
        jpeg: 7,
        releases
      }),
      undefined
    ];
    const pump = createCameraPump({
      source: {
        acquireLatest: () => queue.shift()
      },
      clock: manual.clock,
      onError: () => undefined
    });
    await pump.tick();
    await pump.tick();
    assert.deepEqual([...(pump.latest()?.jpeg ?? [])], [NUMBER_7]);
  });

  it("never encodes two frames at once, and does not even pull while one is in flight", async () => {
    const manual = createManualClock();
    const releases: number[] = [];
    let release: () => void = doNothing;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let pulls = 0;
    const pump = createCameraPump({
      source: {
        acquireLatest() {
          pulls += 1;
          return createFrame({
            jpeg: pulls,
            releases,
            gate
          });
        }
      },
      clock: manual.clock,
      onError: () => undefined
    });
    const first = pump.tick();
    await pump.tick();
    assert.equal(pulls, 1);
    release();
    await first;
    assert.deepEqual(releases, [1]);
  });

  it("reports a failed encode, releases the frame, and carries on", async () => {
    const manual = createManualClock();
    const errors: unknown[] = [];
    const releases: number[] = [];
    const queue: CameraFrame[] = [
      {
        encode: () => Promise.reject(new Error("WIC failed")),
        release: () => releases.push(0)
      },
      createFrame({
        jpeg: 9,
        releases
      })
    ];
    const pump = createCameraPump({
      source: {
        acquireLatest: () => queue.shift()
      },
      clock: manual.clock,
      onError: error => errors.push(error)
    });
    await pump.tick();
    await pump.tick();
    assert.equal(errors.length, 1);
    assert.deepEqual([...(pump.latest()?.jpeg ?? [])], [NUMBER_9]);
    assert.deepEqual(releases, [0, NUMBER_9]);
  });

  it("reports a reader that throws on acquire", async () => {
    const manual = createManualClock();
    const errors: unknown[] = [];
    const pump = createCameraPump({
      source: {
        acquireLatest() {
          throw new Error("camera lost");
        }
      },
      clock: manual.clock,
      onError: error => errors.push(error)
    });
    await pump.tick();
    assert.equal(errors.length, 1);
  });

  it("stops polling when told to", () => {
    const manual = createManualClock();
    const pump = createCameraPump({
      source: {
        acquireLatest: () => undefined
      },
      clock: manual.clock,
      onError: () => undefined
    });
    pump.stop();
    assert.equal(manual.active, 0);
  });
});
