import { monitorSchema, regionSchema } from "@/contracts/monitor.ts";
import type { ProtocolWithReturn } from "winui-svelte/messaging";
import { z } from "zod";

// The overlay boundary: the controller on the main thread (engine, screen capture, OCR, image search) and
// the windows on the UI worker (the share border, the focus chip, the circle overlay and every
// global hotkey, which Windows delivers to the thread that registered it).

export const OverlayMessage = {
  // Controller to windows
  coverBorder: "overlay/coverBorder",
  hideBorder: "overlay/hideBorder",
  attachChip: "overlay/attachChip",
  hideChip: "overlay/hideChip",
  holdFocusEscape: "overlay/holdFocusEscape",
  openCircle: "overlay/openCircle",
  closeCircle: "overlay/closeCircle",
  // Windows to controller
  focusEscapePressed: "overlay/focusEscapePressed",
  chipDismissed: "overlay/chipDismissed",
  chipDragStarted: "overlay/chipDragStarted",
  chipDragged: "overlay/chipDragged",
  circleKeyPressed: "overlay/circleKeyPressed",
  readCircleText: "overlay/readCircleText",
  searchCircle: "overlay/searchCircle",
  searchRegion: "overlay/searchRegion",
  scanCircleCodes: "overlay/scanCircleCodes"
} as const;

// The circle actions that search the web for the crop: the one list `search-engines.ts` gives an
// engine, a label and a key for each
export const SearchAction = {
  lens: "lens",
  lensInBrowser: "lensInBrowser",
  bing: "bing"
} as const;
export type SearchAction = typeof SearchAction[keyof typeof SearchAction];

export const CircleAction = {
  askGemini: "askGemini",
  ...SearchAction
} as const;
export type CircleAction = typeof CircleAction[keyof typeof CircleAction];

// The actions that search the web for the crop rather than hand it to Gemini
export function isSearchAction(action: CircleAction): action is SearchAction {
  return action !== CircleAction.askGemini;
}

export const coverBorderSchema = z.object({
  monitor: monitorSchema,
  // The circled part of the display, in its physical pixels; null for the whole display
  region: regionSchema.nullable()
});
export type CoverBorder = z.infer<typeof coverBorderSchema>;

export const attachChipSchema = z.object({
  monitor: monitorSchema,
  region: regionSchema
});
export type AttachChip = z.infer<typeof attachChipSchema>;

export const holdFocusEscapeSchema = z.object({ isHeld: z.boolean() });
export type HoldFocusEscape = z.infer<typeof holdFocusEscapeSchema>;

export const chipDraggedSchema = z.object({
  // How far the pointer moved since the drag began, in physical screen pixels
  dx: z.number(),
  dy: z.number()
});
export type ChipDragged = z.infer<typeof chipDraggedSchema>;

// A character class and a quantifier: no backtracking, so a multi-megabyte still checks in one pass
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export const openCircleSchema = z.object({
  monitor: monitorSchema,
  // The frozen display as a JPEG, base64; the window shows it and the controller crops it
  stillJpegBase64: z.string().regex(BASE64_PATTERN),
  stillWidth: z.number().int().positive(),
  stillHeight: z.number().int().positive(),
  isAskOnRelease: z.boolean()
});
export type OpenCircle = z.infer<typeof openCircleSchema>;

export const circleOutcomeSchema = z.discriminatedUnion("isCancelled", [
  z.object({
    isCancelled: z.literal(true),
    // Set when the overlay failed rather than the user backing out
    error: z.string().exactOptional()
  }),
  z.object({
    isCancelled: z.literal(false),
    action: z.enum(CircleAction),
    // In the still's physical pixels
    region: regionSchema
  })
]);
export type CircleOutcome = z.infer<typeof circleOutcomeSchema>;

export const readCircleTextSchema = z.object({ region: regionSchema.nullable() });
export type ReadCircleText = z.infer<typeof readCircleTextSchema>;

export const searchCircleSchema = z.object({
  action: z.enum(CircleAction),
  // In the still's physical pixels
  region: regionSchema
});
export type SearchCircle = z.infer<typeof searchCircleSchema>;

// The same search for a region of the screen as it is now, not of a frozen still: what the moved or
// resized region frame sits over
export const searchRegionSchema = z.object({
  action: z.enum(SearchAction),
  monitor: monitorSchema,
  // In the display's physical pixels
  region: regionSchema
}).refine(
  ({ monitor, region }) => region.x >= 0
    && region.y >= 0
    && region.x + region.width <= monitor.width
    && region.y + region.height <= monitor.height,
  { message: "The region must lie within its display" }
);
export type SearchRegion = z.infer<typeof searchRegionSchema>;

export const scanCircleCodesSchema = z.object({ region: regionSchema });
export type ScanCircleCodes = z.infer<typeof scanCircleCodesSchema>;

export const codeTextsSchema = z.array(z.string());

export const ocrLinesSchema = z.array(
  z.object({
    words: z.array(
      z.object({
        text: z.string(),
        bounds: z.object({
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number()
        })
      })
    )
  })
);
export type OcrLines = z.infer<typeof ocrLinesSchema>;

export interface OverlayProtocol {
  [OverlayMessage.coverBorder]: ProtocolWithReturn<CoverBorder, void>;
  [OverlayMessage.hideBorder]: ProtocolWithReturn<void, void>;
  [OverlayMessage.attachChip]: ProtocolWithReturn<AttachChip, void>;
  [OverlayMessage.hideChip]: ProtocolWithReturn<void, void>;
  [OverlayMessage.holdFocusEscape]: ProtocolWithReturn<HoldFocusEscape, void>;
  // Answered when the overlay is gone: the action and region, or that it was cancelled
  [OverlayMessage.openCircle]: ProtocolWithReturn<OpenCircle, CircleOutcome>;
  // Closes the open circle overlay as a cancel; it carries nothing, so it has no schema
  [OverlayMessage.closeCircle]: ProtocolWithReturn<void, void>;
  [OverlayMessage.focusEscapePressed]: ProtocolWithReturn<void, void>;
  [OverlayMessage.chipDismissed]: ProtocolWithReturn<void, void>;
  [OverlayMessage.chipDragStarted]: ProtocolWithReturn<void, void>;
  [OverlayMessage.chipDragged]: ProtocolWithReturn<ChipDragged, void>;
  [OverlayMessage.circleKeyPressed]: ProtocolWithReturn<void, void>;
  [OverlayMessage.readCircleText]: ProtocolWithReturn<ReadCircleText, OcrLines>;
  // The address of the result page, which the results panel shows; empty when the search failed,
  // and the overlay stays up and says so
  [OverlayMessage.searchCircle]: ProtocolWithReturn<SearchCircle, string>;
  // The address of the result page for what the region sits over now; empty when the search failed
  [OverlayMessage.searchRegion]: ProtocolWithReturn<SearchRegion, string>;
  // The decoded text of each QR code inside the region
  [OverlayMessage.scanCircleCodes]: ProtocolWithReturn<ScanCircleCodes, string[]>;
}
