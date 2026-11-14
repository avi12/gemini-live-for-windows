import type { Monitor, Region } from "@/contracts/monitor.ts";
import { ScreenDetail } from "@/media/screen/capture-geometry.ts";
import type { ScreenCapture } from "@/media/screen/screen-capture.ts";
import type { CircleScreen, FrozenScreen, OcrLine } from "@/overlays/ports.ts";

import { cropJpeg } from "./crop-jpeg.ts";

export interface CircleScreenDeps {
  screenCapture: Pick<ScreenCapture, "grab">;
  readLines: (request: { image: Uint8Array; region: Region | undefined }) => Promise<OcrLine[]>;
  // The decoded text of each QR code in a JPEG
  readCodes: (jpeg: Uint8Array) => Promise<readonly string[]>;
}

// What Circle to Search needs of the screen: a display frozen at full resolution the moment the key is
// pressed (the overlay shows it and the user draws on it), the circled part cut out as the frame Gemini
// gets, and the words under it for the chip. A failed OCR rejects, so the overlay can say it failed
// rather than that there was no text.
export function createCircleScreen({ screenCapture, readLines, readCodes }: CircleScreenDeps) {
  async function freeze(monitor: Monitor) {
    const frame = await screenCapture.grab({
      monitor,
      detail: ScreenDetail.FROZEN
    });
    return {
      monitor,
      width: frame.width,
      height: frame.height,
      jpeg: frame.jpeg
    };
  }

  function crop({ frozen, region }: { frozen: FrozenScreen; region: Region }) {
    return cropJpeg({
      jpeg: frozen.jpeg,
      region,
      detail: ScreenDetail.SHARP
    });
  }

  async function readText({ frozen, region }: { frozen: FrozenScreen; region: Region | undefined }) {
    return readLines({
      image: frozen.jpeg,
      region
    });
  }

  async function scanCodes({ frozen, region }: { frozen: FrozenScreen; region: Region }) {
    const frame = await crop({
      frozen,
      region
    });
    return readCodes(frame.jpeg);
  }

  return {
    freeze,
    crop,
    readText,
    scanCodes
  } satisfies CircleScreen;
}
