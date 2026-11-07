import type { Monitor, Region } from "@/contracts/monitor.ts";
import type { Rect } from "@/overlays/shapes.ts";

// What the overlays need from the rest of the app, as the small interfaces they are tested with.
// MEDIA and CORE satisfy these; nothing here imports them.

export interface OverlayLog {
  write(message: string): void;
}

export interface OcrWord {
  readonly text: string;
  // In the frozen still's physical pixels
  readonly bounds: Rect;
}

export interface OcrLine {
  readonly words: readonly OcrWord[];
}

// One display frozen the moment the circle key was pressed, as a JPEG the overlay window shows
// and crops. Crops are taken from the encoded still, so no bitmap type crosses this seam.
export interface FrozenScreen {
  readonly monitor: Monitor;
  readonly width: number;
  readonly height: number;
  readonly jpeg: Uint8Array;
}

export interface CropFrame {
  readonly jpeg: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface CircleScreen {
  freeze(monitor: Monitor): Promise<FrozenScreen>;
  crop(options: {
    frozen: FrozenScreen;
    region: Region;
  }): Promise<CropFrame>;
  readText(options: {
    frozen: FrozenScreen;
    region: Region | undefined;
  }): Promise<readonly OcrLine[]>;
}

export interface Clipboard {
  writeText(text: string): Promise<boolean>;
}

export interface FileOpener {
  openFile(options: { filePath: string }): void;
}

// The Win32 foreground calls PreviousApp and the overlay's bring-to-front make
export interface ForegroundApi {
  foregroundWindow(): bigint;
  isWindow(hwnd: bigint): boolean;
  classNameOf(hwnd: bigint): string;
  processIdOf(hwnd: bigint): number;
  threadIdOf(hwnd: bigint): number;
  currentThreadId(): number;
  attachThreadInput(options: {
    ours: number;
    theirs: number;
    isAttached: boolean;
  }): boolean;
  bringWindowToTop(hwnd: bigint): void;
  setForegroundWindow(hwnd: bigint): void;
}

export interface CursorApi {
  cursorPosition(): {
    x: number;
    y: number;
  };
}
