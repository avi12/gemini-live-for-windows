import type { Chip } from "./chip.ts";
import { detectChips } from "./detect-text-chips.ts";
import type { Region } from "@/contracts/monitor.ts";
import { errorMessage } from "@/lib/error-message.ts";
import type { OcrLine, OverlayLog } from "@/overlays/ports.ts";
import type { Rect } from "@/overlays/shapes.ts";

// How long the selection must stay as it is before it is read: a move or a resize that has not
// ended never starts a read
export const SCAN_SETTLE_MILLISECONDS = 350;

export interface SelectionScanWorld {
  readText(region: Region | null): Promise<readonly OcrLine[]>;
  scanCodes(region: Region): Promise<readonly string[]>;
  schedule(options: {
    callback: () => void;
    milliseconds: number;
  }): () => void;
  log: OverlayLog;
}

function isSameRect({ first, second }: {
  first: Rect | undefined;
  second: Rect | undefined;
}) {
  const isEitherMissing = first === undefined || second === undefined;
  if (isEitherMissing) {
    return first === second;
  }

  return first.x === second.x && first.y === second.y && first.width === second.width
    && first.height === second.height;
}

function lineTexts(lines: readonly OcrLine[]) {
  return lines.map(line => line.words.map(word => word.text).join(" "));
}

// Reads the selection for chips once it has settled: the OCR words and the QR codes inside it. Each
// change of the selection starts a new generation, so a read that comes back after the selection
// moved on (or was cleared) is dropped. It runs off the pointer path: `watch` only compares and
// schedules, and the reading is async work on the main thread's side of the link
export function createSelectionScan({ world, regionOf, onChips }: {
  world: SelectionScanWorld;
  regionOf: (selection: Rect) => Region | undefined;
  onChips: (chips: readonly Chip[]) => void;
}) {
  let generation = 0;
  let watched: Rect | undefined;
  let hasChips = false;
  let cancelPending: (() => void) | undefined;

  function show(chips: readonly Chip[]) {
    const isUnchanged = chips.length === 0 && !hasChips;
    if (isUnchanged) {
      return;
    }

    hasChips = chips.length > 0;
    onChips(chips);
  }

  async function read({ region, mine }: {
    region: Region;
    mine: number;
  }) {
    const [lines, codes] = await Promise.all([
      world.readText(region).catch((error: unknown) => {
        world.log.write(`circle: reading chips failed: ${errorMessage(error)}`);
        return [];
      }),
      world.scanCodes(region).catch((error: unknown) => {
        world.log.write(`circle: scanning codes failed: ${errorMessage(error)}`);
        return [];
      })
    ]);
    const isStale = mine !== generation;
    if (isStale) {
      return;
    }

    show(
      detectChips({
        lines: lineTexts(lines),
        codes
      })
    );
  }

  // `selection` is the selection to read, or undefined while there is nothing to read: no selection,
  // a gesture under way, text mode, or an answer already sent
  function watch(selection: Rect | undefined) {
    const isUnchanged = isSameRect({
      first: selection,
      second: watched
    });
    if (isUnchanged) {
      return;
    }

    watched = selection;
    generation += 1;
    cancelPending?.();
    cancelPending = undefined;
    show([]);
    const region = selection === undefined ? undefined : regionOf(selection);
    const isUnreadable = region === undefined;
    if (isUnreadable) {
      return;
    }

    const mine = generation;
    cancelPending = world.schedule({
      milliseconds: SCAN_SETTLE_MILLISECONDS,
      callback() {
        void read({
          region,
          mine
        });
      }
    });
  }

  return { watch };
}
