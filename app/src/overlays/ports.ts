// What the overlays need from the rest of the app, as the small interfaces they are tested with.
// MEDIA and CORE satisfy these; nothing here imports them.

export interface OverlayLog {
  write(message: string): void;
}

export interface CursorApi {
  cursorPosition: () => {
    x: number;
    y: number;
  };
}
