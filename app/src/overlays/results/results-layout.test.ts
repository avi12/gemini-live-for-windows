import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isRightToLeft, panelBounds } from "@/overlays/results/results-layout.ts";

const WIDTH = 1920;
const MONITOR = {
  deviceName: "\\.DISPLAY1",
  index: 1,
  isPrimary: true,
  x: 0,
  y: 0,
  width: WIDTH,
  height: 1080,
  workRight: WIDTH,
  workBottom: 1040,
  refreshRateHertz: 60
};
const PANEL = 480;
const GAP = 12;
const DOUBLE = 2;

describe("panelBounds", () => {
  it("docks to the work area's right edge with a gap on every side", () => {
    assert.deepEqual(
      panelBounds({
        monitor: MONITOR,
        scale: 1,
        isRtl: false
      }),
      {
        x: WIDTH - PANEL - GAP,
        y: GAP,
        width: PANEL,
        height: 1016
      }
    );
  });

  it("docks to the left edge for a right-to-left language", () => {
    const bounds = panelBounds({
      monitor: {
        ...MONITOR,
        x: WIDTH
      },
      scale: 1,
      isRtl: true
    });
    assert.equal(bounds.x, WIDTH + GAP);
  });

  it("grows with the display's scale", () => {
    const bounds = panelBounds({
      monitor: MONITOR,
      scale: DOUBLE,
      isRtl: false
    });
    assert.equal(bounds.width, PANEL * DOUBLE);
    assert.equal(bounds.x, WIDTH - PANEL * DOUBLE - GAP * DOUBLE);
  });
});

describe("isRightToLeft", () => {
  it("is true for Hebrew and Arabic, false for English", () => {
    assert.equal(isRightToLeft("he-IL"), true);
    assert.equal(isRightToLeft("ar-SA"), true);
    assert.equal(isRightToLeft("en-US"), false);
  });
});
