import type { Monitor, Region } from "@/contracts/monitor.ts";
import {
  borderBounds,
  CHIP_GAP,
  chipOrigin,
  REGION_FRAME_GAP,
  regionAfterDrag
} from "@/overlays/focus/focus-layout.ts";
import { createScreenFocus } from "@/overlays/focus/screen-focus.ts";
import type { FocusWindows } from "@/overlays/focus/screen-focus.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const PRIMARY: Monitor = {
  deviceName: "\\\\.\\DISPLAY1",
  index: 1,
  isPrimary: true,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  workRight: 1920,
  workBottom: 1040
};
const SECOND: Monitor = {
  deviceName: "\\\\.\\DISPLAY2",
  index: 2,
  isPrimary: false,
  x: 1920,
  y: -200,
  width: 2560,
  height: 1440,
  workRight: 4480,
  workBottom: 1240
};
const REGION: Region = {
  x: 100,
  y: 200,
  width: 300,
  height: 150
};

const CHIP_HEIGHT = 48;
const TRUNCATED_X = 110;
const FLUSH_REGION: Region = {
  x: 100,
  y: 20,
  width: 300,
  height: 150
};

describe("borderBounds", () => {
  it("covers the display exactly when no region is watched", () => {
    assert.deepEqual(
      borderBounds({
        monitor: SECOND,
        region: null
      }), {
        x: 1920,
        y: -200,
        width: 2560,
        height: 1440
      }
    );
  });

  it("frames a region just outside it, in screen pixels", () => {
    assert.deepEqual(
      borderBounds({
        monitor: SECOND,
        region: REGION
      }), {
        x: SECOND.x + REGION.x - REGION_FRAME_GAP,
        y: SECOND.y + REGION.y - REGION_FRAME_GAP,
        width: REGION.width + REGION_FRAME_GAP * 2,
        height: REGION.height + REGION_FRAME_GAP * 2
      }
    );
  });
});

describe("chipOrigin", () => {
  it("sits above the region's frame", () => {
    assert.deepEqual(
      chipOrigin({
        monitor: SECOND,
        region: REGION,
        chipHeight: CHIP_HEIGHT
      }), {
        x: SECOND.x + REGION.x,
        y: SECOND.y + (REGION.y - CHIP_GAP - CHIP_HEIGHT)
      }
    );
  });

  it("sits below when there is no room above", () => {
    assert.deepEqual(
      chipOrigin({
        monitor: PRIMARY,
        region: FLUSH_REGION,
        chipHeight: CHIP_HEIGHT
      }), {
        x: 100,
        y: FLUSH_REGION.y + FLUSH_REGION.height + CHIP_GAP
      }
    );
  });

  it("stays above when it just fits", () => {
    const fits: Region = {
      x: 0,
      y: 58,
      width: 10,
      height: 10
    };
    assert.equal(
      chipOrigin({
        monitor: PRIMARY,
        region: fits,
        chipHeight: CHIP_HEIGHT
      }).y, 0
    );
  });
});

describe("regionAfterDrag", () => {
  it("moves by the pointer's travel and keeps the size", () => {
    assert.deepEqual(
      regionAfterDrag({
        start: REGION,
        travelled: {
          x: 50,
          y: -20
        },
        monitor: PRIMARY
      }), {
        x: 150,
        y: 180,
        width: 300,
        height: 150
      }
    );
  });

  it("stops at the display's edges", () => {
    assert.deepEqual(
      regionAfterDrag({
        start: REGION,
        travelled: {
          x: -999,
          y: -999
        },
        monitor: PRIMARY
      }), {
        x: 0,
        y: 0,
        width: 300,
        height: 150
      }
    );
    assert.deepEqual(
      regionAfterDrag({
        start: REGION,
        travelled: {
          x: 9999,
          y: 9999
        },
        monitor: PRIMARY
      }), {
        x: 1620,
        y: 930,
        width: 300,
        height: 150
      }
    );
  });

  it("truncates a fractional travel", () => {
    const result = regionAfterDrag({
      start: REGION,
      travelled: {
        x: 10.9,
        y: 0.4
      },
      monitor: PRIMARY
    });
    assert.equal(result.x, TRUNCATED_X);
    assert.equal(result.y, REGION.y);
  });
});

interface MutableEngine {
  monitor: Monitor;
  region: Region | undefined;
  share(monitor: Monitor): void;
}

