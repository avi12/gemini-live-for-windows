import { displayNamed, haveDisplaysChanged, orderDisplays, reconcileDisplay } from "./monitor-layout.ts";
import type { RawDisplay } from "./monitor-structs.ts";
import { createMonitors, NO_DISPLAY_MESSAGE, watchDisplays } from "./monitors.ts";
import type { DisplayNative } from "./monitors.ts";
import type { Clock } from "@/media/clock.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const NUMBER_3 = 3;
const NUMBER_48 = 48;
const NUMBER_1080 = 1080;
const NUMBER_1920 = 1920;

function raw({ name, left, top = 0, width = NUMBER_1920, height = NUMBER_1080, isPrimary = false }: {
  name: string;
  left: number;
  top?: number;
  width?: number;
  height?: number;
  isPrimary?: boolean;
}) {
  return {
    deviceName: name,
    isPrimary,
    left,
    top,
    right: left + width,
    bottom: top + height,
    workRight: left + width,
    workBottom: top + height - NUMBER_48
  } satisfies RawDisplay;
}

const LEFT = raw({
  name: "\\\\.\\DISPLAY14",
  left: -3840,
  top: -134,
  width: 3840,
  height: 2160
});
const MAIN = raw({
  name: "\\\\.\\DISPLAY13",
  left: 0,
  width: 3840,
  height: 2160,
  isPrimary: true
});
const RIGHT = raw({
  name: "\\\\.\\DISPLAY15",
  left: 3840
});

describe("display order", () => {
  it("numbers left to right from 1, whatever order Windows listed them", () => {
    const monitors = orderDisplays([RIGHT, MAIN, LEFT]);
    assert.deepEqual(monitors.map(monitor => [monitor.index, monitor.deviceName]), [
      [1, LEFT.deviceName],
      [2, MAIN.deviceName],
      [NUMBER_3, RIGHT.deviceName]
    ]);
  });

  it("breaks a tie on the left edge top to bottom", () => {
    const upper = raw({
      name: "upper",
      left: 100,
      top: 0
    });
    const lower = raw({
      name: "lower",
      left: 100,
      top: 1080
    });
    assert.deepEqual(orderDisplays([lower, upper]).map(monitor => monitor.deviceName), ["upper", "lower"]);
  });

  it("converts the rectangle to a position and a size, keeping the work edges", () => {
    const [monitor] = orderDisplays([LEFT]);
    assert.deepEqual(monitor, {
      deviceName: LEFT.deviceName,
      index: 1,
      isPrimary: false,
      x: -3840,
      y: -134,
      width: 3840,
      height: 2160,
      workRight: 0,
      workBottom: 1978
    });
  });

  it("lists a display once when two devices map to it", () => {
    assert.equal(orderDisplays([MAIN, MAIN]).length, 1);
  });

  it("skips a display with no area rather than failing", () => {
    const empty = raw({
      name: "ghost",
      left: 5,
      width: 0
    });
    assert.deepEqual(orderDisplays([empty, MAIN]).map(monitor => monitor.deviceName), [MAIN.deviceName]);
  });

  it("is empty for no displays", () => {
    assert.deepEqual(orderDisplays([]), []);
  });
});

describe("display lookup", () => {
  const all = orderDisplays([LEFT, MAIN, RIGHT]);

  it("finds a display by the name Windows gave it", () => {
    assert.equal(
      displayNamed({
        all,
        deviceName: RIGHT.deviceName
      })?.index, NUMBER_3
    );
  });

  it("falls back to the primary one when the name is gone or missing", () => {
    assert.equal(
      displayNamed({
        all,
        deviceName: "gone"
      })?.deviceName, MAIN.deviceName
    );
    assert.equal(
      displayNamed({
        all,
        deviceName: undefined
      })?.deviceName, MAIN.deviceName
    );
  });

  it("falls back to the first when none is primary, and to nothing when empty", () => {
    const noPrimary = orderDisplays([raw({
      name: "a",
      left: 0
    })]);
    assert.equal(
      displayNamed({
        all: noPrimary,
        deviceName: "x"
      })?.deviceName, "a"
    );
    assert.equal(
      displayNamed({
        all: [],
        deviceName: "x"
      }), undefined
    );
  });
});

