import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bracketPath, GlowSide, glowSidePaths, outsetRect } from "@/overlays/circle/glow-geometry.ts";

describe("glowSidePaths", () => {
  const paths = glowSidePaths({
    rect: {
      x: 10,
      y: 20,
      width: 100,
      height: 60
    },
    radius: 10
  });

  it("has one path for each side", () => {
    assert.deepEqual(Object.keys(paths).toSorted(), Object.values(GlowSide).toSorted());
  });

  it("runs the top side along the top edge between its two corners", () => {
    assert.ok(paths.top.includes("L 100,20"));
    assert.ok(paths.top.startsWith("M "));
  });

  it("runs each side through both of its corner arcs", () => {
    for (const path of Object.values(paths)) {
      assert.equal(path.split("A ").length - 1, 2);
    }
  });
});

const TEST_RADIUS = 10;

describe("outsetRect", () => {
  it("grows the rectangle by half the stroke on every side, rounding the corner as much", () => {
    const { rect, radius } = outsetRect({
      rect: {
        x: 10,
        y: 20,
        width: 100,
        height: 60
      },
      radius: TEST_RADIUS,
      width: 8
    });
    assert.deepEqual(rect, {
      x: 6,
      y: 16,
      width: 108,
      height: 68
    });
    const grownBy = 4;
    assert.equal(radius, TEST_RADIUS + grownBy);
  });
});

describe("bracketPath", () => {
  it("draws four corners", () => {
    const path = bracketPath({
      rect: {
        x: 0,
        y: 0,
        width: 100,
        height: 100
      },
      radius: 10
    });
    const corners = 4;
    assert.equal(path.split("M").length - 1, corners);
  });
});
