import { linkedTransports } from "@/lib/linked-transports.ts";
import type { ForegroundApi } from "@/overlays/ports.ts";
import type { PillProtocol } from "@/pill/host-link.ts";
import { serveWindowAbilities, WINDOW_NOT_UP } from "@/pill/window-abilities.ts";
import type { PillWindowSurface } from "@/pill/window-abilities.ts";
import { WindowMessage } from "@gemini-live/protocol/view";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineMessaging } from "winui-svelte/messaging";

const PILL_WINDOW = 4242n;
const APP_IN_FRONT = 7n;

function setup({ isUp = true }: { isUp?: boolean } = {}) {
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
    surface: () => isUp ? surface : undefined,
    foreground
  });
  return {
    host: defineMessaging<PillProtocol>({ transport: transports.first }),
    calls
  };
}

describe("the pill window's abilities", () => {
  it("raises the window past the foreground lock", async () => {
    const { host, calls } = setup();
    await host.sendMessage(WindowMessage.bringToFront);
    assert.deepEqual(calls, [`top ${PILL_WINDOW}`, `foreground ${PILL_WINDOW}`]);
  });

  it("moves the window by the distance it was dragged", async () => {
    const { host, calls } = setup();
    await host.sendMessage(WindowMessage.moveBy, {
      deltaX: -15,
      deltaY: 8
    });
    assert.deepEqual(calls, ["move 85 208"]);
  });

  it("refuses a move that is not whole pixels", async () => {
    const { host } = setup();
    await assert.rejects(
      host.sendMessage(WindowMessage.moveBy, {
        deltaX: 0.5,
        deltaY: 0
      })
    );
  });

  it("answers with a reason before the window exists", async () => {
    const { host } = setup({ isUp: false });
    await assert.rejects(host.sendMessage(WindowMessage.bringToFront), new RegExp(WINDOW_NOT_UP));
    await assert.rejects(
      host.sendMessage(WindowMessage.moveBy, {
        deltaX: 1,
        deltaY: 1
      }),
      new RegExp(WINDOW_NOT_UP)
    );
  });
});
