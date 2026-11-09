// The overlays as the controller (main thread) uses them. The windows and hotkeys themselves run
// on the UI worker: `worker.ts`.

export { createCircleSession } from "@/overlays/circle/session.ts";
export type { CircleSelection } from "@/overlays/circle/session.ts";
export { createLensSearch } from "@/overlays/circle/lens/lens-search.ts";
export { connectOverlayWindows } from "@/overlays/controller-link.ts";
export type { OverlayControllerEvents } from "@/overlays/controller-link.ts";
export { createPreviousApp } from "@/overlays/focus/previous-app.ts";
export { createScreenFocus } from "@/overlays/focus/screen-focus.ts";
export type { FocusEngine, FocusWindows } from "@/overlays/focus/screen-focus.ts";
export type {
  CircleScreen,
  Clipboard,
  CropFrame,
  FrozenScreen,
  OcrLine,
  OcrWord
} from "@/overlays/ports.ts";
export { CircleAction } from "@/overlays/protocol.ts";
