import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { OcrLine } from "@/media/ocr/ocr-geometry.ts";

import { buildScreenView, MAX_HEADING_CHARS, MAX_SCREEN_TEXT_CHARS } from "./screen-text-blocks.ts";

const NUMBER_999 = 999;
const NUMBER_60 = 60;
const NUMBER_20 = 20;

function line({ text, height = NUMBER_20 }: { text: string; height?: number }) {
  return {
    words: text.split(" ").map((word, iWord) => ({
      text: word,
      bounds: {
        x: iWord * NUMBER_60,
        y: 0,
        width: 50,
        height
      }
    }))
  } satisfies OcrLine;
}

function viewOf(lines: OcrLine[]) {
  return buildScreenView({
    title: "t",
    app: "a",
    lines
  });
}

describe("screen view", () => {
  it("is undefined when nothing was read", () => {
    assert.equal(viewOf([]), undefined);
    assert.equal(viewOf([{ words: [] }]), undefined);
  });

  it("carries the window's title and app, one paragraph per line", () => {
    const view = buildScreenView({
      title: "Notes",
      app: "Notepad",
      lines: [line({ text: "first line" }), line({ text: "second line" })]
    });
    assert.equal(view?.title, "Notes");
    assert.equal(view?.app, "Notepad");
    assert.deepEqual(view?.blocks, [
      {
        kind: "paragraph",
        text: "first line"
      },
      {
        kind: "paragraph",
        text: "second line"
      }
    ]);
  });

  it("calls a short, clearly bigger line a heading", () => {
    const view = viewOf([
      line({
        text: "Big Title",
        height: 40
      }),
      line({ text: "body one" }),
      line({ text: "body two" }),
      line({ text: "body three" })
    ]);
    assert.deepEqual(
      view?.blocks.map(block => block.kind),
      ["heading", "paragraph", "paragraph", "paragraph"]
    );
  });

  it("does not call a long big line a heading", () => {
    const longText = Array.from({ length: MAX_HEADING_CHARS }, () => "word").join(" ");
    const view = viewOf([
      line({
        text: longText,
        height: 40
      }),
      line({ text: "a" }),
      line({ text: "b" })
    ]);
    assert.equal(view?.blocks[0]?.kind, "paragraph");
  });

  it("calls nothing a heading when all lines are the same size, or there is one line", () => {
    const same = viewOf([line({ text: "a" }), line({ text: "b" })]);
    assert.ok(same?.blocks.every(block => block.kind === "paragraph"));
    assert.equal(viewOf([line({ text: "alone" })])?.blocks[0]?.kind, "paragraph");
  });

  it("collapses whitespace and drops repeated lines", () => {
    const view = viewOf([line({ text: "a  b" }), line({ text: "a b" }), line({ text: "c" })]);
    assert.deepEqual(
      view?.blocks.map(block => block.text),
      ["a b", "c"]
    );
  });

  it("caps the whole text, truncating the line that crosses the cap", () => {
    const huge = Array.from({ length: 30 }, (_, iLine) => line({ text: `${"x".repeat(NUMBER_999)}${iLine}` }));
    const view = viewOf(huge);
    let total = 0;
    for (const block of view?.blocks ?? []) {
      total += block.text.length;
    }
    assert.equal(total, MAX_SCREEN_TEXT_CHARS);
  });

  it("gives a stable 16-character version that changes with the text or the title", () => {
    const base = viewOf([line({ text: "hello" })]);
    const sameTextOtherApp = buildScreenView({
      title: "t",
      app: "other app",
      lines: [line({ text: "hello" })]
    });
    const edited = viewOf([line({ text: "hello!" })]);
    const retitled = buildScreenView({
      title: "t2",
      app: "a",
      lines: [line({ text: "hello" })]
    });
    assert.match(base?.version ?? "", /^[0-9a-f]{16}$/);
    assert.equal(sameTextOtherApp?.version, base?.version);
    assert.notEqual(edited?.version, base?.version);
    assert.notEqual(retitled?.version, base?.version);
  });
});
