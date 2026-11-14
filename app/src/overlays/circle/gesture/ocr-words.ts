import { selectableWords } from "winui-svelte/selection";

import type { OcrLine } from "@/overlays/ports.ts";
import type { Size } from "@/overlays/shapes.ts";

// The words OCR found, in reading order and the window's DIPs: the inverse of the DPI scale that
// maps the selection onto the still. The order is the recognizer's, so a right-to-left line stays
// in logical order
export function ocrWords({ lines, still, window }: { lines: readonly OcrLine[]; still: Size; window: Size }) {
  const scaleX = window.width / still.width;
  const scaleY = window.height / still.height;
  return selectableWords(
    lines.map(line => ({
      words: line.words.map(word => ({
        rawValue: word.text,
        boundingBox: {
          x: word.bounds.x * scaleX,
          y: word.bounds.y * scaleY,
          width: word.bounds.width * scaleX,
          height: word.bounds.height * scaleY
        }
      }))
    }))
  );
}
