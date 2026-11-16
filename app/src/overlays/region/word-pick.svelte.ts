import { joinWords, wordAt, wordsBetween } from "winui-svelte/selection";
import type { SelectableWord } from "winui-svelte/selection";

import { roundedRectsPath, WORD_RADIUS } from "@/overlays/circle/gesture/geometry.ts";
import type { Point } from "@/overlays/shapes.ts";

// Within this many DIPs of a word still counts as on it, so a drag through the gaps keeps going
const WORD_REACH = 6;

// Picking words by dragging across them: where the drag began and where it is now, the words between
// (in reading order, so across lines and along a right-to-left one), and the outlines to draw for the
// words and for the picked ones
export function createWordPick({ words }: { words: () => readonly SelectableWord[] }) {
  const ends: {
    anchor: number | undefined;
    head: number | undefined;
  } = $state({
    anchor: undefined,
    head: undefined
  });

  // A press is down and the pointer is dragging the pick; plain state, as nothing draws from it
  let isDragging = false;

  const range = $derived.by(() => {
    const { anchor, head } = ends;
    const isNothingPicked = anchor === undefined || head === undefined;
    if (isNothingPicked) {
      return undefined;
    }

    return wordsBetween({
      words: words(),
      from: anchor,
      to: head
    });
  });
  const wordsPath = $derived(
    roundedRectsPath({
      rects: words().map(word => word.bounds),
      radius: WORD_RADIUS
    })
  );
  const pickedPath = $derived(
    roundedRectsPath({
      rects:
        range === undefined
          ? []
          : words()
              .slice(range.start, range.end + 1)
              .map(word => word.bounds),
      radius: WORD_RADIUS
    })
  );

  function wordAtPoint(point: Point) {
    return wordAt({
      words: words(),
      point,
      reach: WORD_REACH
    });
  }

  return {
    get isPicked() {
      return range !== undefined;
    },
    get wordsPath() {
      return wordsPath;
    },
    get pickedPath() {
      return pickedPath;
    },
    // A press: the drag begins on the word under it, or on none
    start(point: Point) {
      const iWord = wordAtPoint(point);
      ends.anchor = iWord;
      ends.head = iWord;
      isDragging = true;
    },
    // The pointer is up: what is picked stays, and moving the pointer no longer changes it
    end() {
      isDragging = false;
    },
    // The drag moved: it reaches the word under the pointer, and stays where it was over a gap
    extend(point: Point) {
      const isPicking = isDragging && ends.anchor !== undefined;
      if (!isPicking) {
        return;
      }

      const iWord = wordAtPoint(point);
      if (iWord !== undefined) {
        ends.head = iWord;
      }
    },
    clear() {
      ends.anchor = undefined;
      ends.head = undefined;
      isDragging = false;
    },
    // The picked words as one text, or undefined when none are
    text() {
      const picked = range;
      const isNothingPicked = picked === undefined;
      if (isNothingPicked) {
        return undefined;
      }

      return joinWords({
        words: words(),
        range: picked
      });
    }
  };
}
