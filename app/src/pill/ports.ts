import type { ClipToData, PillNamed } from "@gemini-live/protocol/view";

import type { EngineKind, LiveEngine } from "@/contracts/live-engine.ts";
import type { Monitor } from "@/contracts/monitor.ts";
import type { UpdateCheck } from "@/core/updates/update-checker.ts";

// What the pill controller needs from the rest of the app, as the small interfaces it is tested
// with: CORE, LIVE, GOOGLE, MEDIA and OVERLAYS satisfy these, and nothing here imports them.

interface CreateOptions {
  kind: EngineKind;
  monitor: Monitor;
}

export interface SettingsPort {
  readonly engine: EngineKind;
  readonly microphoneId: string | null;
  readonly hasApiKey: boolean;
  readonly isAutoUpdateOn: boolean;
  setEngine(kind: EngineKind): Promise<void>;
  setMicrophoneId(id: string | null): Promise<void>;
  setApiKey(key: string): Promise<void>;
  setAutoUpdate(isOn: boolean): Promise<void>;
}

export interface EnginesPort {
  create(options: CreateOptions): LiveEngine;
}

interface ReconcileOptions {
  all: readonly Monitor[];
  display: Monitor;
}

export interface GooglePort {
  beginExtensionSetup(): void;
}

export interface DisplaysPort {
  all(): readonly Monitor[];
  active(): Monitor;
  // The current version of `display` in `all`, or the active display when it was unplugged
  reconcile(options: ReconcileOptions): Monitor;
  onChanged(listener: () => void): () => void;
}

export interface MicrophonesPort {
  list(): Promise<readonly PillNamed[]>;
  select(id: string | null): void;
}

// The frame round the display Gemini sees
export interface ShareBorderPort {
  cover(monitor: Monitor): void;
  hideBorder(): void;
}

interface MoveByOptions {
  deltaX: number;
  deltaY: number;
}

export interface PreviousAppPort {
  settle(): Promise<void>;
  restore(): void;
}

export interface PillWindowPort {
  bringToFront(): void;
  restorePreviousApp(): void;
  moveBy(options: MoveByOptions): void;
  clipTo(data: ClipToData): void;
}

export interface UpdatesPort {
  // The running package's version, or undefined when run unpackaged
  readonly installed: string | undefined;
  readonly ready: { readonly version: string } | undefined;
  check(options: { isManual: boolean }): Promise<UpdateCheck>;
  install(): boolean;
  onReadyChanged(listener: () => void): () => void;
  watch(): () => void;
}

export interface PillDeps {
  settings: SettingsPort;
  engines: EnginesPort;
  google: GooglePort;
  displays: DisplaysPort;
  microphones: MicrophonesPort;
  shareBorder: ShareBorderPort;
  previousApp: PreviousAppPort;
  window: PillWindowPort;
  updates: UpdatesPort;
  openExternal(uri: string): void;
  // A web page's own title, read from the page; undefined when it cannot be had
  pageTitle(uri: string): Promise<string | undefined>;
  // Puts text on the clipboard; the pill's own window cannot, as it never takes focus
  copyText(text: string): Promise<void>;
  quit(): void;
  log: (message: string) => void;
  delay(milliseconds: number): Promise<void>;
}
