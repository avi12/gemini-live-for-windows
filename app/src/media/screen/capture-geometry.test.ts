import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Monitor } from "@/contracts/monitor.ts";

import { clipToSurface, DETAIL_SETTINGS, fitToEdge, screenArea, ScreenDetail } from "./capture-geometry.ts";

const SECOND: Monitor = {
  deviceName: "\\.DISPLAY14",
  index: 1,
  isPrimary: false,
  x: -3840,
  y: -134,
  width: 3840,
  height: 2160,
  workRight: 0,
  workBottom: 1978,
  refreshRateHertz: 60
};

describe("detail settings", () => {
  it("light is 1280 pixels at 0.70, sharp 2200 at 0.85, as ScreenGrabber.cs had them", () => {
    assert.deepEqual(DETAIL_SETTINGS[ScreenDetail.LIGHT], {
      maxEdge: 1280,
      quality: 0.7
    });
    assert.deepEqual(DETAIL_SETTINGS[ScreenDetail.SHARP], {
      maxEdge: 2200,
      quality: 0.85
    });
  });

  it("frozen never scales", () => {
    assert.deepEqual(
      fitToEdge({
        size: {
          width: 3840,
          height: 2160
        },
        maxEdge: DETAIL_SETTINGS[ScreenDetail.FROZEN].maxEdge
      }),
      {
        width: 3840,
        height: 2160
      }
    );
  });
});

describe("fit to edge", () => {
  it("scales the longest edge down to the limit, keeping the shape", () => {
    assert.deepEqual(
      fitToEdge({
        size: {
          width: 3840,
          height: 2160
        },
        maxEdge: 1280
      }),
      {
        width: 1280,
        height: 720
      }
    );
  });

  it("works for a portrait display", () => {
    assert.deepEqual(
      fitToEdge({
        size: {
          width: 1080,
          height: 1920
        },
        maxEdge: 1280
      }),
      {
        width: 720,
        height: 1280
      }
    );
  });

  it("never upscales", () => {
    assert.deepEqual(
      fitToEdge({
        size: {
          width: 800,
          height: 600
        },
        maxEdge: 1280
      }),
      {
        width: 800,
        height: 600
      }
    );
  });

  it("keeps at least one pixel on a very thin strip", () => {
    assert.deepEqual(
      fitToEdge({
        size: {
          width: 4000,
          height: 1
        },
        maxEdge: 1280
      }),
      {
        width: 1280,
        height: 1
      }
    );
  });

  it("truncates like the C# (int)(size * scale)", () => {
    assert.deepEqual(
      fitToEdge({
        size: {
          width: 1921,
          height: 1081
        },
        maxEdge: 1280
      }),
      {
        width: 1280,
        height: 720
      }
    );
  });
});

describe("clip to surface", () => {
  const surface = {
    width: 1000,
    height: 500
  };

  it("keeps a region that fits", () => {
    const region = {
      x: 10,
      y: 20,
      width: 300,
      height: 200
    };
    assert.deepEqual(
      clipToSurface({
        region,
        size: surface
      }),
      region
    );
  });

  it("trims what hangs over any edge", () => {
    assert.deepEqual(
      clipToSurface({
        region: {
          x: -50,
          y: 400,
          width: 200,
          height: 200
        },
        size: surface
      }),
      {
        x: 0,
        y: 400,
        width: 150,
        height: 100
      }
    );
  });

  it("is undefined when none of it is on the surface", () => {
    assert.equal(
      clipToSurface({
        region: {
          x: 1000,
          y: 0,
          width: 10,
          height: 10
        },
        size: surface
      }),
      undefined
    );
    assert.equal(
      clipToSurface({
        region: {
          x: -20,
          y: 0,
          width: 20,
          height: 10
        },
        size: surface
      }),
      undefined
    );
  });
});

describe("screen area", () => {
  it("is the whole display, placed in the virtual screen, with no region", () => {
    assert.deepEqual(
      screenArea({
        monitor: SECOND,
        region: undefined
      }),
      {
        x: -3840,
        y: -134,
        width: 3840,
        height: 2160
      }
    );
  });

  it("offsets a region by the display's origin, in physical pixels", () => {
    assert.deepEqual(
      screenArea({
        monitor: SECOND,
        region: {
          x: 100,
          y: 50,
          width: 800,
          height: 600
        }
      }),
      {
        x: -3740,
        y: -84,
        width: 800,
        height: 600
      }
    );
  });

  it("clips a region that spills off the display", () => {
    assert.deepEqual(
      screenArea({
        monitor: SECOND,
        region: {
          x: 3800,
          y: 2100,
          width: 500,
          height: 500
        }
      }),
      {
        x: -40,
        y: 1966,
        width: 40,
        height: 60
      }
    );
  });

  it("is undefined for a region outside the display", () => {
    assert.equal(
      screenArea({
        monitor: SECOND,
        region: {
          x: 5000,
          y: 0,
          width: 10,
          height: 10
        }
      }),
      undefined
    );
  });
});
