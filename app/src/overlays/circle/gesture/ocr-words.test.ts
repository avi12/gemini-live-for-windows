import { ocrWords } from "@/overlays/circle/gesture/ocr-words.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const STILL = {
  width: 1000,
  height: 1000
};
const WINDOW = {
  width: 500,
  height: 250
};

function word({ text, x, y }: {
  text: string;
  x: number;
  y: number;
}) {
  return {
    text,
    bounds: {
      x,
      y,
      width: 10,
      height: 10
    }
  };
}

describe("ocrWords", () => {
  it("maps pixels to DIPs and numbers the lines", () => {
    const result = ocrWords({
      lines: [
        {
          words: [{
            text: "a",
            bounds: {
              x: 20,
              y: 40,
              width: 100,
              height: 60
            }
          }]
        },
        {
          words: [word({
            text: "b",
            x: 0,
            y: 200
          }), word({
            text: "c",
            x: 10,
            y: 200
          })]
        }
      ],
      still: STILL,
      window: WINDOW
    });
    assert.deepEqual(result, [
      {
        text: "a",
        bounds: {
          x: 10,
          y: 10,
          width: 50,
          height: 15
        },
        line: 0
      },
      {
        text: "b",
        bounds: {
          x: 0,
          y: 50,
          width: 5,
          height: 2.5
        },
        line: 1
      },
      {
        text: "c",
        bounds: {
          x: 5,
          y: 50,
          width: 5,
          height: 2.5
        },
        line: 1
      }
    ]);
  });

  it("keeps a right-to-left line in the order the recognizer gave", () => {
    const result = ocrWords({
      lines: [{
        words: [
          word({
            text: "שלום",
            x: 900,
            y: 0
          }),
          word({
            text: "עולם",
            x: 800,
            y: 0
          })
        ]
      }],
      still: STILL,
      window: WINDOW
    });
    assert.deepEqual(result.map(entry => entry.text), ["שלום", "עולם"]);
  });

  it("is empty without lines", () => {
    assert.deepEqual(
      ocrWords({
        lines: [],
        still: STILL,
        window: WINDOW
      }), []
    );
  });
});
