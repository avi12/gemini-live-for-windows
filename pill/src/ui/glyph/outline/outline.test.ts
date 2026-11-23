import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clipToRegion } from "./clip-outlines.ts";
import { signedArea } from "./geometry.ts";
import { parseOutlines } from "./parse-outlines.ts";

describe("outline path", () => {
  it("reads a closed square as one outline and drops empty moves", () => {
    const outlines = parseOutlines("M0-100h100v100H0Zm50-50Z");
    assert.equal(outlines.length, 1);
    assert.equal(Math.abs(signedArea(outlines[0] ?? [])), 10_000);
  });

  it("clips to a half-plane, keeping the winding", () => {
    const [square = []] = parseOutlines("M0-100h100v100H0Z");
    const [left = []] = clipToRegion({
      outlines: [square],
      region: [
        {
          weightX: -1,
          weightY: 0,
          offset: 50
        }
      ]
    });
    assert.equal(Math.abs(signedArea(left)), 5000);
    assert.equal(Math.sign(signedArea(left)), Math.sign(signedArea(square)));
  });
});
