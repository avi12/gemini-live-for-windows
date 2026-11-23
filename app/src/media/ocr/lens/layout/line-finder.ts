import type { PixelRect } from "@/media/screen/capture-geometry.ts";

import type { GrayImage } from "./gray-image.ts";

// How much brighter or darker than its neighbour a pixel must be to count as the edge of a glyph
const EDGE_CONTRAST = 40;
// A row needs this many edge pixels to hold text, so a stray speck is not a line
const MIN_ROW_EDGES = 3;
const MIN_LINE_HEIGHT = 7;
const MAX_LINE_HEIGHT = 70;
// A pixel run of rows broken by at most this many empty ones is one line
const ROW_GAP_BRIDGE = 1;
// A band whose area is mostly edges is a picture, not text
const MAX_EDGE_DENSITY = 0.4;
// Columns apart by less than this many line heights are one piece of text, further apart are two
const COLUMN_GAP_IN_HEIGHTS = 2.5;
const MIN_WIDTH_IN_HEIGHTS = 0.5;
const PADDING = 2;
// The picture is searched for rows of text in blocks this wide
const BLOCK_WIDTH = 96;
// Rows in neighbouring blocks are one line when this much of the shorter one overlaps the other
const MIN_VERTICAL_OVERLAP = 0.6;

function edgeMask({ gray, width, height }: GrayImage) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const offset = y * width + x;
      const here = gray[offset] ?? 0;
      const isEdge =
        Math.abs(here - (gray[offset + 1] ?? 0)) > EDGE_CONTRAST ||
        Math.abs(here - (gray[offset + width] ?? 0)) > EDGE_CONTRAST;
      mask[offset] = isEdge ? 1 : 0;
    }
  }
  return mask;
}

interface ColumnRange {
  from: number;
  to: number;
}

interface RowRun {
  top: number;
  bottom: number;
}

interface ColumnPiece {
  left: number;
  right: number;
}

interface TextBand extends RowRun, ColumnPiece {}

function rowRuns({
  mask,
  width,
  height,
  columns
}: {
  mask: Uint8Array;
  width: number;
  height: number;
  columns: ColumnRange;
}) {
  const runs: RowRun[] = [];
  let open: RowRun | undefined;
  let emptyRows = 0;
  for (let y = 0; y < height; y++) {
    let edges = 0;
    for (let x = columns.from; x < columns.to; x++) {
      edges += mask[y * width + x] ?? 0;
    }

    const isInk = edges >= MIN_ROW_EDGES;
    if (isInk) {
      open ??= {
        top: y,
        bottom: y
      };
      open.bottom = y + 1;
      emptyRows = 0;
      continue;
    }

    emptyRows++;
    const isRunOver = emptyRows > ROW_GAP_BRIDGE;
    if (isRunOver && open !== undefined) {
      runs.push(open);
      open = undefined;
    }
  }

  if (open !== undefined) {
    runs.push(open);
  }

  return runs;
}

function columnPieces({ mask, width, band }: { mask: Uint8Array; width: number; band: TextBand }) {
  const height = band.bottom - band.top;
  const maxGap = Math.round(height * COLUMN_GAP_IN_HEIGHTS);
  const pieces: ColumnPiece[] = [];
  let open: ColumnPiece | undefined;
  let emptyColumns = 0;
  for (let x = band.left; x < band.right; x++) {
    let isInk = false;
    for (let y = band.top; y < band.bottom && !isInk; y++) {
      isInk = mask[y * width + x] === 1;
    }

    if (isInk) {
      open ??= {
        left: x,
        right: x
      };
      open.right = x + 1;
      emptyColumns = 0;
      continue;
    }

    emptyColumns++;
    const isPieceOver = emptyColumns > maxGap;
    if (isPieceOver && open !== undefined) {
      pieces.push(open);
      open = undefined;
    }
  }

  if (open !== undefined) {
    pieces.push(open);
  }

  return pieces;
}

function edgeDensity({ mask, width, area }: { mask: Uint8Array; width: number; area: PixelRect }) {
  let edges = 0;
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      edges += mask[y * width + x] ?? 0;
    }
  }
  return edges / (area.width * area.height);
}

interface Band {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

// Rows holding glyph edges, found block by block across the picture (so a picture beside the text, or a
// divider line, does not swallow the rows) and joined where neighbouring blocks' rows line up
function textBands({ mask, width, height }: { mask: Uint8Array; width: number; height: number }) {
  const blocks: Band[][] = [];
  for (let from = 0; from < width; from += BLOCK_WIDTH) {
    const to = Math.min(width, from + BLOCK_WIDTH);
    blocks.push(
      rowRuns({
        mask,
        width,
        height,
        columns: {
          from,
          to
        }
      })
        .filter(run => run.bottom - run.top >= MIN_LINE_HEIGHT && run.bottom - run.top <= MAX_LINE_HEIGHT)
        .map(run => ({
          ...run,
          left: from,
          right: to
        }))
    );
  }

  const bands: Band[] = [];
  const openByBlock = new Map<Band, Band>();
  for (const runs of blocks) {
    const next = new Map<Band, Band>();
    for (const run of runs) {
      const joined = [...openByBlock.entries()].find(([previous]) => {
        const overlap = Math.min(previous.bottom, run.bottom) - Math.max(previous.top, run.top);
        return overlap >= Math.min(previous.bottom - previous.top, run.bottom - run.top) * MIN_VERTICAL_OVERLAP;
      });
      const band = joined?.[1] ?? { ...run };
      if (joined === undefined) {
        bands.push(band);
      } else {
        band.top = Math.min(band.top, run.top);
        band.bottom = Math.max(band.bottom, run.bottom);
        band.right = run.right;
      }

      next.set(run, band);
    }

    openByBlock.clear();
    for (const [run, band] of next) {
      openByBlock.set(run, band);
    }
  }
  return bands;
}

// Where lines of text sit in a picture: bands of rows holding glyph edges, cut where a wide empty
// stretch splits them. Rows and columns only, so it finds text in any script but needs it horizontal.
export function findTextLines(image: GrayImage) {
  const { width, height } = image;
  const mask = edgeMask(image);
  const lines: PixelRect[] = [];
  for (const band of textBands({
    mask,
    width,
    height
  })) {
    const bandHeight = band.bottom - band.top;
    const isTextHeight = bandHeight >= MIN_LINE_HEIGHT && bandHeight <= MAX_LINE_HEIGHT;
    if (!isTextHeight) {
      continue;
    }

    for (const piece of columnPieces({
      mask,
      width,
      band
    })) {
      const area = {
        x: Math.max(0, piece.left - PADDING),
        y: Math.max(0, band.top - PADDING),
        width: Math.min(width, piece.right + PADDING) - Math.max(0, piece.left - PADDING),
        height: Math.min(height, band.bottom + PADDING) - Math.max(0, band.top - PADDING)
      };
      const isWideEnough = area.width >= bandHeight * MIN_WIDTH_IN_HEIGHTS;
      const isText =
        isWideEnough &&
        edgeDensity({
          mask,
          width,
          area
        }) <= MAX_EDGE_DENSITY;
      if (isText) {
        lines.push(area);
      }
    }
  }
  return lines;
}
