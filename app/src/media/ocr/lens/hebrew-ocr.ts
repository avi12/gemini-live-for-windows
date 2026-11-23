import { BitmapBufferAccessMode } from "winui-svelte/bindings/windows/graphics/imaging/BitmapBufferAccessMode";
import type { SoftwareBitmap } from "winui-svelte/bindings/windows/graphics/imaging/SoftwareBitmap";

import { Bgra } from "@/media/bgra.ts";
import type { OcrLine } from "@/media/ocr/ocr-geometry.ts";
import { withBufferBytes } from "@/media/winrt/buffer-access.ts";

import { snapToInk } from "./layout/column-ink.ts";
import { toGray } from "./layout/gray-image.ts";
import type { GrayImage } from "./layout/gray-image.ts";
import { findTextLines } from "./layout/line-finder.ts";
import { cutIntoStrips, STRIP_WIDTH } from "./layout/strips.ts";
import { decodeCtc } from "./model/ctc.ts";
import type { LineRecognizer } from "./model/lens-model.ts";
import { groupWords, isMostlyHebrew, readingOrder, withoutSpecks } from "./visual-words.ts";
import type { VisualWord } from "./visual-words.ts";

// Lines found on a whole screen are read up to this many, tallest first, to bound the time
const MAX_LINES = 150;

interface PlacedWord extends VisualWord {
  left: number;
  right: number;
}

function grayOf(bitmap: SoftwareBitmap) {
  const width = bitmap.pixelWidth;
  const height = bitmap.pixelHeight;
  return withBufferBytes({
    buffer: bitmap.lockBuffer(BitmapBufferAccessMode.Read),
    use: ({ memory }) =>
      toGray({
        bgra: memory.readBytes(0, width * height * Bgra.BYTES_PER_PIXEL),
        width,
        height
      })
  });
}

async function readLine({
  image,
  line,
  recognizer
}: {
  image: GrayImage;
  line: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  recognizer: LineRecognizer;
}) {
  const words: PlacedWord[] = [];
  for (const strip of cutIntoStrips({
    image,
    line
  })) {
    const symbols = decodeCtc({
      scores: await recognizer.scores(strip.pixels),
      stepCount: recognizer.stepCount,
      classCount: recognizer.classCount,
      blank: recognizer.blank
    });
    const pixelsPerStep = STRIP_WIDTH / recognizer.stepCount;
    const stretch = strip.source.width / strip.contentWidth;
    for (const word of groupWords({
      symbols,
      labels: recognizer.labels
    })) {
      words.push({
        ...word,
        left: strip.source.x + word.firstStep * pixelsPerStep * stretch,
        right: Math.min(
          strip.source.x + strip.source.width,
          strip.source.x + (word.lastStep + 1) * pixelsPerStep * stretch
        )
      });
    }
  }
  // The boxes are the recogniser's guess from where it was surest of each glyph: widened to the ink
  const spans = snapToInk({
    image,
    line,
    spans: words
  });
  return words.map((word, iWord) => ({
    ...word,
    left: spans[iWord]?.left ?? word.left,
    right: spans[iWord]?.right ?? word.right
  }));
}

// The Hebrew lines of a bitmap, their boxes in the bitmap's pixels. Lines are found by where glyph
// edges are, each is read by Google's recogniser, and only lines that came out mostly Hebrew are kept,
// since the other readers do the rest better.
export async function readHebrewLines({ bitmap, recognizer }: { bitmap: SoftwareBitmap; recognizer: LineRecognizer }) {
  const image = grayOf(bitmap);
  const found = findTextLines(image)
    .toSorted((first, second) => second.height - first.height)
    .slice(0, MAX_LINES);
  const lines: OcrLine[] = [];
  for (const line of found) {
    const words = await readLine({
      image,
      line,
      recognizer
    });
    const isHebrew = isMostlyHebrew(words.map(word => word.text).join(" "));
    if (!isHebrew) {
      continue;
    }

    lines.push({
      words: readingOrder(withoutSpecks(words)).map(word => ({
        text: word.text,
        bounds: {
          x: word.left,
          y: line.y,
          width: word.right - word.left,
          height: line.height
        }
      }))
    });
  }
  return lines;
}
