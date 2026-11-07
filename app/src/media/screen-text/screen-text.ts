import type { ForegroundWindow } from "./foreground-window.ts";
import { buildScreenView } from "./screen-text-blocks.ts";
import type { Monitor, Region } from "@/contracts/monitor.ts";
import type { ScreenView } from "@/google/protocols/glic.ts";
import type { OcrLine } from "@/media/ocr/ocr-geometry.ts";
import { clipToSurface, ScreenDetail } from "@/media/screen/capture-geometry.ts";
import type { EncodedFrame } from "@/media/screen/jpeg-encoder.ts";

// An exact text copy of the window the user is looking at. The real reader is UI Automation (Windows'
// accessibility tree: exact words, headings, no recognition errors), which has no client in the library
// yet; until it does, createOcrScreenTextReader answers with the same shape from a picture of the
// window. Swap the implementation, not the callers.
export interface ScreenTextReader {
  // The text of the foreground window if it is on `monitor`; undefined when there is none, it is on
  // another display, it is this app's own, or nothing readable was found
  read(monitor: Monitor): Promise<ScreenView | undefined>;
}

export interface ScreenTextDeps {
  foregroundWindow: () => ForegroundWindow | undefined;
  foregroundDisplayName: () => string | undefined;
  grab: (request: {
    monitor: Monitor;
    region: Region;
    detail: ScreenDetail;
  }) => Promise<EncodedFrame>;
  readLines: (request: { image: Uint8Array }) => Promise<OcrLine[]>;
  ownProcessId: number;
}

// Degraded on purpose: lines of recognised text, no exact copy, headings guessed from line height
export function createOcrScreenTextReader(deps: ScreenTextDeps) {
  const { foregroundWindow, foregroundDisplayName, grab, readLines, ownProcessId } = deps;
  return {
    async read(monitor) {
      const window = foregroundWindow();
      const isNoWindowOrOurs = window === undefined || window.processId === ownProcessId;
      if (isNoWindowOrOurs) {
        return undefined;
      }

      const isOnAnotherDisplay = foregroundDisplayName() !== monitor.deviceName;
      if (isOnAnotherDisplay) {
        return undefined;
      }

      const region = clipToSurface({
        region: {
          x: window.bounds.x - monitor.x,
          y: window.bounds.y - monitor.y,
          width: window.bounds.width,
          height: window.bounds.height
        },
        size: monitor
      });
      const isRegionMissing = region === undefined;
      if (isRegionMissing) {
        return undefined;
      }

      const frame = await grab({
        monitor,
        region,
        detail: ScreenDetail.frozen
      });
      const lines = await readLines({ image: frame.jpeg });
      return buildScreenView({
        title: window.title,
        app: window.appName,
        lines
      });
    }
  } satisfies ScreenTextReader;
}
