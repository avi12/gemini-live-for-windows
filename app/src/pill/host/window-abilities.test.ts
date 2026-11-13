import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WindowMessage } from "@gemini-live/protocol/view";
import { defineMessaging } from "winui-svelte/messaging";

import { linkedTransports } from "@/lib/transport/linked-transports.ts";
import type { ForegroundApi } from "@/overlays/ports.ts";
import type { PillProtocol } from "@/pill/host/host-link.ts";
import { serveWindowAbilities, WINDOW_NOT_UP } from "@/pill/host/window-abilities.ts";
import type { ForegroundMemory, PillWindowSurface } from "@/pill/host/window-abilities.ts";

const PILL_WINDOW = 4242n;
const APP_IN_FRONT = 7n;
const EARLIER_APP = 9n;
const SHELL = 3n;

const SHELL_IN_FRONT: ForegroundMemory = {
  lastRealApp: EARLIER_APP,
  foreground: {
    hwnd: SHELL,
    isRealApp: false
  }
};

function setup({
  isUp = true,
  memory = SHELL_IN_FRONT
}: {
  isUp?: boolean;
  memory?: ForegroundMemory;
} = {}) {
  const transports = linkedTransports();
  const calls: string[] = [];
  const foreground: ForegroundApi = {
    foregroundWindow: () => APP_IN_FRONT,
    isWindow: () => true,
    classNameOf: () => "Window",
    processIdOf: () => 1,
    threadIdOf: () => 2,
    currentThreadId: () => 2,
    attachThreadInput: () => false,
    bringWindowToTop: hwnd => calls.push(`top ${hwnd}`),
    setForegroundWindow: hwnd => calls.push(`foreground ${hwnd}`)
  };
  let position = {
    x: 100,
    y: 200
  };
  const surface: PillWindowSurface = {
    hwnd: PILL_WINDOW,
    position: () => position,
    moveTo(next) {
      position = next;
      calls.push(`move ${next.x} ${next.y}`);
    }
  };
  serveWindowAbilities({
    link: defineMessaging<PillProtocol>({ transport: transports.second }),
    surface: () => (isUp ? surface : undefined),
    foreground,
    memory,
    bringToFrontOf(hwnd) {
      calls.push(`bring ${hwnd}`);
      return true;
    },
    log: message => calls.push(message)
  });
  return {
    host: defineMessaging<PillProtocol>({ transport: transports.first }),
    calls
  };
}

describe("the pill window's abilities", () => {
  it("raises the window past the foreground lock", async () => {
    const { host, calls } = setup();
    await host.sendMessage(WindowMessage.BRING_TO_FRONT);
    assert.deepEqual(calls, [`top ${PILL_WINDOW}`, `foreground ${PILL_WINDOW}`]);
  });

  it("puts the earlier app back when the shell holds the foreground", async () => {
    const { host, calls } = setup();
    await host.sendMessage(WindowMessage.RESTORE_PREVIOUS_APP);
    assert.deepEqual(calls, [`bring ${EARLIER_APP}`, "focus: back to the app that was in front"]);
  });

  it("leaves an app the user switched to alone", async () => {
    const { host, calls } = setup({
      memory: {
        lastRealApp: EARLIER_APP,
        foreground: {
          hwnd: APP_IN_FRONT,
          isRealApp: true
        }
      }
    });
    await host.sendMessage(WindowMessage.RESTORE_PREVIOUS_APP);
    assert.deepEqual(calls, []);
  });

  it("restores nothing before any app was seen", async () => {
    const { host, calls } = setup({
      memory: {
        lastRealApp: null,
        foreground: {
          hwnd: null,
          isRealApp: false
        }
      }
    });
    await host.sendMessage(WindowMessage.RESTORE_PREVIOUS_APP);
    assert.deepEqual(calls, []);
  });

  it("moves the window by the distance it was dragged", async () => {
    const { host, calls } = setup();
    await host.sendMessage(WindowMessage.MOVE_BY, {
      deltaX: -15,
      deltaY: 8
    });
    assert.deepEqual(calls, ["move 85 208"]);
  });

  it("refuses a move that is not whole pixels", async () => {
    const { host } = setup();
    await assert.rejects(
      host.sendMessage(WindowMessage.MOVE_BY, {
        deltaX: 0.5,
        deltaY: 0
      })
    );
  });

  it("answers with a reason before the window exists", async () => {
    const { host } = setup({ isUp: false });
    await assert.rejects(host.sendMessage(WindowMessage.BRING_TO_FRONT), new RegExp(WINDOW_NOT_UP));
    await assert.rejects(
      host.sendMessage(WindowMessage.MOVE_BY, {
        deltaX: 1,
        deltaY: 1
      }),
      new RegExp(WINDOW_NOT_UP)
    );
  });
});
