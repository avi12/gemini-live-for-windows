import { bringToFront } from "@/overlays/focus/foreground.ts";
import type { ForegroundApi } from "@/overlays/ports.ts";
import type { PillProtocol } from "@/pill/host/host-link.ts";
import { moveByDataSchema, WindowMessage } from "@gemini-live/protocol/view";
import type { Messaging } from "winui-svelte/messaging";

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

// What the controller asks of the pill's window, answered on the UI worker (the thread that owns
// it): to be raised past Windows' foreground lock, and to be moved when the user drags it. A
// request that arrives before the window exists is refused with a reason.
export function serveWindowAbilities({ link, surface, foreground }: {
  link: Pick<Messaging<PillProtocol>, "onMessage">;
  surface: () => PillWindowSurface | undefined;
  foreground: ForegroundApi;
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
