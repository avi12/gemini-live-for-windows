import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dragRegion, gripAt, MIN_REGION_SIZE, RegionGrip } from "@/overlays/region/region-drag.ts";

const MONITOR = {
  x: 0,
  y: 0,
  width: 1000,
  height: 800
};
const START = {
  x: 200,
  y: 200,
  width: 300,
  height: 200
};
const FRAME = {
  width: 100,
  height: 80
};
const CORNER = 20;

function gripAtPoint(point: { x: number; y: number }) {
  return gripAt({
    point,
    size: FRAME,
    corner: CORNER
  });
}

describe("gripAt", () => {
  it("holds a corner within the corner zone of two sides", () => {
    assert.equal(
      gripAtPoint({
        x: 5,
        y: 5
      }),
      RegionGrip.TOP_LEFT
    );
    assert.equal(
      gripAtPoint({
        x: 95,
        y: 5
      }),
      RegionGrip.TOP_RIGHT
    );
    assert.equal(
      gripAtPoint({
        x: 95,
        y: 75
      }),
      RegionGrip.BOTTOM_RIGHT
    );
    assert.equal(
      gripAtPoint({
        x: 5,
        y: 75
      }),
      RegionGrip.BOTTOM_LEFT
    );
  });

  it("holds the side, to move, anywhere else", () => {
    assert.equal(
      gripAt({
        point: {
          x: 50,
          y: 5
        },
        size: FRAME,
        corner: CORNER
      }),
      RegionGrip.MOVE
    );
  });
});

describe("dragRegion", () => {
  it("moves the region whole", () => {
    assert.deepEqual(
      dragRegion({
        start: START,
        grip: RegionGrip.MOVE,
        delta: {
          x: 50,
          y: -30
        },
        monitor: MONITOR
      }),
      {
        x: 250,
        y: 170,
        width: 300,
        height: 200
      }
    );
  });

  it("keeps a moved region on the display", () => {
    const moved = dragRegion({
      start: START,
      grip: RegionGrip.MOVE,
      delta: {
        x: 5000,
        y: -5000
      },
      monitor: MONITOR
    });
    assert.equal(moved.x, MONITOR.width - START.width);
    assert.equal(moved.y, 0);
  });

  it("pulls the bottom right corner out, keeping the top left", () => {
    assert.deepEqual(
      dragRegion({
        start: START,
        grip: RegionGrip.BOTTOM_RIGHT,
        delta: {
          x: 40,
          y: 60
        },
        monitor: MONITOR
      }),
      {
        x: 200,
        y: 200,
        width: 340,
        height: 260
      }
    );
  });

  it("pulls the top left corner, keeping the bottom right", () => {
    assert.deepEqual(
      dragRegion({
        start: START,
        grip: RegionGrip.TOP_LEFT,
        delta: {
          x: -50,
          y: -20
        },
        monitor: MONITOR
      }),
      {
        x: 150,
        y: 180,
        width: 350,
        height: 220
      }
    );
  });

  it("never lets a region shrink below the smallest size", () => {
    const small = dragRegion({
      start: START,
      grip: RegionGrip.BOTTOM_RIGHT,
      delta: {
        x: -5000,
        y: -5000
      },
      monitor: MONITOR
    });
    assert.equal(small.width, MIN_REGION_SIZE);
    assert.equal(small.height, MIN_REGION_SIZE);
  });
});
