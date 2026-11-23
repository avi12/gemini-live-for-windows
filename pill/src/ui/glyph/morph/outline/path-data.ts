import { ICON_GRID } from "./geometry.ts";
import type { Outline } from "./geometry.ts";

/**
 * Path data in pixels for outlines on the spec's grid, filled by the nonzero rule (the `F1`), as the
 * spec's own fonts are: an outline running the other way round is a hole.
 *
 * @param options - The outlines, and the icon's size in pixels.
 * @returns Path data.
 */
export function pathDataOf({ outlines, size }: { outlines: readonly Outline[]; size: number }) {
  const unit = size / ICON_GRID;
  const figures = outlines
    .filter(outline => outline.length > 2)
    .map(outline => {
      const points = outline.map(([x, y]) => `${(x * unit).toFixed(2)},${((y + ICON_GRID) * unit).toFixed(2)}`);
      return `M${points.join(" L")} Z`;
    });
  return `F1 ${figures.join(" ")}`;
}
