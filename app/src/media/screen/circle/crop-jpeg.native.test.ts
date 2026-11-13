import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { roInitialize } from "@microsoft/dynwinrt";

import { createDisplayNative } from "@/media/display/display-native.ts";
import { createMonitors } from "@/media/display/monitors.ts";
import { ScreenDetail } from "@/media/screen/capture-geometry.ts";
import { createScreenCapture } from "@/media/screen/screen-capture.ts";

import { cropJpeg } from "./crop-jpeg.ts";

const NUMBER_3 = 3;
const HEX_FF = 0xff;
const HEX_D8 = 0xd8;

const IS_WINDOWS = process.platform === "win32";
const JPEG_MAGIC = [HEX_FF, HEX_D8, HEX_FF];
const FROZEN_SIZE = 800;
const CROP_WIDTH = 200;
const CROP_HEIGHT = 120;

describe("cropping a frozen frame on this machine", { skip: !IS_WINDOWS }, () => {
  it("cuts the region out at its own size, and gives the whole frame for a region off it", async () => {
    roInitialize();
    const monitor = createMonitors({ native: createDisplayNative() }).active();
    const screenCapture = createScreenCapture();
    try {
      const frozen = await screenCapture.grab({
        monitor,
        region: {
          x: 0,
          y: 0,
          width: FROZEN_SIZE,
          height: FROZEN_SIZE
        },
        detail: ScreenDetail.FROZEN
      });
      const crop = await cropJpeg({
        jpeg: frozen.jpeg,
        region: {
          x: 100,
          y: 50,
          width: CROP_WIDTH,
          height: CROP_HEIGHT
        },
        detail: ScreenDetail.SHARP
      });
      assert.deepEqual([...crop.jpeg.subarray(0, NUMBER_3)], JPEG_MAGIC);
      assert.deepEqual([crop.width, crop.height], [CROP_WIDTH, CROP_HEIGHT]);

      const whole = await cropJpeg({
        jpeg: frozen.jpeg,
        region: {
          x: 5000,
          y: 0,
          width: 10,
          height: 10
        },
        detail: ScreenDetail.SHARP
      });
      assert.deepEqual([whole.width, whole.height], [FROZEN_SIZE, FROZEN_SIZE]);
    } finally {
      screenCapture.dispose();
    }
  });
});
