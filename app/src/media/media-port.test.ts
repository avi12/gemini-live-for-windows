import { createMediaPort } from "./media-port.ts";
import type { CameraHandle } from "./media-port.ts";
import { ScreenDetail } from "./screen/capture-geometry.ts";
import type { Monitor } from "@/contracts/monitor.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const HEX_D8 = 0xd8;
const HEX_FF = 0xff;

const MONITOR: Monitor = {
  deviceName: "\\.DISPLAY1",
  index: 1,
  isPrimary: true,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  workRight: 1920,
  workBottom: 1032
};
const FRAME = {
  jpeg: Uint8Array.of(HEX_FF, HEX_D8),
  width: 10,
  height: 5
};

function setup() {
  const grabs: unknown[] = [];
  const state = {
    cameraOpens: 0,
    cameraDisposed: false
  };
  const camera: CameraHandle = {
    grab: () => FRAME,
    dispose() {
      state.cameraDisposed = true;
      return Promise.resolve();
    }
  };
  const port = createMediaPort({
    screenCapture: {
      grab(request) {
        grabs.push(request);
        return Promise.resolve(FRAME);
      }
    },
    screenText: {
      read: () => Promise.resolve(undefined)
    },
    openCamera() {
      state.cameraOpens += 1;
      return Promise.resolve(camera);
    }
  });
  return {
    port,
    grabs,
    state
  };
}

describe("media port", () => {
  it("grabs a frame at the detail the page asked for", async () => {
    const { port, grabs } = setup();
    const frame = await port.grab({
      monitor: MONITOR,
      region: undefined,
      detail: "sharp"
    });
    assert.deepEqual(frame, FRAME);
    assert.deepEqual(grabs, [{
      monitor: MONITOR,
      region: undefined,
      detail: ScreenDetail.sharp
    }]);
  });

  it("opens the camera only when asked, and hands out its latest frame", async () => {
    const { port, state } = setup();
    assert.equal(state.cameraOpens, 0);
    const webcam = await port.openWebcam();
    assert.equal(state.cameraOpens, 1);
    assert.deepEqual(webcam.grab(), FRAME);
    await webcam.dispose();
    assert.equal(state.cameraDisposed, true);
  });

  it("has no screen text until a reader gives some", async () => {
    assert.equal(await setup().port.readScreenText(MONITOR), undefined);
  });
});
