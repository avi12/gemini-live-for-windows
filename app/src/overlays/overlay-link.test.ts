import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Monitor } from "@/contracts/monitor.ts";
import { linkedTransports } from "@/lib/transport/linked-transports.ts";
import { connectOverlayWindows } from "@/overlays/controller-link.ts";
import { CircleAction } from "@/overlays/protocol.ts";
import type { CircleOutcome, OpenCircle } from "@/overlays/protocol.ts";
import { serveOverlayWindows } from "@/overlays/window/window-link.ts";
import type { OverlayWindowEvents, OverlayWindowHost } from "@/overlays/window/window-link.ts";

const MONITOR: Monitor = {
  deviceName: "\\\\.\\DISPLAY1",
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
const OPEN: OpenCircle = {
  monitor: MONITOR,
  stillJpegBase64: "AQID",
  stillWidth: 1920,
  stillHeight: 1080,
  isAskOnRelease: false,
  isSelectingText: false
};

async function settle() {
  await new Promise(resolve => setImmediate(resolve));
}

const CANCELLED: CircleOutcome = { isCancelled: true };

function setup({ outcome = CANCELLED }: { outcome?: CircleOutcome } = {}) {
  const transports = linkedTransports();
  const calls: string[] = [];
  const heard: string[] = [];
  const lines: string[] = [];
  let events: OverlayWindowEvents | undefined;
  const host: OverlayWindowHost = {
    coverBorder: ({ monitor, region }) => calls.push(`cover:${monitor.index}:${region === null ? "whole" : region.x}`),
    hideBorder: () => calls.push("hideBorder"),
    attachChip: ({ region }) => calls.push(`chip:${region.x}`),
    hideChip: () => calls.push("hideChip"),
    holdFocusEscape: isHeld => calls.push(`escape:${isHeld}`),
    async openCircle(options) {
      calls.push(`open:${options.stillWidth}`);
      return outcome;
    },
    closeCircle: () => calls.push("closeCircle")
  };
  serveOverlayWindows({
    transport: transports.second,
    createHost(next) {
      events = next;
      return host;
    },
    log: {
      write: message => lines.push(message)
    }
  });
  const link = connectOverlayWindows({
    transport: transports.first,
    log: {
      write: message => lines.push(message)
    },
    events: {
      focusEscapePressed: () => heard.push("escape"),
      chipDismissed: () => heard.push("dismissed"),
      chipDragStarted: () => heard.push("dragStarted"),
      chipDragged: travelled => heard.push(`dragged:${travelled.x},${travelled.y}`),
      chipSelectTextPressed: () => heard.push("selectText"),
      circleKeyPressed: () => heard.push("circleKey"),
      async readCircleText({ region }) {
        heard.push(`read:${region === null ? "all" : region.width}`);
        return [
          {
            words: [
              {
                text: "hi",
                bounds: {
                  x: 1,
                  y: 2,
                  width: 3,
                  height: 4
                }
              }
            ]
          }
        ];
      },
      async searchCircle({ action }) {
        heard.push(`search:${action}`);
        return "https://result.example/";
      },
      async searchRegion() {
        return "https://region.example/";
      },
      async scanCircleCodes({ region }) {
        heard.push(`scan:${region.width}`);
        return ["https://qr.example/"];
      }
    }
  });
  return {
    link,
    calls,
    heard,
    lines,
    events: () => events
  };
}

describe("the overlay link", () => {
  it("carries the controller's commands to the windows", async () => {
    const { link, calls } = setup();
    link.windows.coverBorder({
      monitor: MONITOR,
      region: null
    });
    link.windows.coverBorder({
      monitor: MONITOR,
      region: REGION
    });
    link.windows.attachChip({
      monitor: MONITOR,
      region: REGION
    });
    link.windows.hideChip();
    link.windows.hideBorder();
    link.windows.holdEscape({ isHeld: true });
    await settle();
    assert.deepEqual(calls, ["cover:1:whole", "cover:1:10", "chip:10", "hideChip", "hideBorder", "escape:true"]);
  });

  it("carries the windows' events to the controller", async () => {
    const { events, heard } = setup();
    events()?.focusEscapePressed();
    events()?.chipDismissed();
    events()?.chipDragStarted();
    events()?.chipDragged({
      x: 4,
      y: -5
    });
    events()?.circleKeyPressed();
    await settle();
    assert.deepEqual(heard, ["escape", "dismissed", "dragStarted", "dragged:4,-5", "circleKey"]);
  });

  it("answers the circle request with the outcome", async () => {
    const outcome: CircleOutcome = {
      isCancelled: false,
      action: CircleAction.LENS,
      region: REGION
    };
    const { link, calls } = setup({ outcome });
    assert.deepEqual(await link.openCircle(OPEN), outcome);
    assert.deepEqual(calls, ["open:1920"]);
  });

  it("tells the window to close the open overlay", async () => {
    const { link, calls } = setup();
    link.closeCircle();
    await Promise.resolve();
    assert.deepEqual(calls, ["closeCircle"]);
  });

  it("answers a cancelled overlay", async () => {
    const { link } = setup();
    assert.deepEqual(await link.openCircle(OPEN), { isCancelled: true });
  });

  it("reads text for the window and gets the lines back", async () => {
    const { events, heard } = setup();
    const lines = await events()?.readCircleText({ region: REGION });
    assert.deepEqual(lines, [
      {
        words: [
          {
            text: "hi",
            bounds: {
              x: 1,
              y: 2,
              width: 3,
              height: 4
            }
          }
        ]
      }
    ]);
    assert.deepEqual(heard, ["read:300"]);
  });

  it("asks the controller to search and gets the result page", async () => {
    const { events, heard } = setup();
    assert.equal(
      await events()?.searchCircle({
        action: CircleAction.BING,
        region: REGION
      }),
      "https://result.example/"
    );
    assert.deepEqual(heard, ["search:bing"]);
  });

  it("asks the controller to scan for QR codes and gets their text", async () => {
    const { events, heard } = setup();
    assert.deepEqual(await events()?.scanCircleCodes({ region: REGION }), ["https://qr.example/"]);
    assert.deepEqual(heard, ["scan:300"]);
  });

  it("treats an overlay that failed as a cancel and logs it", async () => {
    const transports = linkedTransports();
    const lines: string[] = [];
    serveOverlayWindows({
      transport: transports.second,
      createHost: () => ({
        coverBorder: () => undefined,
        hideBorder: () => undefined,
        attachChip: () => undefined,
        hideChip: () => undefined,
        holdFocusEscape: () => undefined,
        closeCircle: () => undefined,
        async openCircle() {
          throw new Error("window died");
        }
      }),
      log: {
        write: message => lines.push(message)
      }
    });
    const link = connectOverlayWindows({
      transport: transports.first,
      log: {
        write: message => lines.push(message)
      },
      events: {
        focusEscapePressed: () => undefined,
        chipDismissed: () => undefined,
        chipDragStarted: () => undefined,
        chipDragged: () => undefined,
        chipSelectTextPressed: () => undefined,
        circleKeyPressed: () => undefined,
        readCircleText: async () => [],
        searchCircle: async () => "",
        searchRegion: async () => "",
        scanCircleCodes: async () => []
      }
    });
    assert.deepEqual(await link.openCircle(OPEN), {
      isCancelled: true,
      error: "window died"
    });
    assert.ok(lines.some(line => line.includes("window died")));
  });

  it("refuses a still that is not base64 before the window sees it", async () => {
    const transports = linkedTransports();
    const opened: OpenCircle[] = [];
    serveOverlayWindows({
      transport: transports.second,
      createHost: () => ({
        coverBorder: () => undefined,
        hideBorder: () => undefined,
        attachChip: () => undefined,
        hideChip: () => undefined,
        holdFocusEscape: () => undefined,
        closeCircle: () => undefined,
        async openCircle(options) {
          opened.push(options);
          return { isCancelled: true };
        }
      }),
      log: {
        write: () => undefined
      }
    });
    const link = connectOverlayWindows({
      transport: transports.first,
      log: {
        write: () => undefined
      },
      events: {
        focusEscapePressed: () => undefined,
        chipDismissed: () => undefined,
        chipDragStarted: () => undefined,
        chipDragged: () => undefined,
        chipSelectTextPressed: () => undefined,
        circleKeyPressed: () => undefined,
        readCircleText: async () => [],
        searchCircle: async () => "",
        searchRegion: async () => "",
        scanCircleCodes: async () => []
      }
    });
    const outcome = await link.openCircle({
      ...OPEN,
      stillJpegBase64: "not base64!"
    });
    assert.equal(outcome.isCancelled, true);
    assert.deepEqual(opened, []);
  });
});
