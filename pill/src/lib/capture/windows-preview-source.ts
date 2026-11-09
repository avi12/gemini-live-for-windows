import { createWinrtCaptureBridge } from "./capture-bridge.ts";
import type { PreviewSource } from "./capture-schema.ts";
import { monitorAt } from "./monitor-capture-item.ts";

const HALF = 2;

export function createWindowsPreviewSource() {
  let bridge: ReturnType<typeof createWinrtCaptureBridge> | undefined;
  const source = {
    captureIdOf({ x, y, width, height }) {
      const monitor = monitorAt({
        x: x + Math.floor(width / HALF),
        y: y + Math.floor(height / HALF)
      });
      return monitor === undefined ? undefined : String(monitor);
    },
    bridge: {
      openSource(config) {
        bridge ??= createWinrtCaptureBridge();
        return bridge.openSource(config);
      }
    }
  } satisfies PreviewSource;
  return source;
}
