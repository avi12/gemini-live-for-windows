import type { Monitor } from "@/contracts/monitor.ts";
import { linkedTransports } from "@/lib/linked-transports.ts";
import { connectOverlayWindows } from "@/overlays/controller-link.ts";
import { CircleAction } from "@/overlays/protocol.ts";
import type { CircleOutcome, OpenCircle } from "@/overlays/protocol.ts";
import { serveOverlayWindows } from "@/overlays/window-link.ts";
import type { OverlayWindowEvents, OverlayWindowHost } from "@/overlays/window-link.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const MONITOR: Monitor = {
  deviceName: "\\\\.\\DISPLAY1",
  index: 1,
  isPrimary: true,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  workRight: 1920,
  workBottom: 1040
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
  isAskOnRelease: false
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
    }
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
      circleKeyPressed: () => heard.push("circleKey"),
      async readCircleText({ region }) {
        heard.push(`read:${region === null ? "all" : region.width}`);
        return [{
          words: [{
            text: "hi",
            bounds: {
              x: 1,
              y: 2,
              width: 3,
              height: 4
            }
          }]
        }];
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
      action: CircleAction.lens,
      region: REGION
    };
    const { link, calls } = setup({ outcome });
    assert.deepEqual(await link.openCircle(OPEN), outcome);
    assert.deepEqual(calls, ["open:1920"]);
  });

  it("answers a cancelled overlay", async () => {
    const { link } = setup();
    assert.deepEqual(await link.openCircle(OPEN), { isCancelled: true });
  });

  it("reads text for the window and gets the lines back", async () => {
    const { events, heard } = setup();
    const lines = await events()?.readCircleText({ region: REGION });
    assert.deepEqual(lines, [{
      words: [{
        text: "hi",
        bounds: {
          x: 1,
          y: 2,
          width: 3,
          height: 4
        }
      }]
    }]);
    assert.deepEqual(heard, ["read:300"]);
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
        circleKeyPressed: () => undefined,
        readCircleText: async () => []
      }
    });
    assert.deepEqual(await link.openCircle(OPEN), { isCancelled: true });
    assert.ok(lines.some(line => line.includes("window died")));
  });
});
