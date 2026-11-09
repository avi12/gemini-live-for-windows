import { createCaptureFeed } from "./capture-feed.ts";
import { createCaptureManager } from "./capture-manager.ts";
import { timerScheduler } from "./capture-scheduler.ts";
import { framePeriodMilliseconds } from "./capture-schema.ts";
import type { CaptureBridge, CaptureConfig, CaptureScheduler, PreviewFrame } from "./capture-schema.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const SIZE = {
  width: 4,
  height: 2
};
const BYTES_PER_PIXEL = 4;
const RATE_30 = 30;
const RATE_60 = 60;
const RATE_120 = 120;
const MILLISECONDS_PER_SECOND = 1000;
const INTERVAL_AT_30 = MILLISECONDS_PER_SECOND / RATE_30;
const INTERVAL_AT_60 = MILLISECONDS_PER_SECOND / RATE_60;
const INTERVAL_AT_120 = MILLISECONDS_PER_SECOND / RATE_120;
const SCHEDULER_WINDOW_MILLISECONDS = 1000;
const SCHEDULER_TOLERANCE = 0.05;
const FRAME: PreviewFrame = {
  ...SIZE,
  pixels: new Uint8Array(SIZE.width * SIZE.height * BYTES_PER_PIXEL)
};

function createFakes() {
  const opened: CaptureConfig[] = [];
  const closed: string[] = [];
  const queue: Array<PreviewFrame | undefined> = [];
  const timers = new Map<number, {
    intervalMilliseconds: number;
    run: () => void;
  }>();
  let nextTimer = 0;
  const bridge: CaptureBridge = {
    openSource(config) {
      opened.push(config);
      return {
        readNextFrame: () => queue.shift(),
        close: () => closed.push(config.displayId)
      };
    }
  };
  const scheduler: CaptureScheduler = {
    every(timer) {
      const id = nextTimer++;
      timers.set(id, timer);
      return () => timers.delete(id);
    }
  };
  function tickAll() {
    for (const timer of timers.values()) {
      timer.run();
    }
  }
  return {
    bridge,
    scheduler,
    opened,
    closed,
    queue,
    timers,
    tickAll
  };
}

describe("framePeriodMilliseconds", () => {
  it("is the exact period, so the scheduler can correct its drift", () => {
    assert.equal(framePeriodMilliseconds(RATE_60), INTERVAL_AT_60);
    assert.equal(framePeriodMilliseconds(RATE_120), INTERVAL_AT_120);
    assert.equal(framePeriodMilliseconds(RATE_30), INTERVAL_AT_30);
  });
});

describe("timerScheduler", () => {
  it("holds the target rate by correcting its drift", async () => {
    let ticks = 0;
    const cancel = timerScheduler.every({
      intervalMilliseconds: framePeriodMilliseconds(RATE_60),
      run: () => ticks++
    });
    await new Promise(resolve => setTimeout(resolve, SCHEDULER_WINDOW_MILLISECONDS));
    cancel();
    const expected = RATE_60 * SCHEDULER_WINDOW_MILLISECONDS / MILLISECONDS_PER_SECOND;
    assert.ok(Math.abs(ticks - expected) <= expected * SCHEDULER_TOLERANCE, `${ticks} ticks, expected ${expected}`);
  });
});

describe("createCaptureFeed", () => {
  it("delivers a frame only when one is new and skips empty ticks", () => {
    const { bridge, scheduler, queue, tickAll } = createFakes();
    const received: PreviewFrame[] = [];
    createCaptureFeed({
      displayId: "1",
      targetFramesPerSecond: 60,
      size: SIZE,
      bridge,
      scheduler,
      onFrame: frame => received.push(frame)
    });
    queue.push(undefined, FRAME, undefined);
    tickAll();
    tickAll();
    tickAll();
    assert.deepEqual(received, [FRAME]);
  });

  it("schedules at the interval of the target rate", () => {
    const { bridge, scheduler, timers } = createFakes();
    createCaptureFeed({
      displayId: "1",
      targetFramesPerSecond: 120,
      size: SIZE,
      bridge,
      scheduler,
      onFrame: () => undefined
    });
    assert.deepEqual([...timers.values()].map(timer => timer.intervalMilliseconds), [INTERVAL_AT_120]);
  });

  it("stops idempotently, closing the source and cancelling the timer once", () => {
    const { bridge, scheduler, closed, timers } = createFakes();
    const feed = createCaptureFeed({
      displayId: "1",
      targetFramesPerSecond: 60,
      size: SIZE,
      bridge,
      scheduler,
      onFrame: () => undefined
    });
    feed.stop();
    feed.stop();
    assert.deepEqual(closed, ["1"]);
    assert.equal(timers.size, 0);
  });

  it("rejects an invalid config before opening anything", () => {
    const { bridge, scheduler, opened } = createFakes();
    assert.throws(() => createCaptureFeed({
      displayId: "abc",
      targetFramesPerSecond: 60,
      size: SIZE,
      bridge,
      scheduler,
      onFrame: () => undefined
    }));
    assert.throws(() => createCaptureFeed({
      displayId: "1",
      targetFramesPerSecond: 0,
      size: SIZE,
      bridge,
      scheduler,
      onFrame: () => undefined
    }));
    assert.throws(() => createCaptureFeed({
      displayId: "1",
      targetFramesPerSecond: 60,
      size: {
        width: 0,
        height: 2
      },
      bridge,
      scheduler,
      onFrame: () => undefined
    }));
    assert.equal(opened.length, 0);
  });

  it("stops itself and reports when reading a frame throws", () => {
    const { bridge, closed, tickAll, scheduler } = createFakes();
    const failing: CaptureBridge = {
      openSource: config => ({
        readNextFrame() {
          throw new Error("lost");
        },
        close: () => closed.push(config.displayId)
      })
    };
    const errors: unknown[] = [];
    createCaptureFeed({
      displayId: "1",
      targetFramesPerSecond: 60,
      size: SIZE,
      bridge: failing,
      scheduler,
      onFrame: () => undefined,
      onError: error => errors.push(error)
    });
    tickAll();
    tickAll();
    assert.equal(errors.length, 1);
    assert.deepEqual(closed, ["1"]);
    assert.ok(bridge);
  });
});

