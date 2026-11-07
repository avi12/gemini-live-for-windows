import { DETAIL_SETTINGS, fitToEdge, screenArea } from "./capture-geometry.ts";
import type { PixelRect, PixelSize, ScreenDetail } from "./capture-geometry.ts";
import { createGdiCapturer } from "./gdi-capture.ts";
import type { CapturedPixels } from "./gdi-capture.ts";
import { createJpegEncoder } from "./jpeg-encoder.ts";
import type { EncodedFrame, EncodeRequest } from "./jpeg-encoder.ts";
import type { Monitor, Region } from "@/contracts/monitor.ts";

export type { EncodedFrame };

export interface PixelGrabber {
  capture(request: {
    area: PixelRect;
    size: PixelSize;
  }): CapturedPixels;
  dispose(): void;
}

export interface FrameEncoder {
  encode(request: EncodeRequest): Promise<EncodedFrame>;
}

async function captureArea({ grabber, encoder, monitor, region, detail }: {
  grabber: PixelGrabber;
  encoder: FrameEncoder;
  monitor: Monitor;
  region: Region | undefined;
  detail: ScreenDetail;
}) {
  const area = screenArea({
    monitor,
    region
  }) ?? screenArea({
    monitor,
    region: undefined
  });
  const isAreaMissing = area === undefined;
  if (isAreaMissing) {
    throw new RangeError(`Display ${monitor.deviceName} has no area to capture`);
  }

  const { maxEdge, quality } = DETAIL_SETTINGS[detail];
  return encoder.encode({
    pixels: grabber.capture({
      area,
      size: fitToEdge({
        size: area,
        maxEdge
      })
    }),
    quality
  });
}

// One JPEG still of a display, or of `region` of it (in the display's own physical pixels), through the
// one encoder every screen frame goes through. A region that lies outside the display gives the whole
// display. Grabs run one after another: the capture buffer is reused, so the next grab must not start
// until the previous frame is encoded.
export function createScreenCapture({
  grabber = createGdiCapturer(),
  encoder = createJpegEncoder()
}: {
  grabber?: PixelGrabber;
  encoder?: FrameEncoder;
} = {}) {
  let queue: Promise<unknown> = Promise.resolve();

  function grab(request: {
    monitor: Monitor;
    region?: Region | undefined;
    detail: ScreenDetail;
  }) {
    const next = queue.then(() => captureArea({
      grabber,
      encoder,
      region: undefined,
      ...request
    }));
    queue = next.catch(() => undefined);
    return next;
  }

  function dispose() {
    grabber.dispose();
  }

  return {
    grab,
    dispose
  };
}

export type ScreenCapture = ReturnType<typeof createScreenCapture>;
