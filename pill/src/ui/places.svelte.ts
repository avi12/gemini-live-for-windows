import { untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { control } from "winui-svelte";

import { collapse } from "@/ui/collapse.svelte.ts";

export const PillPart = {
  PILL: "pill",
  CARD: "card",
  ROOT: "root",
  SHARE: "share",
  MIC: "mic",
  GEAR: "gear",
  END: "end",
  COLLAPSE: "collapse"
} as const;
export type PillPart = (typeof PillPart)[keyof typeof PillPart];

// The buttons, whose places only feed the window's passthrough regions
export const BUTTON_PARTS = [PillPart.SHARE, PillPart.MIC, PillPart.GEAR, PillPart.END, PillPart.COLLAPSE] as const;

const BUTTON_PART_SET: ReadonlySet<PillPart> = new Set(BUTTON_PARTS);

interface MeasuredElement {
  actualWidth: number;
  actualHeight: number;
  xamlRoot: { content: object | null } | null;
  transformToVisual(visual: object): {
    transformPoint(point: { x: number; y: number }): {
      x: number;
      y: number;
    };
  };
  onLayoutUpdated(callback: () => void): () => void;
}

interface Place {
  x: number;
  y: number;
  width: number;
  height: number;
}

const places = new SvelteMap<PillPart, Place>();

export function trackPart(part: PillPart) {
  // A button slides with the capsule on every frame of a glide, and the regions it feeds are held
  // until the glide ends anyway (see PillWindow), so it is not measured on the way, only once it ends.
  // Each measure is a few WinRT calls per layout pass, and a glide makes one every frame.
  const isButton = BUTTON_PART_SET.has(part);

  return control<MeasuredElement>(element => {
    function measure() {
      // Untracked: the first measure runs inside the attachment, which would re-run on every glide
      const isSkipped = isButton && untrack(() => collapse.isGliding);
      if (isSkipped) {
        return;
      }

      const root = element.xamlRoot?.content;
      const isRootMissing = root === undefined || root === null;
      if (isRootMissing) {
        return;
      }

      const origin = element.transformToVisual(root).transformPoint({
        x: 0,
        y: 0
      });
      const place = {
        x: origin.x,
        y: origin.y,
        width: element.actualWidth,
        height: element.actualHeight
      };
      // Any layout pass in the window calls this (the waveform makes one every tick): a place that has
      // not moved is left as it is, so what follows it (the window's regions) is not redone
      // Untracked: the first measure runs inside the attachment, which would otherwise re-run on its own write
      const known = untrack(() => places.get(part));
      const isSame =
        known !== undefined &&
        known.x === place.x &&
        known.y === place.y &&
        known.width === place.width &&
        known.height === place.height;
      if (isSame) {
        return;
      }

      places.set(part, place);
    }

    measure();
    const stopLayout = element.onLayoutUpdated(measure);
    // The layout pass that ends a glide can come before the glide is marked over, so a button is
    // measured again the moment it is
    const stopGlideWatch = isButton
      ? $effect.root(() => {
          $effect(() => {
            if (!collapse.isGliding) {
              untrack(measure);
            }
          });
        })
      : undefined;
    return () => {
      stopLayout();
      stopGlideWatch?.();
      places.delete(part);
    };
  });
}

export function placeOf(part: PillPart) {
  return places.get(part);
}
