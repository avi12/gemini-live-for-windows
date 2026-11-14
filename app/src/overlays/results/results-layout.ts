import type { Monitor } from "@/contracts/monitor.ts";

// The panel's width and its gap to the display's work area, in device-independent pixels
const PANEL_WIDTH = 480;
const PANEL_MARGIN = 12;

export interface ResultsTarget {
  // The page to show
  url: string;
  // The display it docks to
  monitor: Monitor;
}

// The scripts that read right to left: Hebrew, Arabic, Syriac, Thaana and N'Ko
const RIGHT_TO_LEFT_SCRIPTS = new Set(["Hebr", "Arab", "Syrc", "Thaa", "Nkoo"]);

// Whether the language reads right to left, as Hebrew and Arabic do
export function isRightToLeft(locale: string) {
  const { script } = new Intl.Locale(locale).maximize();
  return script !== undefined && RIGHT_TO_LEFT_SCRIPTS.has(script);
}

// The language Windows shows the user
export function systemLocale() {
  return Intl.DateTimeFormat().resolvedOptions().locale;
}

// Where the results panel sits, in physical pixels: down the work area's trailing edge, which is the
// right edge for a left-to-right language and the left edge for a right-to-left one
export function panelBounds({ monitor, scale, isRtl }: {
  monitor: Monitor;
  scale: number;
  isRtl: boolean;
}) {
  const margin = Math.round(PANEL_MARGIN * scale);
  const width = Math.round(PANEL_WIDTH * scale);
  const x = isRtl ? monitor.x + margin : monitor.workRight - width - margin;
  return {
    x,
    y: monitor.y + margin,
    width,
    height: monitor.workBottom - monitor.y - margin * 2
  };
}
