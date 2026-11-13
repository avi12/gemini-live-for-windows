import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { engineTagOrder, lineText, MIN_OCR_EDGE, planScan, sortLines, toSourceBounds } from "./ocr-geometry.ts";
import type { OcrLine } from "./ocr-geometry.ts";

const NUMBER_0_POINT_5 = 0.5;
const NUMBER_50 = 50;

const MAX_DIMENSION = 10_000;

function line({ top, words }: { top: number; words: string[] }) {
  return {
    words: words.map((text, iWord) => ({
      text,
      bounds: {
        x: iWord * NUMBER_50,
        y: top,
        width: 40,
        height: 20
      }
    }))
  } satisfies OcrLine;
}

describe("plan scan", () => {
  it("reads the whole picture at its own size when it fits", () => {
    const plan = planScan({
      image: {
        width: 1920,
        height: 1080
      },
      region: undefined,
      maxDimension: MAX_DIMENSION
    });
    assert.deepEqual(plan, {
      area: {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080
      },
      scale: 1,
      size: {
        width: 1920,
        height: 1080
      }
    });
  });

  it("clips a region to the picture", () => {
    const plan = planScan({
      image: {
        width: 1000,
        height: 500
      },
      region: {
        x: 900,
        y: 400,
        width: 500,
        height: 500
      },
      maxDimension: MAX_DIMENSION
    });
    assert.deepEqual(plan?.area, {
      x: 900,
      y: 400,
      width: 100,
      height: 100
    });
  });

  it("is undefined when the region misses the picture", () => {
    assert.equal(
      planScan({
        image: {
          width: 100,
          height: 100
        },
        region: {
          x: 200,
          y: 0,
          width: 5,
          height: 5
        },
        maxDimension: MAX_DIMENSION
      }),
      undefined
    );
  });

  it("shrinks a picture larger than the engine takes", () => {
    const plan = planScan({
      image: {
        width: 20_000,
        height: 10_000
      },
      region: undefined,
      maxDimension: MAX_DIMENSION
    });
    assert.equal(plan?.scale, NUMBER_0_POINT_5);
    assert.deepEqual(plan?.size, {
      width: 10_000,
      height: 5000
    });
  });

  it("enlarges a crop whose short edge is under the minimum, keeping its shape", () => {
    const plan = planScan({
      image: {
        width: 1000,
        height: 1000
      },
      region: {
        x: 0,
        y: 0,
        width: 200,
        height: 20
      },
      maxDimension: MAX_DIMENSION
    });
    assert.equal(plan?.scale, 2);
    assert.deepEqual(plan?.size, {
      width: 400,
      height: MIN_OCR_EDGE
    });
  });

  it("never enlarges past the engine limit", () => {
    const plan = planScan({
      image: {
        width: 100_000,
        height: 100_000
      },
      region: {
        x: 0,
        y: 0,
        width: 9000,
        height: 10
      },
      maxDimension: MAX_DIMENSION
    });
    assert.ok((plan?.size.width ?? 0) <= MAX_DIMENSION);
  });
});

describe("source bounds", () => {
  it("undoes the scale and the crop offset", () => {
    assert.deepEqual(
      toSourceBounds({
        bounds: {
          x: 20,
          y: 40,
          width: 100,
          height: 10
        },
        origin: {
          x: 300,
          y: 200
        },
        scale: 2
      }),
      {
        x: 310,
        y: 220,
        width: 50,
        height: 5
      }
    );
  });
});

describe("lines", () => {
  it("sorts top to bottom and drops empty ones", () => {
    const sorted = sortLines([
      line({
        top: 300,
        words: ["c"]
      }),
      line({
        top: 100,
        words: ["a"]
      }),
      { words: [] },
      line({
        top: 200,
        words: ["b"]
      })
    ]);
    assert.deepEqual(
      sorted.map(item => lineText(item)),
      ["a", "b", "c"]
    );
  });

  it("keeps the words in the order Windows returned them, right to left included", () => {
    const hebrew = line({
      top: 0,
      words: ["third", "second", "first"]
    });
    assert.equal(lineText(hebrew), "third second first");
    assert.deepEqual(
      sortLines([hebrew])[0]?.words.map(word => word.text),
      ["third", "second", "first"]
    );
  });

  it("orders a line by its highest word", () => {
    const tilted: OcrLine = {
      words: [
        {
          text: "x",
          bounds: {
            x: 0,
            y: 90,
            width: 1,
            height: 1
          }
        },
        {
          text: "y",
          bounds: {
            x: 5,
            y: 10,
            width: 1,
            height: 1
          }
        }
      ]
    };
    const sorted = sortLines([
      line({
        top: 50,
        words: ["mid"]
      }),
      tilted
    ]);
    assert.equal(lineText(sorted[0] ?? tilted), "x y");
  });
});

describe("engine order", () => {
  it("puts the profile language first, then the installed ones once each", () => {
    assert.deepEqual(
      engineTagOrder({
        profileTag: "en-GB",
        installedTags: ["en-US", "en-GB", "he"]
      }),
      ["en-GB", "en-US", "he"]
    );
  });

  it("is just the installed ones when the profile has none", () => {
    assert.deepEqual(
      engineTagOrder({
        profileTag: undefined,
        installedTags: ["en-US"]
      }),
      ["en-US"]
    );
  });

  it("is empty when nothing is installed", () => {
    assert.deepEqual(
      engineTagOrder({
        profileTag: undefined,
        installedTags: []
      }),
      []
    );
  });
});