function setup({ hasEngine = true }: { hasEngine?: boolean } = {}) {
  const calls: string[] = [];
  const lines: string[] = [];
  const shared: Monitor[] = [];
  const engine: MutableEngine = {
    monitor: PRIMARY,
    region: undefined,
    share(monitor) {
      shared.push(monitor);
      engine.monitor = monitor;
    }
  };
  const windows: FocusWindows = {
    coverBorder: ({ monitor, region }) => calls.push(`border:${monitor.index}:${region === null ? "whole" : `${region.x},${region.y}`}`),
    hideBorder: () => calls.push("hideBorder"),
    attachChip: ({ region }) => calls.push(`chip:${region.x},${region.y}`),
    hideChip: () => calls.push("hideChip"),
    holdEscape: ({ isHeld }) => calls.push(`escape:${isHeld}`)
  };
  const focus = createScreenFocus({
    windows,
    currentEngine: () => (hasEngine ? engine : undefined),
    log: {
      write: message => lines.push(message)
    }
  });
  return {
    calls,
    lines,
    shared,
    engine,
    focus
  };
}

describe("createScreenFocus", () => {
  it("covers a display and hides the border", () => {
    const { calls, focus } = setup();
    focus.cover(SECOND);
    focus.hideBorder();
    assert.deepEqual(calls, ["border:2:whole", "hideBorder"]);
  });

  it("focuses on a region: engine, frame, chip, Esc", () => {
    const { calls, lines, engine, focus } = setup();
    let changes = 0;
    focus.onChanged(() => changes++);
    focus.focusOn({
      monitor: PRIMARY,
      region: REGION
    });
    assert.deepEqual(engine.region, REGION);
    assert.deepEqual(calls, ["border:1:100,200", "chip:100,200", "escape:true"]);
    assert.equal(changes, 1);
    assert.deepEqual(lines, ["focused on 300×150 of Display 1"]);
  });

  it("shares another display first when the region is on it", () => {
    const { shared, engine, focus } = setup();
    focus.focusOn({
      monitor: SECOND,
      region: REGION
    });
    assert.deepEqual(shared, [SECOND]);
    assert.equal(engine.monitor, SECOND);
  });

  it("does not re-share the display it already watches", () => {
    const { shared, focus } = setup();
    focus.focusOn({
      monitor: PRIMARY,
      region: REGION
    });
    assert.deepEqual(shared, []);
  });

  it("does nothing without an engine", () => {
    const { calls, focus } = setup({ hasEngine: false });
    focus.focusOn({
      monitor: PRIMARY,
      region: REGION
    });
    assert.deepEqual(calls, []);
  });

  it("hands back the whole display on unfocus", () => {
    const { calls, lines, engine, focus } = setup();
    focus.focusOn({
      monitor: PRIMARY,
      region: REGION
    });
    calls.length = 0;
    focus.unfocus();
    assert.equal(engine.region, undefined);
    assert.deepEqual(calls, ["border:1:whole", "hideChip", "escape:false"]);
    assert.equal(lines.at(-1), "focus: whole display again");
  });

  it("only tidies up when no region was watched", () => {
    const { calls, focus } = setup();
    focus.unfocus();
    assert.deepEqual(calls, ["hideChip", "escape:false"]);
  });

  it("answers Esc and the chip's X with an unfocus", () => {
    const { engine, focus } = setup();
    focus.focusOn({
      monitor: PRIMARY,
      region: REGION
    });
    focus.events.escapePressed();
    assert.equal(engine.region, undefined);
    focus.focusOn({
      monitor: PRIMARY,
      region: REGION
    });
    focus.events.chipDismissed();
    assert.equal(engine.region, undefined);
  });

  it("lets go of Esc while the circle overlay is up and takes it back after", () => {
    const { calls, focus } = setup();
    focus.focusOn({
      monitor: PRIMARY,
      region: REGION
    });
    calls.length = 0;
    focus.setCircling(true);
    focus.setCircling(false);
    assert.deepEqual(calls, ["escape:false", "escape:true"]);
  });

  it("never holds Esc for the circle overlay without a region", () => {
    const { calls, focus } = setup();
    focus.setCircling(true);
    focus.setCircling(false);
    assert.deepEqual(calls, ["escape:false", "escape:false"]);
  });

  it("moves the region with the chip drag and reframes it", () => {
    const { calls, engine, focus } = setup();
    focus.focusOn({
      monitor: PRIMARY,
      region: REGION
    });
    calls.length = 0;
    focus.events.chipDragStarted();
    focus.events.chipDragged({
      x: 40,
      y: 60
    });
    assert.deepEqual(engine.region, {
      x: 140,
      y: 260,
      width: 300,
      height: 150
    });
    assert.deepEqual(calls, ["border:1:140,260", "chip:140,260"]);
    focus.events.chipDragged({
      x: 80,
      y: 0
    });
    assert.deepEqual(engine.region, {
      x: 180,
      y: 200,
      width: 300,
      height: 150
    });
  });

  it("ignores a drag that never started", () => {
    const { calls, focus } = setup();
    focus.events.chipDragged({
      x: 40,
      y: 60
    });
    assert.deepEqual(calls, []);
  });

  it("stops telling a listener that unsubscribed", () => {
    const { focus } = setup();
    let changes = 0;
    const stop = focus.onChanged(() => changes++);
    stop();
    focus.unfocus();
    assert.equal(changes, 0);
  });
});
