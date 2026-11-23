// What the overlays need from the rest of the app, as the small interface they are tested with.
// CORE satisfies it; nothing here imports it.

export interface OverlayLog {
  write(message: string): void;
}
