import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { barPlacement, BarSide, cornerRadius, roundedRectsPath } from "@/overlays/circle/gesture/geometry.ts";

const SCREEN = {
  width: 1920,
  height: 1080
};
const SELECTION_RADIUS_EXPECTED = 24;
const SHRUNK_RADIUS_EXPECTED = 15;
const BAR_MARGIN_EXPECTED = 16;
const BAR = {
  width: 300,
  height: 64
};

describe("cornerRadius", () => {
  it("is the selection radius on a big area", () => {
    assert.equal(
      cornerRadius({
        x: 0,
        y: 0,
        width: 400,
        height: 300
      }),
      SELECTION_RADIUS_EXPECTED
    );
  });

  it("shrinks with a small area", () => {
    assert.equal(
      cornerRadius({
        x: 0,
        y: 0,
        width: 30,
        height: 100
      }),
      SHRUNK_RADIUS_EXPECTED
    );
  });
});

describe("barPlacement", () => {
  it("goes centred just below the selection", () => {
    const result = barPlacement({
      selection: {
        x: 800,
        y: 300,
        width: 200,
        height: 200
      },
      bar: BAR,
      screen: SCREEN
    });
    assert.deepEqual(result, {
      side: BarSide.BELOW,
      origin: {
        x: 750,
        y: 512
      }
    });
  });

  it("goes beside, toward the wider half, when there is no room below", () => {
    const result = barPlacement({
      selection: {
        x: 800,
        y: 900,
        width: 200,
        height: 150
      },
      bar: BAR,
      screen: SCREEN
    });
    assert.deepEqual(result, {
      side: BarSide.RIGHT,
      origin: {
        x: 1012,
        y: 943
      }
    });
  });

  it("goes to the left for a selection on the right half", () => {
    const result = barPlacement({
      selection: {
        x: 1100,
        y: 900,
        width: 200,
        height: 150
      },
      bar: BAR,
      screen: SCREEN
    });
    assert.deepEqual(result, {
      side: BarSide.LEFT,
      origin: {
        x: 788,
        y: 943
      }
    });
  });

  it("prefers the right for a selection on the left half", () => {
    const result = barPlacement({
      selection: {
        x: 100,
        y: 900,
        width: 200,
        height: 150
      },
      bar: BAR,
      screen: SCREEN
    });
    assert.equal(result.side, BarSide.RIGHT);
  });

  it("falls back to the left side when the right has no room", () => {
    const result = barPlacement({
      selection: {
        x: 1500,
        y: 900,
        width: 300,
        height: 150
      },
      bar: BAR,
      screen: SCREEN
    });
    assert.equal(result.side, BarSide.LEFT);
  });

  it("goes above when neither side has room, clamped on screen", () => {
    const result = barPlacement({
      selection: {
        x: 50,
        y: 900,
        width: 200,
        height: 150
      },
      bar: BAR,
      screen: {
        width: 400,
        height: 1080
      }
    });
    assert.deepEqual(result, {
      side: BarSide.ABOVE,
      origin: {
        x: 16,
        y: 824
      }
    });
  });

  it("goes inside the bottom edge when the selection fills the screen", () => {
    const result = barPlacement({
      selection: {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080
      },
      bar: BAR,
      screen: SCREEN
    });
    assert.deepEqual(result, {
      side: BarSide.INSIDE,
      origin: {
        x: 810,
        y: 1000
      }
    });
  });

  it("clamps a bar that sticks out to the margin", () => {
    const result = barPlacement({
      selection: {
        x: 0,
        y: 300,
        width: 40,
        height: 40
      },
      bar: BAR,
      screen: SCREEN
    });
    assert.equal(result.origin.x, BAR_MARGIN_EXPECTED);
  });
});

describe("roundedRectsPath", () => {
  it("draws every box as one nonzero path", () => {
    const path = roundedRectsPath({
      rects: [
        {
          x: 0,
          y: 0,
          width: 10,
          height: 10
        },
        {
          x: 20,
          y: 0,
          width: 10,
          height: 10
        }
      ],
      radius: 3
    });
    assert.ok(
      path.startsWith("F1 M3,0 H7 A3,3 0 0 1 10,3 V7 A3,3 0 0 1 7,10 H3 A3,3 0 0 1 0,7 V3 A3,3 0 0 1 3,0 Z M23,0")
    );
  });

  it("shrinks the radius for a tiny box", () => {
    const path = roundedRectsPath({
      rects: [
        {
          x: 0,
          y: 0,
          width: 4,
          height: 4
        }
      ],
      radius: 3
    });
    assert.ok(path.startsWith("F1 M2,0 H2 A2,2"));
  });

  it("is empty of figures without boxes", () => {
    assert.equal(
      roundedRectsPath({
        rects: [],
        radius: 3
      }),
      "F1 "
    );
  });
});
