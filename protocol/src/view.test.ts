import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_REFRESH_RATE_HERTZ,
  knownRefreshRate,
  pillViewSchema,
  previewFramesPerSecond,
  refreshRateSchema
} from "./view.ts";

const HERTZ_60 = 60;
const HERTZ_120 = 120;
const NON_INTEGER_HERTZ = 59.94;

const SLOW = {
  id: "\\\\.\\DISPLAY1",
  index: 1,
  isPrimary: true,
  refreshRateHertz: HERTZ_60,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080
};
const FAST = {
  id: "\\\\.\\DISPLAY2",
  index: 2,
  isPrimary: false,
  refreshRateHertz: HERTZ_120,
  x: 1920,
  y: 0,
  width: 1920,
  height: 1080
};

describe("refresh rate schema", () => {
  it("accepts a positive whole number", () => {
    assert.equal(refreshRateSchema.safeParse(HERTZ_120).success, true);
  });

  it("rejects zero, negatives and fractions", () => {
    for (const hertz of [0, -HERTZ_60, NON_INTEGER_HERTZ]) {
      assert.equal(refreshRateSchema.safeParse(hertz).success, false);
    }
  });

  it("makes a display entry without a rate invalid", () => {
    const parsed = pillViewSchema.shape.displays.safeParse([
      {
        id: SLOW.id,
        index: SLOW.index
      }
    ]);
    assert.equal(parsed.success, false);
  });
});

describe("unknown refresh rates", () => {
  it("falls back to 60 for 0 and 1", () => {
    assert.equal(knownRefreshRate(0), DEFAULT_REFRESH_RATE_HERTZ);
    assert.equal(knownRefreshRate(1), DEFAULT_REFRESH_RATE_HERTZ);
  });

  it("keeps a real rate, rounded to a whole number", () => {
    assert.equal(knownRefreshRate(HERTZ_120), HERTZ_120);
    assert.equal(knownRefreshRate(NON_INTEGER_HERTZ), HERTZ_60);
  });

  it("falls back for a rate that is not a number", () => {
    assert.equal(knownRefreshRate(Number.NaN), DEFAULT_REFRESH_RATE_HERTZ);
  });
});

describe("preview frames per second", () => {
  it("follows the display the pill is on, not a faster one beside it", () => {
    assert.equal(
      previewFramesPerSecond({
        displays: [SLOW, FAST],
        pillDisplay: SLOW.id
      }),
      HERTZ_60
    );
  });

  it("runs at 120 when the pill is on the 120 Hz display", () => {
    assert.equal(
      previewFramesPerSecond({
        displays: [SLOW, FAST],
        pillDisplay: FAST.id
      }),
      HERTZ_120
    );
  });

  it("falls back to 60 while the pill is on no known display", () => {
    assert.equal(
      previewFramesPerSecond({
        displays: [FAST],
        pillDisplay: null
      }),
      DEFAULT_REFRESH_RATE_HERTZ
    );
  });
});
