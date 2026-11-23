import type { ProtocolWithReturn } from "winui-svelte/messaging";
import { z } from "zod";

import { monitorSchema } from "@/contracts/monitor.ts";

// The overlay boundary: the controller on the main thread (engine, screen capture) drives the share
// border, a window, which lives on the UI worker.

export const OverlayMessage = {
  COVER_BORDER: "overlay/coverBorder",
  HIDE_BORDER: "overlay/hideBorder"
} as const;

export const coverBorderSchema = z.object({ monitor: monitorSchema });
export type CoverBorder = z.infer<typeof coverBorderSchema>;

export interface OverlayProtocol {
  [OverlayMessage.COVER_BORDER]: ProtocolWithReturn<CoverBorder, void>;
  [OverlayMessage.HIDE_BORDER]: ProtocolWithReturn<void, void>;
}
