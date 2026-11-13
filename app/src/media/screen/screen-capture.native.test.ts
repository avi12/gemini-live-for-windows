import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { roInitialize } from "@microsoft/dynwinrt";

import { createDisplayNative } from "@/media/display/display-native.ts";
import { createMonitors } from "@/media/display/monitors.ts";

import { ScreenDetail } from "./capture-geometry.ts";
import { createScreenCapture } from "./screen-capture.ts";

const NUMBER_3 = 3;
const HEX_FF = 0xff;
const HEX_D8 = 0xd8;

const IS_WINDOWS = process.platform === "win32";
const JPEG_MAGIC = [HEX_FF, HEX_D8, HEX_FF];
const LIGHT_MAX_EDGE = 1280;
const SHARP_MAX_EDGE = 2200;
const REGION_SIZE = 300;

// Reads this machine's own screen (nothing is stored): the real GDI grab and WIC encode end to end
describe("screen capture on this machine", { skip: !IS_WINDOWS }, () => {
  it("grabs a display as a JPEG of the right size, and quality changes its weight", async () => {
    roInitialize();
    const monitor = createMonitors({ native: createDisplayNative() }).active();
    const screenCapture = createScreenCapture();
    try {
      const light = await screenCapture.grab({
        monitor,
        detail: ScreenDetail.LIGHT
      });
      assert.deepEqual([...light.jpeg.subarray(0, NUMBER_3)], JPEG_MAGIC);
      const monitorEdge = Math.max(monitor.width, monitor.height);
      assert.equal(Math.max(light.width, light.height), Math.min(LIGHT_MAX_EDGE, monitorEdge));

      const sharp = await screenCapture.grab({
        monitor,
        detail: ScreenDetail.SHARP
      });
      assert.equal(Math.max(sharp.width, sharp.height), Math.min(SHARP_MAX_EDGE, monitorEdge));
      assert.ok(sharp.jpeg.length > light.jpeg.length);

      const region = await screenCapture.grab({
        monitor,
        region: {
          x: 0,
          y: 0,
          width: REGION_SIZE,
          height: REGION_SIZE
        },
        detail: ScreenDetail.FROZEN
      });
      assert.deepEqual([region.width, region.height], [REGION_SIZE, REGION_SIZE]);
    } finally {
      screenCapture.dispose();
    }
  });
});
