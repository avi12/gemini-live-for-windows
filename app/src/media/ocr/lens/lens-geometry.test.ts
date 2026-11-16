import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { snapToInk } from "./column-ink.ts";
import { decodeCtc } from "./ctc.ts";
import { parseLabelMap } from "./label-map.ts";
import { findTextLines, toGray } from "./line-finder.ts";
import { groupWords, isMostlyHebrew, readingOrder } from "./visual-words.ts";

const BLANK = 3;
const CLASS_COUNT = 4;
const WIDTH = 120;
const HEIGHT = 40;
const DARK = 20;
const LIGHT = 235;
const GLYPH_ROWS = {
  from: 12,
  to: 24
};
const GLYPH_STEP = 6;

function scoresFor(classes: readonly number[]) {
  const scores = new Uint8Array(classes.length * CLASS_COUNT);
  for (const [step, classIndex] of classes.entries()) {
    scores[step * CLASS_COUNT + classIndex] = 200;
  }
  return scores;
}

describe("decodeCtc", () => {
  it("folds repeats, drops blanks and keeps a repeat the blank separates", () => {
    const symbols = decodeCtc({
      scores: scoresFor([0, 0, BLANK, 0, 1, 1, BLANK]),
      stepCount: 7,
      classCount: CLASS_COUNT,
      blank: BLANK
    });
    assert.deepEqual(
      symbols.map(symbol => [symbol.index, symbol.step]),
      [
        [0, 0],
        [0, 3],
        [1, 4]
      ]
    );
  });
});

describe("parseLabelMap", () => {
  it("reads each entry's text and class index, the first class having no index written", () => {
    const first = Uint8Array.of(0x0a, 0x01, 0x20);
    const second = Uint8Array.of(0x0a, 0x02, 0xd7, 0x90, 0x10, 0x01);
    const labels = parseLabelMap(Uint8Array.of(0x0a, first.length, ...first, 0x0a, second.length, ...second));
    assert.equal(labels.get(0), " ");
    assert.equal(labels.get(1), "א");
  });
});

describe("reading order", () => {
  const labels = new Map([
    [0, " "],
    [1, "ש"],
    [2, "ל"],
    [4, "1"],
    [5, "2"]
  ]);

  it("turns a Hebrew word around but keeps its digits in order", () => {
    const [word] = groupWords({
      symbols: [
        {
          index: 4,
          step: 0
        },
        {
          index: 5,
          step: 1
        },
        {
          index: 1,
          step: 2
        },
        {
          index: 2,
          step: 3
        }
      ],
      labels
    });
    assert.equal(word?.text, "לש12");
  });

  it("reads a Hebrew line right to left and leaves a number between words where it reads", () => {
    const words = ["ב", "1", "א"].map((text, step) => ({
      text,
      firstStep: step,
      lastStep: step
    }));
    assert.deepEqual(
      readingOrder(words).map(word => word.text),
      ["א", "1", "ב"]
    );
  });

  it("keeps a date's dots and order inside a Hebrew word", () => {
    const dateLabels = new Map([
      [0, " "],
      [1, "1"],
      [2, "2"],
      [3, "."],
      [4, "5"],
      [5, "א"]
    ]);
    const [word] = groupWords({
      symbols: [1, 2, 3, 4, 5].map((index, step) => ({
        index,
        step
      })),
      labels: dateLabels
    });
    assert.equal(word?.text, "א12.5");
  });

  it("reads numbers and a divider right to left in a Hebrew line, as Hebrew readers do", () => {
    const words = ["12.11.26", "|", "6", "עונה"].map((text, step) => ({
      text,
      firstStep: step,
      lastStep: step
    }));
    assert.deepEqual(
      readingOrder(words).map(word => word.text),
      ["עונה", "6", "|", "12.11.26"]
    );
  });

  it("keeps the order of a line that is not Hebrew", () => {
    const words = ["a", "b"].map((text, step) => ({
      text,
      firstStep: step,
      lastStep: step
    }));
    assert.deepEqual(
      readingOrder(words).map(word => word.text),
      ["a", "b"]
    );
  });

  it("does not take a stray letter for a line of Hebrew", () => {
    assert.equal(isMostlyHebrew("ו"), false);
    assert.equal(isMostlyHebrew("שלום עולם"), true);
  });
});

describe("snapToInk", () => {
  it("widens a short span to the ink around it, across a glyph gap but not a space", () => {
    // Glyph columns 10-13, 16-19 (a gap of two), then a space of ten, then 30-33
    const image = {
      gray: new Uint8Array(WIDTH * HEIGHT).fill(LIGHT),
      width: WIDTH,
      height: HEIGHT
    };
    for (const [from, to] of [
      [10, 13],
      [16, 19],
      [30, 33]
    ] as const) {
      for (let y = GLYPH_ROWS.from; y < GLYPH_ROWS.to; y++) {
        image.gray.fill(DARK, y * WIDTH + from, y * WIDTH + to);
      }
    }
    const [span] = snapToInk({
      image,
      // As the line finder gives it: a little taller than the glyphs, so a stem has background above it
      line: {
        x: 0,
        y: GLYPH_ROWS.from - 2,
        width: WIDTH,
        height: GLYPH_ROWS.to - GLYPH_ROWS.from + 4
      },
      spans: [
        {
          left: 12,
          right: 17
        }
      ]
    });
    assert.equal(span?.left, 10);
    assert.equal(span?.right, 19);
  });
});

describe("findTextLines", () => {
  it("finds a row of glyph-like marks and nothing in a flat picture", () => {
    const bgra = new Uint8Array(WIDTH * HEIGHT * 4).fill(LIGHT);
    for (let x = 10; x < 90; x += GLYPH_STEP) {
      for (let y = GLYPH_ROWS.from; y < GLYPH_ROWS.to; y++) {
        for (let offsetX = 0; offsetX < 3; offsetX++) {
          bgra.fill(DARK, (y * WIDTH + x + offsetX) * 4, (y * WIDTH + x + offsetX) * 4 + 3);
        }
      }
    }
    const lines = findTextLines(
      toGray({
        bgra,
        width: WIDTH,
        height: HEIGHT
      })
    );
    assert.equal(lines.length, 1);
    assert.ok((lines[0]?.y ?? HEIGHT) <= GLYPH_ROWS.from);
    assert.ok((lines[0]?.width ?? 0) >= 70);

    const flat = findTextLines(
      toGray({
        bgra: new Uint8Array(WIDTH * HEIGHT * 4).fill(LIGHT),
        width: WIDTH,
        height: HEIGHT
      })
    );
    assert.equal(flat.length, 0);
  });
});
