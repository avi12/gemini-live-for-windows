import type { CaptureConfig, PreviewSource } from "@/lib/capture/capture-schema.ts";

const CHANNELS = 4;
const OPAQUE = 255;
const ALPHA_OFFSET = 3;
const BAND_WIDTH_PIXELS = 24;
const SCROLL_PIXELS_PER_FRAME = 2;
const HUE_STEP = 70;
const COLOR_RANGE = 256;
const DEVICE_DIGITS = /\D/gu;

function drawFrame({ config, frameIndex }: { config: CaptureConfig; frameIndex: number }) {
  const { width, height } = config.size;
  const pixels = new Uint8Array(width * height * CHANNELS);
  const seed = Number(config.displayId) * HUE_STEP;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const band = Math.floor((x + frameIndex * SCROLL_PIXELS_PER_FRAME) / BAND_WIDTH_PIXELS);
      const start = (y * width + x) * CHANNELS;
      pixels[start] = (seed + band * HUE_STEP) % COLOR_RANGE;
      pixels[start + 1] = (seed + y * 2) % COLOR_RANGE;
      pixels[start + 2] = COLOR_RANGE - 1 - ((seed + band * HUE_STEP) % COLOR_RANGE);
      pixels[start + ALPHA_OFFSET] = OPAQUE;
    }
  }

  return {
    width,
    height,
    pixels
  };
}

export function createFakePreviewSource() {
  const source = {
    captureIdOf: ({ id }) => id.replace(DEVICE_DIGITS, "") || undefined,
    bridge: {
      openSource(config) {
        let frameIndex = 0;
        return {
          readNextFrame: () =>
            drawFrame({
              config,
              frameIndex: frameIndex++
            }),
          close: () => undefined
        };
      }
    }
  } satisfies PreviewSource;
  return source;
}
