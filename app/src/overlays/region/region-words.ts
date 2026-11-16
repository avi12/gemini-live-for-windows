import { selectableWords } from "winui-svelte/selection";

import type { Region } from "@/contracts/monitor.ts";
import type { OcrLines } from "@/overlays/protocol.ts";

// The words of a region's lines as the window shows them: in the window's own DIPs, which are the
// display's pixels from the region's corner divided by the window's scale. Each line's words keep the
// order they were read in, so a right-to-left line is picked from its right edge.
export function windowWords({ lines, region, scale }: { lines: OcrLines; region: Region; scale: number }) {
  return selectableWords(
    lines.map(line => ({
      words: line.words.map(word => ({
        rawValue: word.text,
        boundingBox: {
          x: (word.bounds.x - region.x) / scale,
          y: (word.bounds.y - region.y) / scale,
          width: word.bounds.width / scale,
          height: word.bounds.height / scale
        }
      }))
    }))
  );
}
