import { createHash } from "node:crypto";

import { BlockKind } from "@/google/protocols/glic.ts";
import type { ScreenView } from "@/google/protocols/glic.ts";
import { lineText } from "@/media/ocr/ocr-geometry.ts";
import type { OcrLine } from "@/media/ocr/ocr-geometry.ts";

export const MAX_SCREEN_TEXT_CHARS = 12_000;
export const MAX_HEADING_CHARS = 100;
const HEADING_HEIGHT_RATIO = 1.35;
const VERSION_HEX_LENGTH = 16;
const WHITESPACE = /\s+/g;

function lineHeight(line: OcrLine) {
  let total = 0;
  for (const word of line.words) {
    total += word.bounds.height;
  }
  return total / line.words.length;
}

function medianOf(values: readonly number[]) {
  const sorted = values.toSorted((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

// A stable hash of the title and the blocks, so callers can tell when the text changed
function versionOf({ title, blocks }: Pick<ScreenView, "title" | "blocks">) {
  const body = blocks.map(block => `${block.kind}:${block.text}`).join("\n");
  return createHash("sha256").update(`${title}\n${body}`).digest("hex").slice(0, VERSION_HEX_LENGTH);
}

// What the OCR lines of a window say, shaped as the Gemini web client's screen view: one block per line,
// a line set clearly bigger than the page's usual text and short enough to be a title is a heading,
// repeats are dropped, and the whole is capped. Undefined when there is no text.
export function buildScreenView({ title, app, lines }: { title: string; app: string; lines: readonly OcrLine[] }) {
  const heights = lines.map(line => lineHeight(line));
  const headingHeight = medianOf(heights) * HEADING_HEIGHT_RATIO;
  const blocks: ScreenView["blocks"] = [];
  const seen = new Set<string>();
  let chars = 0;
  for (const [iLine, line] of lines.entries()) {
    const text = lineText(line).replaceAll(WHITESPACE, " ").trim();
    const isCharsAtLeastMAXSCREENTEXTCHARS = chars >= MAX_SCREEN_TEXT_CHARS;
    if (isCharsAtLeastMAXSCREENTEXTCHARS) {
      break;
    }

    const isTextEmptyOrHas = text.length === 0 || seen.has(text);
    if (isTextEmptyOrHas) {
      continue;
    }

    seen.add(text);
    const kept = text.slice(0, MAX_SCREEN_TEXT_CHARS - chars);
    const isHeading = (heights[iLine] ?? 0) >= headingHeight && text.length <= MAX_HEADING_CHARS && lines.length > 1;
    chars += kept.length;
    blocks.push({
      kind: isHeading ? BlockKind.HEADING : BlockKind.PARAGRAPH,
      text: kept
    });
  }

  const isBlocksEmpty = blocks.length === 0;
  if (isBlocksEmpty) {
    return undefined;
  }

  return {
    title,
    app,
    blocks,
    version: versionOf({
      title,
      blocks
    })
  };
}