describe("reconcile", () => {
  const before = orderDisplays([LEFT, MAIN, RIGHT]);

  it("returns the current version of the same physical display after the numbering moved", () => {
    const after = orderDisplays([MAIN, RIGHT]);
    const shared = before.find(monitor => monitor.deviceName === MAIN.deviceName);
    assert.ok(shared);
    const current = reconcileDisplay({
      all: after,
      display: shared,
      fallback() {
        throw new Error("must not fall back");
      }
    });
    assert.equal(current.index, 1);
    assert.equal(current.deviceName, MAIN.deviceName);
  });

  it("falls back to the active display when the shared one was unplugged", () => {
    const after = orderDisplays([MAIN, RIGHT]);
    const unplugged = before.find(monitor => monitor.deviceName === LEFT.deviceName);
    assert.ok(unplugged);
    const fallback = after[0];
    assert.ok(fallback);
    assert.equal(
      reconcileDisplay({
        all: after,
        display: unplugged,
        fallback: () => fallback
      }), fallback
    );
  });
});

describe("change detection", () => {
  it("is false for the same list, true for a count, a move or a resize", () => {
    const base = orderDisplays([LEFT, MAIN]);
    assert.equal(
      haveDisplaysChanged({
        before: base,
        after: orderDisplays([LEFT, MAIN])
      }), false
    );
    assert.equal(
      haveDisplaysChanged({
        before: base,
        after: orderDisplays([MAIN])
      }), true
    );
    assert.equal(
      haveDisplaysChanged({
        before: base,
        after: orderDisplays([LEFT, {
          ...MAIN,
          left: 10
        }])
      }), true
    );
    assert.equal(
      haveDisplaysChanged({
        before: base,
        after: orderDisplays([LEFT, {
          ...MAIN,
          right: MAIN.right + 1
        }])
      }), true
    );
  });
});

function createNative({ displays, foreground, cursor }: {
  displays: RawDisplay[];
  foreground?: string;
  cursor?: string;
}) {
  const state = {
    displays,
    foreground,
    cursor
  };
  const native: DisplayNative = {
    listRawDisplays: () => state.displays,
    foregroundDisplayName: () => state.foreground,
    cursorDisplayName: () => state.cursor
  };
  return {
    native,
    state
  };
}

describe("monitors", () => {
  it("lists, and finds the active display from the foreground window", () => {
    const { native } = createNative({
      displays: [MAIN, LEFT],
      foreground: LEFT.deviceName
    });
    const monitors = createMonitors({ native });
    assert.equal(monitors.all().length, 2);
    assert.equal(monitors.active().deviceName, LEFT.deviceName);
  });

  it("finds the display under the cursor, not the active one", () => {
    const { native } = createNative({
      displays: [MAIN, LEFT],
      foreground: LEFT.deviceName,
      cursor: MAIN.deviceName
    });
    assert.equal(createMonitors({ native }).underCursor().deviceName, MAIN.deviceName);
  });

  it("uses the active display when the cursor cannot be read", () => {
    const { native } = createNative({
      displays: [MAIN, LEFT],
      foreground: LEFT.deviceName
    });
    assert.equal(createMonitors({ native }).underCursor().deviceName, LEFT.deviceName);
  });

  it("says so when there is no display", () => {
    const { native } = createNative({ displays: [] });
    assert.throws(() => createMonitors({ native }).active(), new RegExp(NO_DISPLAY_MESSAGE));
  });

  it("reconciles against the active display", () => {
    const { native, state } = createNative({
      displays: [MAIN, LEFT],
      foreground: MAIN.deviceName
    });
    const monitors = createMonitors({ native });
    const shared = monitors.all()[0];
    assert.ok(shared);
    state.displays = [MAIN];
    const current = monitors.reconcile({
      current: monitors.all(),
      display: shared
    });
    assert.equal(current.deviceName, MAIN.deviceName);
  });
});

describe("display watcher", () => {
  function createManualClock() {
    const ticks: Array<() => void> = [];
    const clock: Clock = {
      now: () => 0,
      setInterval(tick) {
        ticks.push(tick);
        return () => ticks.splice(ticks.indexOf(tick), 1);
      }
    };
    return {
      clock,
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

  it("reports a change once, and nothing while the list is steady", () => {
    const { native, state } = createNative({ displays: [MAIN] });
    const manual = createManualClock();
    const changes: number[] = [];
    watchDisplays({
      monitors: createMonitors({ native }),
      clock: manual.clock,
      onChange: current => changes.push(current.length)
    });
    manual.fire();
    assert.deepEqual(changes, []);
    state.displays = [MAIN, LEFT];
    manual.fire();
    manual.fire();
    assert.deepEqual(changes, [2]);
    state.displays = [MAIN];
    manual.fire();
    assert.deepEqual(changes, [2, 1]);
  });

  it("stops when told to", () => {
    const { native } = createNative({ displays: [MAIN] });
    const manual = createManualClock();
    const stop = watchDisplays({
      monitors: createMonitors({ native }),
      clock: manual.clock,
      onChange: () => undefined
    });
    stop();
    assert.equal(manual.active, 0);
  });
});
