import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CLOSE_FULLSCREEN, foldPathData, OPEN_IN_FULL } from "./fold-icon.ts";
import { ICON_GRID } from "./outline/geometry.ts";

const SIZE = 24;

function numbersOf(data: string) {
  return data.match(/-?\d+\.\d+/g)?.map(Number) ?? [];
}

describe("fold icon", () => {
  it("pairs every point of one icon with one of the other", () => {
    assert.equal(CLOSE_FULLSCREEN.length, OPEN_IN_FULL.length);
    for (const [iOutline, outline] of CLOSE_FULLSCREEN.entries()) {
      assert.equal(outline.length, OPEN_IN_FULL[iOutline]?.length);
    }
  });

  it("keeps every point on the grid", () => {
    for (const [x, y] of [...CLOSE_FULLSCREEN, ...OPEN_IN_FULL].flat()) {
      assert.ok(x >= 0 && x <= ICON_GRID && y >= 0 && y <= ICON_GRID);
    }
  });

  it("draws close_fullscreen at 0 and open_in_full at 1, scaled to the size", () => {
    const first = numbersOf(
      foldPathData({
        progress: 0,
        size: SIZE
      })
    );
    const [x, y] = CLOSE_FULLSCREEN[0]?.[0] ?? [0, 0];
    assert.equal(first[0], Number((((x ?? 0) * SIZE) / ICON_GRID).toFixed(2)));
    assert.equal(first[1], Number((((y ?? 0) * SIZE) / ICON_GRID).toFixed(2)));

    const last = numbersOf(
      foldPathData({
        progress: 1,
        size: SIZE
      })
    );
    const [openX, openY] = OPEN_IN_FULL[0]?.[0] ?? [0, 0];
    assert.equal(last[0], Number((((openX ?? 0) * SIZE) / ICON_GRID).toFixed(2)));
    assert.equal(last[1], Number((((openY ?? 0) * SIZE) / ICON_GRID).toFixed(2)));
  });

  it("keeps the arrows whole halfway instead of flattening them", () => {
    function areaAt(progress: number) {
      const numbers = numbersOf(
        foldPathData({
          progress,
          size: ICON_GRID
        })
      );
      const points = Array.from({ length: numbers.length / 2 }, (_, i) => [
        numbers[2 * i] ?? 0,
        numbers[2 * i + 1] ?? 0
      ]);
      const outlineLength = points.length / 2;
      let area = 0;
      for (const outline of [points.slice(0, outlineLength), points.slice(outlineLength)]) {
        let twiceArea = 0;
        for (const [i, [x = 0, y = 0]] of outline.entries()) {
          const [nextX = 0, nextY = 0] = outline[(i + 1) % outline.length] ?? [];
          twiceArea += x * nextY - nextX * y;
        }

        area += Math.abs(twiceArea) / 2;
      }

      return area;
    }

    const minShareOfRestArea = 0.8;
    assert.ok(areaAt(0.5) > areaAt(0) * minShareOfRestArea);
  });

  it("closes both outlines", () => {
    const data = foldPathData({
      progress: 0.5,
      size: SIZE
    });
    assert.equal(data.match(/Z/g)?.length, 2);
  });
});
