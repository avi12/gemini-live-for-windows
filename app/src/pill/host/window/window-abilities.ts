import { clipToDataSchema, moveByDataSchema, WindowMessage } from "@gemini-live/protocol/view";
import type { PillRegion } from "@gemini-live/protocol/view";
import type { Messaging } from "winui-svelte/messaging";
import { shouldRestore } from "winui-svelte/window/foreground";
import type { ForegroundSnapshot } from "winui-svelte/window/foreground";

import type { PillProtocol } from "@/pill/host/host-link.ts";

export const WINDOW_NOT_UP = "The pill's window isn't up yet";

// The pill's window as the abilities below need it, in physical screen pixels
export interface PillWindowSurface {
  readonly hwnd: bigint;
  position(): {
    x: number;
    y: number;
  };
  moveTo(position: { x: number; y: number }): void;
}

// What the foreground tracker knows, as the abilities below read it
export interface ForegroundMemory {
  readonly lastRealApp: bigint | null;
  readonly foreground: ForegroundSnapshot;
}

// What the controller asks of the pill's window, answered on the UI worker (the thread that owns
// it): to be raised past Windows' foreground lock, and to be moved when the user drags it. A
// request that arrives before the window exists is refused with a reason.
export function serveWindowAbilities({
  link,
  surface,
  memory,
  bringToFrontOf,
  clipWindow,
  log
}: {
  link: Pick<Messaging<PillProtocol>, "onMessage">;
  surface: () => PillWindowSurface | undefined;
  memory: ForegroundMemory;
  bringToFrontOf: (hwnd: bigint) => boolean;
  // Clips the window to `region` (physical pixels from its top-left corner), or shows all of it
  clipWindow: (options: { hwnd: bigint; region: PillRegion | null }) => void;
  log: (message: string) => void;
}) {
  function windowOrThrow() {
    const current = surface();
    if (!current) {
      throw new Error(WINDOW_NOT_UP);
    }

    return current;
  }

  link.onMessage(WindowMessage.BRING_TO_FRONT, () => {
    bringToFrontOf(windowOrThrow().hwnd);
  });
  // Gives the keyboard back to the app the user was in: when Windows left the foreground on the shell
  // or a window of ours, the last real app returns; an app the user switched to is left alone
  link.onMessage(WindowMessage.RESTORE_PREVIOUS_APP, () => {
    const { lastRealApp, foreground: inFront } = memory;
    const isBack =
      lastRealApp !== null &&
      shouldRestore({
        lastRealApp,
        foreground: inFront
      });
    if (!isBack) {
      return;
    }

    bringToFrontOf(lastRealApp);
    log("focus: back to the app that was in front");
  });
  link.onMessage(WindowMessage.MOVE_BY, message => {
    const { deltaX, deltaY } = moveByDataSchema.parse(message.data);
    const current = windowOrThrow();
    const { x, y } = current.position();
    current.moveTo({
      x: x + deltaX,
      y: y + deltaY
    });
  });
  link.onMessage(WindowMessage.CLIP_TO, message => {
    const { region } = clipToDataSchema.parse(message.data);
    clipWindow({
      hwnd: windowOrThrow().hwnd,
      region
    });
  });
}
