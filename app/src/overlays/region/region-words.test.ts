import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { windowWords } from "./region-words.ts";

const REGION = {
  x: 100,
  y: 200,
  width: 400,
  height: 120
};
const SCALE = 2;

describe("windowWords", () => {
  it("puts each word in the window's DIPs from the region's corner, keeping the order words were read in", () => {
    const words = windowWords({
      lines: [
        {
          words: [
            {
              text: "שלום",
              bounds: {
                x: 300,
                y: 220,
                width: 80,
                height: 20
              }
            },
            {
              text: "עולם",
              bounds: {
                x: 200,
                y: 220,
                width: 60,
                height: 20
              }
            }
          ]
        }
      ],
      region: REGION,
      scale: SCALE
    });
    assert.deepEqual(
      words.map(word => word.text),
      ["שלום", "עולם"]
    );
    assert.deepEqual(words[0]?.bounds, {
      x: 100,
      y: 10,
      width: 40,
      height: 10
    });
    assert.deepEqual(
      words.map(word => word.line),
      [0, 0]
    );
  });
});
