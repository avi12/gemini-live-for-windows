import { bringToFront } from "@/overlays/focus/foreground.ts";
import type { ForegroundApi } from "@/overlays/ports.ts";
import type { PillProtocol } from "@/pill/host/host-link.ts";
import { moveByDataSchema, WindowMessage } from "@gemini-live/protocol/view";
import type { Messaging } from "winui-svelte/messaging";
import { shouldRestore } from "winui-svelte/window/foreground";
import type { ForegroundSnapshot } from "winui-svelte/window/foreground";

export const WINDOW_NOT_UP = "The pill's window isn't up yet";

// The pill's window as the abilities below need it, in physical screen pixels
export interface PillWindowSurface {
  readonly hwnd: bigint;
  position(): {
    x: number;
    y: number;
  };
  moveTo(position: {
    x: number;
    y: number;
  }): void;
}

// What the foreground tracker knows, as the abilities below read it
export interface ForegroundMemory {
  readonly lastRealApp: bigint | null;
  readonly foreground: ForegroundSnapshot;
}

// What the controller asks of the pill's window, answered on the UI worker (the thread that owns
// it): to be raised past Windows' foreground lock, and to be moved when the user drags it. A
// request that arrives before the window exists is refused with a reason.
export function serveWindowAbilities({ link, surface, foreground, memory, bringToFrontOf, log }: {
  link: Pick<Messaging<PillProtocol>, "onMessage">;
  surface: () => PillWindowSurface | undefined;
  foreground: ForegroundApi;
  memory: ForegroundMemory;
  bringToFrontOf: (hwnd: bigint) => boolean;
  log: (message: string) => void;
}) {
  function windowOrThrow() {
    const current = surface();
    if (!current) {
      throw new Error(WINDOW_NOT_UP);
    }

    return current;
  }

  link.onMessage(WindowMessage.bringToFront, () => {
    bringToFront({
      api: foreground,
      hwnd: windowOrThrow().hwnd
    });
  });
  // Gives the keyboard back to the app the user was in: when Windows left the foreground on the shell
  // or a window of ours, the last real app returns; an app the user switched to is left alone
  link.onMessage(WindowMessage.restorePreviousApp, () => {
    const { lastRealApp, foreground: inFront } = memory;
    const isBack = lastRealApp !== null && shouldRestore({
      lastRealApp,
      foreground: inFront
    });
    if (!isBack) {
      return;
    }

    bringToFrontOf(lastRealApp);
    log("focus: back to the app that was in front");
  });
  link.onMessage(WindowMessage.moveBy, message => {
    const { deltaX, deltaY } = moveByDataSchema.parse(message.data);
    const current = windowOrThrow();
    const { x, y } = current.position();
    current.moveTo({
      x: x + deltaX,
      y: y + deltaY
    });
  });
}
