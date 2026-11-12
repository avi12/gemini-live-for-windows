import type { Monitor } from "@/contracts/monitor.ts";
import { displayIdOf } from "@/overlays/window/display-id.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const PRIMARY_ID = 1n;
const LEFT_ID = 2n;
const ABOVE_ID = 3n;

function monitorAt({ x, y, width, height }: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return {
    deviceName: "\\.DISPLAY",
    index: 1,
    isPrimary: false,
    x,
    y,
    width,
    height,
    workRight: x + width,
    workBottom: y + height,
    refreshRateHertz: 60
  } satisfies Monitor;
}

// A 4K primary at 100 percent, a 1440p display left of it at 150 percent and higher than its top,
// and a 1080p display above the primary: two negative origins and three different sizes in pixels
const AREAS = [
  {
    id: PRIMARY_ID,
    outerBounds: {
      x: 0,
      y: 0,
      width: 3840,
      height: 2160
    }
  },
  {
    id: LEFT_ID,
    outerBounds: {
      x: -2560,
      y: -200,
      width: 2560,
      height: 1440
    }
  },
  {
    id: ABOVE_ID,
    outerBounds: {
      x: 100,
      y: -1080,
      width: 1920,
      height: 1080
    }
  }
];

describe("displayIdOf", () => {
  it("finds a display left of the primary by its negative origin", () => {
    const monitor = monitorAt({
      x: -2560,
      y: -200,
      width: 2560,
      height: 1440
    });
    assert.equal(
      displayIdOf({
        monitor,
        areas: AREAS
      }), LEFT_ID
    );
  });

  it("finds a display above the primary, whatever order the list is in", () => {
    const monitor = monitorAt({
      x: 100,
      y: -1080,
      width: 1920,
      height: 1080
    });
    assert.equal(
      displayIdOf({
        monitor,
        areas: [...AREAS].reverse()
      }), ABOVE_ID
    );
  });

  it("tells displays of different scales apart by their physical size", () => {
    const monitor = monitorAt({
      x: 0,
      y: 0,
      width: 3840,
      height: 2160
    });
    assert.equal(
      displayIdOf({
        monitor,
        areas: AREAS
      }), PRIMARY_ID
    );
  });

  it("is undefined when the display changed size or went away", () => {
    const resized = monitorAt({
      x: -2560,
      y: -200,
      width: 1920,
      height: 1080
    });
    assert.equal(
      displayIdOf({
        monitor: resized,
        areas: AREAS
      }), undefined
    );
    assert.equal(
      displayIdOf({
        monitor: resized,
        areas: []
      }), undefined
    );
  });
});
