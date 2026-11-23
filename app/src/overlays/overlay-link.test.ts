import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Monitor } from "@/contracts/monitor.ts";
import { linkedTransports } from "@/lib/transport/linked-transports.ts";
import { connectOverlayWindows } from "@/overlays/controller-link.ts";
import { serveOverlayWindows } from "@/overlays/window/window-link.ts";
import type { OverlayWindowEvents, OverlayWindowHost } from "@/overlays/window/window-link.ts";

const MONITOR: Monitor = {
  deviceName: String.raw`\\.\DISPLAY1`,
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

async function settle() {
  await new Promise(resolve => setImmediate(resolve));
}

function setup() {
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
    holdFocusEscape: isHeld => calls.push(`escape:${isHeld}`)
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
      chipDragged: travelled => heard.push(`dragged:${travelled.x},${travelled.y}`)
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
    await settle();
    assert.deepEqual(heard, ["escape", "dismissed", "dragStarted", "dragged:4,-5"]);
  });
});
