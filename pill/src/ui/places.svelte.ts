import { SvelteMap } from "svelte/reactivity";
import { control } from "winui-svelte";

export const PillPart = {
  pill: "pill",
  share: "share",
  mic: "mic",
  gear: "gear",
  end: "end"
} as const;
export type PillPart = typeof PillPart[keyof typeof PillPart];

interface MeasuredElement {
  actualWidth: number;
  actualHeight: number;
  xamlRoot: { content: object | null } | null;
  transformToVisual(visual: object): { transformPoint(point: {
    x: number;
    y: number;
  }): {
    x: number;
    y: number;
  }; };
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
  return control<MeasuredElement>(element => {
    function measure() {
      const root = element.xamlRoot?.content;
      const isRootMissing = root === undefined || root === null;
      if (isRootMissing) {
        return;
      }

      const origin = element.transformToVisual(root).transformPoint({
        x: 0,
        y: 0
      });
      places.set(part, {
        x: origin.x,
        y: origin.y,
        width: element.actualWidth,
        height: element.actualHeight
      });
    }

    measure();
    const stopLayout = element.onLayoutUpdated(measure);
    return () => {
      stopLayout();
      places.delete(part);
    };
  });
}

export function placeOf(part: PillPart) {
  return places.get(part);
}
