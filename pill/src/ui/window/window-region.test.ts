import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { regionOf } from "./window-region.ts";

const CLIENT = {
  width: 1008,
  height: 960
};
const SCALE = 2;
// The root fills the window's 480 device-independent pixels of height
const ROOT = {
  x: 0,
  y: 0,
  width: 504,
  height: 480
};
const PILL = {
  x: 18,
  y: 396,
  width: 468,
  height: 76
};

describe("window region", () => {
  it("is the band from the pill's glow room down, full width, with no card", () => {
    const region = regionOf({
      pill: PILL,
      card: undefined,
      root: ROOT,
      scale: SCALE,
      client: CLIENT,
      isOrb: false
    });
    assert.deepEqual(region, {
      x: 0,
      y: 760,
      width: 1008,
      height: 200
    });
  });

  it("starts at the card when the card is above the pill", () => {
    const region = regionOf({
      pill: PILL,
      card: {
        ...PILL,
        y: 200
      },
      root: ROOT,
      scale: SCALE,
      client: CLIENT,
      isOrb: false
    });
    assert.equal(region.y, 368);
  });

  it("is the orb with a small margin once it has settled", () => {
    const region = regionOf({
      pill: {
        x: 410,
        y: 396,
        width: 76,
        height: 76
      },
      card: undefined,
      root: ROOT,
      scale: SCALE,
      client: CLIENT,
      isOrb: true
    });
    assert.deepEqual(region, {
      x: 818,
      y: 790,
      width: 156,
      height: 156
    });
  });
});
