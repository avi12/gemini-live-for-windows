import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { micPathData } from "./mic-icon.ts";

const SIZE = 24;

function figuresOf(data: string) {
  return data.match(/M/g)?.length ?? 0;
}

describe("mic icon", () => {
  it("is the plain mic at rest: capsule, stand and hole, no slash", () => {
    const data = micPathData({
      progress: 0,
      size: SIZE
    });
    assert.ok(data.startsWith("F1 "));
    assert.equal(figuresOf(data), 3);
  });

  it("adds the slash and the cut pieces once muting starts", () => {
    assert.ok(
      figuresOf(
        micPathData({
          progress: 1,
          size: SIZE
        })
      ) >
        figuresOf(
          micPathData({
            progress: 0,
            size: SIZE
          })
        )
    );
  });

  it("keeps every point inside the icon", () => {
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const numbers =
        micPathData({
          progress,
          size: SIZE
        })
          .match(/-?\d+\.\d+/g)
          ?.map(Number) ?? [];
      assert.ok(
        numbers.every(value => value >= 0 && value <= SIZE),
        `progress ${progress}`
      );
    }
  });
});
