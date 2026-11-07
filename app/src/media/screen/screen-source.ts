import { ScreenDetail } from "./capture-geometry.ts";
import type { ScreenCapture } from "./screen-capture.ts";
import type { ScreenSource } from "@/live/ports.ts";

// The API-key engine's view of the screen: the target's region (or the whole display) at light detail
export function createScreenSource({ screenCapture }: { screenCapture: Pick<ScreenCapture, "grab"> }) {
  return {
    async capture({ monitor, region }) {
      const frame = await screenCapture.grab({
        monitor,
        region,
        detail: ScreenDetail.light
      });
      return frame.jpeg;
    }
  } satisfies ScreenSource;
}
