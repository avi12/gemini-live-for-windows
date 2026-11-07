import { ScreenDetail } from "./capture-geometry.ts";
import { cropJpeg } from "./crop-jpeg.ts";
import type { ScreenCapture } from "./screen-capture.ts";
import type { Monitor, Region } from "@/contracts/monitor.ts";
import { errorMessage } from "@/lib/error-message.ts";
import type { CircleScreen, FrozenScreen, OcrLine } from "@/overlays/ports.ts";

export interface CircleScreenDeps {
  screenCapture: Pick<ScreenCapture, "grab">;
  readLines: (request: {
    image: Uint8Array;
    region: Region | undefined;
  }) => Promise<OcrLine[]>;
  log: (message: string) => void;
}

// What Circle to Search needs of the screen: a display frozen at full resolution the moment the key is
// pressed (the overlay shows it and the user draws on it), the circled part cut out as the frame Gemini
// gets, and the words under it for the chip. OCR never throws: a failure is logged and reads as no text.
export function createCircleScreen({ screenCapture, readLines, log }: CircleScreenDeps) {
  async function freeze(monitor: Monitor) {
    const frame = await screenCapture.grab({
      monitor,
      detail: ScreenDetail.frozen
    });
    return {
      monitor,
      width: frame.width,
      height: frame.height,
      jpeg: frame.jpeg
    };
  }

  function crop({ frozen, region }: {
    frozen: FrozenScreen;
    region: Region;
  }) {
    return cropJpeg({
      jpeg: frozen.jpeg,
      region,
      detail: ScreenDetail.sharp
    });
  }

  async function readText({ frozen, region }: {
    frozen: FrozenScreen;
    region: Region | undefined;
  }) {
    try {
      return await readLines({
        image: frozen.jpeg,
        region
      });
    } catch (error) {
      log(`OCR failed: ${errorMessage(error)}`);
      return [];
    }
  }

  return {
    freeze,
    crop,
    readText
  } satisfies CircleScreen;
}
