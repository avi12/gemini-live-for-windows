import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Monitor } from "@/contracts/monitor.ts";
import { CircleAction } from "@/overlays/protocol.ts";
import { createCircleEntry } from "@/wiring/main-thread/circle-entry.ts";
import type { CircleEntryController, CircleEntrySession } from "@/wiring/main-thread/circle-entry.ts";

const MONITOR: Monitor = {
  deviceName: ".DISPLAY1",
  index: 1,
  isPrimary: true,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  workRight: 1920,
  workBottom: 1040,
  refreshRateHertz: 60
};
const REGION = {
  x: 10,
  y: 20,
  width: 300,
  height: 200
};

function setup({
  isOverlayOpen = false,
  isRegionFocused = false,
  isRunning = false
}: {
  isOverlayOpen?: boolean;
  isRegionFocused?: boolean;
  isRunning?: boolean;
} = {}) {
  const calls: string[] = [];
  const session: CircleEntrySession = {
    isOpen: isOverlayOpen,
    cancel: () => calls.push("cancel"),
    async select({ isAskOnRelease }) {
      calls.push(`select:${isAskOnRelease}`);
      return {
        action: CircleAction.askGemini,
        crop: {
          jpeg: Buffer.from("crop"),
          width: 300,
          height: 200
        },
        region: REGION,
        monitor: MONITOR
      };
    }
  };
  const controller: CircleEntryController = {
    isRunning,
    isRegionFocused,
    focusActiveDisplay: () => calls.push("focusActiveDisplay"),
    async focusRegion({ region }) {
      calls.push(`focusRegion:${region.width}`);
    }
  };
  const circle = createCircleEntry({
    media: {
      monitors: {
        active: () => MONITOR
      }
    },
    controller: () => controller,
    session,
    log: () => undefined
  });
  return {
    circle,
    calls
  };
}

describe("createCircleEntry", () => {
  it("cancels the open overlay and does nothing else", async () => {
    const { circle, calls } = setup({
      isOverlayOpen: true,
      isRegionFocused: true,
      isRunning: true
    });
    await circle();
    assert.deepEqual(calls, ["cancel"]);
  });

  it("hands the whole active display back while a region is focused, without opening the overlay", async () => {
    const { circle, calls } = setup({
      isRegionFocused: true,
      isRunning: true
    });
    await circle();
    assert.deepEqual(calls, ["focusActiveDisplay"]);
  });

  it("starts Circle to Search when idle, then focuses the circled region", async () => {
    const { circle, calls } = setup();
    await circle();
    assert.deepEqual(calls, ["select:false", "focusRegion:300"]);
  });

  it("asks on release when Gemini already runs without a region", async () => {
    const { circle, calls } = setup({ isRunning: true });
    await circle();
    assert.deepEqual(calls, ["select:true", "focusRegion:300"]);
  });
});