describe("createCaptureManager", () => {
  function setup() {
    const fakes = createFakes();
    const frames: Array<{
      displayId: string;
      frame: PreviewFrame;
    }> = [];
    const errors: Array<{
      displayId: string;
      error: unknown;
    }> = [];
    const manager = createCaptureManager({
      bridge: fakes.bridge,
      scheduler: fakes.scheduler,
      size: SIZE,
      onFrame: event => frames.push(event),
      onError: event => errors.push(event)
    });
    return {
      ...fakes,
      manager,
      frames,
      errors
    };
  }

  it("starts nothing while closed and starts every display on open", () => {
    const { manager, opened } = setup();
    manager.setDisplays([{
      displayId: "1",
      targetFramesPerSecond: 60
    }, {
      displayId: "2",
      targetFramesPerSecond: 120
    }]);
    assert.equal(opened.length, 0);
    manager.setOpen(true);
    assert.deepEqual(opened.map(config => config.displayId), ["1", "2"]);
  });

  it("stops every feed on close", () => {
    const { manager, closed } = setup();
    manager.setDisplays([{
      displayId: "1",
      targetFramesPerSecond: 60
    }, {
      displayId: "2",
      targetFramesPerSecond: 60
    }]);
    manager.setOpen(true);
    manager.setOpen(false);
    assert.deepEqual(closed.toSorted(), ["1", "2"]);
  });

  it("leaves unchanged feeds running, adds, removes and restarts only on a rate change", () => {
    const { manager, opened, closed } = setup();
    manager.setOpen(true);
    manager.setDisplays([{
      displayId: "1",
      targetFramesPerSecond: 60
    }, {
      displayId: "2",
      targetFramesPerSecond: 60
    }]);
    manager.setDisplays([{
      displayId: "1",
      targetFramesPerSecond: 60
    }, {
      displayId: "2",
      targetFramesPerSecond: 120
    }, {
      displayId: "3",
      targetFramesPerSecond: 60
    }]);
    assert.deepEqual(opened.map(config => `${config.displayId}@${config.targetFramesPerSecond}`), ["1@60", "2@60", "2@120", "3@60"]);
    assert.deepEqual(closed, ["2"]);
    manager.setDisplays([{
      displayId: "3",
      targetFramesPerSecond: 60
    }]);
    assert.deepEqual(closed, ["2", "1", "2"]);
  });

  it("tags delivered frames with their display", () => {
    const { manager, queue, tickAll, frames } = setup();
    manager.setOpen(true);
    manager.setDisplays([{
      displayId: "7",
      targetFramesPerSecond: 60
    }]);
    queue.push(FRAME);
    tickAll();
    assert.deepEqual(frames, [{
      displayId: "7",
      frame: FRAME
    }]);
  });

  it("reports a display that cannot open and keeps the others", () => {
    const fakes = createFakes();
    const errors: string[] = [];
    const bridge: CaptureBridge = {
      openSource(config) {
        const isBrokenDisplay = config.displayId === "1";
        if (isBrokenDisplay) {
          throw new Error("cannot capture");
        }

        return fakes.bridge.openSource(config);
      }
    };
    const manager = createCaptureManager({
      bridge,
      scheduler: fakes.scheduler,
      size: SIZE,
      onFrame: () => undefined,
      onError: event => errors.push(event.displayId)
    });
    manager.setOpen(true);
    manager.setDisplays([{
      displayId: "1",
      targetFramesPerSecond: 60
    }, {
      displayId: "2",
      targetFramesPerSecond: 60
    }]);
    assert.deepEqual(errors, ["1"]);
    assert.deepEqual(fakes.opened.map(config => config.displayId), ["2"]);
  });

  it("rejects malformed display lists", () => {
    const { manager } = setup();
    assert.throws(() => manager.setDisplays([{
      displayId: "x",
      targetFramesPerSecond: 60
    }]));
  });

  it("stop releases everything and is repeatable", () => {
    const { manager, closed, timers } = setup();
    manager.setOpen(true);
    manager.setDisplays([{
      displayId: "1",
      targetFramesPerSecond: 60
    }]);
    manager.stop();
    manager.stop();
    assert.deepEqual(closed, ["1"]);
    assert.equal(timers.size, 0);
  });
});
