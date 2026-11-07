import { ScreenDetail } from "./capture-geometry.ts";
import { createCircleScreen } from "./circle-screen.ts";
import type { Monitor } from "@/contracts/monitor.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const NUMBER_2160 = 2160;
const NUMBER_3840 = 3840;
const HEX_D8 = 0xd8;
const HEX_FF = 0xff;

const MONITOR: Monitor = {
  deviceName: "\\.DISPLAY1",
  index: 1,
  isPrimary: true,
  x: 0,
  y: 0,
  width: 3840,
  height: 2160,
  workRight: 3840,
  workBottom: 2112
};

function setup({ isOcrFailing = false }: { isOcrFailing?: boolean } = {}) {
  const grabs: unknown[] = [];
  const logs: string[] = [];
  const circle = createCircleScreen({
    screenCapture: {
      grab(request) {
        grabs.push(request);
        return Promise.resolve({
          jpeg: Uint8Array.of(HEX_FF, HEX_D8),
          width: 3840,
          height: 2160
        });
      }
    },
    readLines: () => isOcrFailing ? Promise.reject(new Error("no language")) : Promise.resolve([]),
    log: message => logs.push(message)
  });
  return {
    circle,
    grabs,
    logs
  };
}

describe("circle screen", () => {
  it("freezes the whole display at full resolution and keeps the monitor with it", async () => {
    const { circle, grabs } = setup();
    const frozen = await circle.freeze(MONITOR);
    assert.deepEqual(grabs, [{
      monitor: MONITOR,
      detail: ScreenDetail.frozen
    }]);
    assert.equal(frozen.monitor, MONITOR);
    assert.deepEqual([frozen.width, frozen.height], [NUMBER_3840, NUMBER_2160]);
  });

  it("reads text without throwing: a failure is logged and means no text", async () => {
    const { circle, logs } = setup({ isOcrFailing: true });
    const frozen = await circle.freeze(MONITOR);
    assert.deepEqual(
      await circle.readText({
        frozen,
        region: undefined
      }), []
    );
    assert.deepEqual(logs, ["OCR failed: no language"]);
  });
});
