import type { EngineKind, LiveEngine } from "@/contracts/live-engine.ts";
import type { Monitor, Region } from "@/contracts/monitor.ts";
import type { UpdateCheck } from "@/core/updates/update-checker.ts";
import type { PillNamed } from "@/pill/types.ts";

// What the pill controller needs from the rest of the app, as the small interfaces it is tested
// with: CORE, LIVE, GOOGLE, MEDIA and OVERLAYS satisfy these, and nothing here imports them.

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
  create(options: {
    kind: EngineKind;
    monitor: Monitor;
  }): LiveEngine;
}

export interface GooglePort {
  beginExtensionSetup(): void;
}

export interface DisplaysPort {
  all(): readonly Monitor[];
  active(): Monitor;
  // The current version of `display` in `all`, or the active display when it was unplugged
  reconcile(options: {
    all: readonly Monitor[];
    display: Monitor;
  }): Monitor;
  onChanged(listener: () => void): () => void;
}

export interface MicrophonesPort {
  list(): Promise<readonly PillNamed[]>;
  select(id: string | null): void;
}

export interface ScreenFocusPort {
  cover(monitor: Monitor): void;
  hideBorder(): void;
  focusOn(options: {
    monitor: Monitor;
    region: Region;
  }): void;
  unfocus(): void;
  onChanged(listener: () => void): () => void;
}

export interface ScreenFocusOptions {
  currentEngine(): LiveEngine | undefined;
}

export interface PreviousAppPort {
  settle(): Promise<void>;
  restore(): void;
  dispose(): void;
}

export interface PillWindowPort {
  bringToFront(): void;
  moveBy(options: {
    deltaX: number;
    deltaY: number;
  }): void;
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
  createFocus(options: ScreenFocusOptions): ScreenFocusPort;
  previousApp: PreviousAppPort;
  window: PillWindowPort;
  updates: UpdatesPort;
  openExternal(uri: string): void;
  quit(): void;
  log(message: string): void;
  delay(milliseconds: number): Promise<void>;
}
