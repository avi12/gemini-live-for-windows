import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Monitor } from "@/contracts/monitor.ts";

import { ScreenDetail } from "./capture-geometry.ts";
import type { PixelRect, PixelSize } from "./capture-geometry.ts";
import type { EncodeRequest } from "./jpeg-encoder.ts";
import { createScreenCapture } from "./screen-capture.ts";
import type { FrameEncoder, PixelGrabber } from "./screen-capture.ts";

const NUMBER_0_POINT_85 = 0.85;
const NUMBER_0_POINT_7 = 0.7;
const NUMBER_3840 = 3840;
const HEX_D8 = 0xd8;
const HEX_FF = 0xff;
const NUMBER_4 = 4;

const MONITOR: Monitor = {
  deviceName: "\\.DISPLAY1",
  index: 1,
  isPrimary: true,
  x: 100,
  y: 50,
  width: 3840,
  height: 2160,
  workRight: 3940,
  workBottom: 2162,
  refreshRateHertz: 60
};

function setup() {
  const areas: PixelRect[] = [];
  const sizes: PixelSize[] = [];
  const requests: EncodeRequest[] = [];
  const order: string[] = [];
  const state = {
    encodeDelay: 0,
    isDisposed: false
  };
  const grabber: PixelGrabber = {
    capture({ area, size }) {
      areas.push(area);
      sizes.push(size);
      order.push(`capture ${area.width}`);
      return {
        ...size,
        address: 1n,
        byteLength: size.width * size.height * NUMBER_4
      };
    },
    dispose() {
      state.isDisposed = true;
    }
  };
  const encoder: FrameEncoder = {
    async encode(request) {
      requests.push(request);
      await new Promise(resolve => setTimeout(resolve, state.encodeDelay));
      order.push(`encoded ${request.pixels.width}`);
      return {
        jpeg: Uint8Array.of(HEX_FF, HEX_D8),
        width: request.pixels.width,
        height: request.pixels.height
      };
    }
  };
  return {
    screenCapture: createScreenCapture({
      grabber,
      encoder
    }),
    areas,
    sizes,
    requests,
    order,
    state
  };
}

describe("screen capture", () => {
  it("copies the whole display from its place in the virtual screen", async () => {
    const { screenCapture, areas } = setup();
    await screenCapture.grab({
      monitor: MONITOR,
      detail: ScreenDetail.LIGHT
    });
    assert.deepEqual(areas, [
      {
        x: 100,
        y: 50,
        width: 3840,
        height: 2160
      }
    ]);
  });

  it("never shrinks a frozen still", async () => {
    const { screenCapture, sizes } = setup();
    await screenCapture.grab({
      monitor: MONITOR,
      detail: ScreenDetail.FROZEN
    });
    assert.deepEqual(sizes, [
      {
        width: 3840,
        height: 2160
      }
    ]);
  });

  it("copies just the region, in physical pixels offset by the display", async () => {
    const { screenCapture, areas } = setup();
    await screenCapture.grab({
      monitor: MONITOR,
      region: {
        x: 10,
        y: 20,
        width: 300,
        height: 200
      },
      detail: ScreenDetail.LIGHT
    });
    assert.deepEqual(areas, [
      {
        x: 110,
        y: 70,
        width: 300,
        height: 200
      }
    ]);
  });

  it("gives the whole display when the region is outside it", async () => {
    const { screenCapture, areas } = setup();
    await screenCapture.grab({
      monitor: MONITOR,
      region: {
        x: 9000,
        y: 0,
        width: 10,
        height: 10
      },
      detail: ScreenDetail.LIGHT
    });
    assert.equal(areas[0]?.width, NUMBER_3840);
  });

  it("shrinks light to 1280 and encodes at 0.70, sharp to 2200 at 0.85", async () => {
    const { screenCapture, requests, sizes } = setup();
    await screenCapture.grab({
      monitor: MONITOR,
      detail: ScreenDetail.LIGHT
    });
    await screenCapture.grab({
      monitor: MONITOR,
      detail: ScreenDetail.SHARP
    });
    assert.deepEqual(sizes, [
      {
        width: 1280,
        height: 720
      },
      {
        width: 2200,
        height: 1237
      }
    ]);
    assert.deepEqual(
      requests.map(request => request.quality),
      [NUMBER_0_POINT_7, NUMBER_0_POINT_85]
    );
  });

  it("does not start a grab until the previous frame is encoded, because the buffer is shared", async () => {
    const { screenCapture, order, state } = setup();
    state.encodeDelay = 20;
    await Promise.all([
      screenCapture.grab({
        monitor: MONITOR,
        region: {
          x: 0,
          y: 0,
          width: 100,
          height: 100
        },
        detail: ScreenDetail.LIGHT
      }),
      screenCapture.grab({
        monitor: MONITOR,
        region: {
          x: 0,
          y: 0,
          width: 200,
          height: 100
        },
        detail: ScreenDetail.LIGHT
      })
    ]);
    assert.deepEqual(order, ["capture 100", "encoded 100", "capture 200", "encoded 200"]);
  });

  it("keeps serving after a grab failed", async () => {
    const failing = createScreenCapture({
      grabber: {
        capture() {
          throw new Error("BitBlt failed");
        },
        dispose: () => undefined
      },
      encoder: {
        encode: () => Promise.reject(new Error("unreachable"))
      }
    });
    await assert.rejects(
      failing.grab({
        monitor: MONITOR,
        detail: ScreenDetail.LIGHT
      }),
      /BitBlt failed/
    );
    await assert.rejects(
      failing.grab({
        monitor: MONITOR,
        detail: ScreenDetail.LIGHT
      }),
      /BitBlt failed/
    );
  });

  it("disposes the grabber", () => {
    const { screenCapture, state } = setup();
    screenCapture.dispose();
    assert.equal(state.isDisposed, true);
  });
});
