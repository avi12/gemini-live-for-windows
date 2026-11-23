import type { PillNamed } from "@gemini-live/protocol/view";

import type { EngineKind } from "@/contracts/live-engine.ts";
import type { Monitor } from "@/contracts/monitor.ts";
import { UpdateCheck } from "@/core/updates/update-checker.ts";
import type { PillDeps } from "@/pill/ports.ts";
import { createFakeEngine } from "@/pill/testing/fake-engine.ts";
import type { FakeEngine } from "@/pill/testing/fake-engine.ts";
import { PRIMARY, SECONDARY } from "@/pill/testing/fake-monitors.ts";

export const HEADSET: PillNamed = {
  id: "mic-1",
  name: "Headset"
};
export const DESK: PillNamed = {
  id: "mic-2",
  name: "Desk"
};

// How the next engine the pill creates behaves
export interface NextEngine {
  fail?: Error | undefined;
  gate?: Promise<void> | undefined;
  reportsLevels?: boolean;
}

// Everything the fake ports read, which a test changes to stage what the devices and settings say
interface FakeWorld {
  engineKind: EngineKind;
  hasApiKey: boolean;
  microphoneId: string | null;
  isAutoUpdateOn: boolean;
  displays: readonly Monitor[];
  active: Monitor;
  microphones: readonly PillNamed[];
  readyVersion: string | undefined;
  isInstallOk: boolean;
  checkResult: UpdateCheck;
}

export function createFakeWorld({ engineKind, hasApiKey }: { engineKind: EngineKind; hasApiKey: boolean }) {
  const world: FakeWorld = {
    engineKind,
    hasApiKey,
    microphoneId: null,
    isAutoUpdateOn: true,
    displays: [PRIMARY, SECONDARY],
    active: PRIMARY,
    microphones: [HEADSET, DESK],
    readyVersion: undefined,
    isInstallOk: true,
    checkResult: UpdateCheck.UP_TO_DATE
  };
  return world;
}

// The listeners the pill subscribes through the ports, for a test to call
interface FakeListeners {
  displays: Set<() => void>;
  updates: Set<() => void>;
  extension: Set<(isNeeded: boolean) => void>;
}

export function createFakeListeners() {
  const listeners: FakeListeners = {
    displays: new Set(),
    updates: new Set(),
    extension: new Set()
  };
  return listeners;
}

function createFakeSettings({ world, calls }: { world: FakeWorld; calls: string[] }) {
  return {
    get engine() {
      return world.engineKind;
    },
    get microphoneId() {
      return world.microphoneId;
    },
    get hasApiKey() {
      return world.hasApiKey;
    },
    get isAutoUpdateOn() {
      return world.isAutoUpdateOn;
    },
    setEngine(kind) {
      world.engineKind = kind;
      return Promise.resolve();
    },
    setMicrophoneId(id) {
      world.microphoneId = id;
      return Promise.resolve();
    },
    setApiKey(key) {
      calls.push(`setApiKey ${key}`);
      world.hasApiKey = true;
      return Promise.resolve();
    },
    setAutoUpdate(isOn) {
      world.isAutoUpdateOn = isOn;
      return Promise.resolve();
    }
  } satisfies PillDeps["settings"];
}

function createFakeDisplays({ world, listeners }: { world: FakeWorld; listeners: FakeListeners }) {
  return {
    all: () => world.displays,
    active: () => world.active,
    reconcile({ all, display }) {
      const survivor = all.find(candidate => candidate.deviceName === display.deviceName);
      return survivor ?? world.active;
    },
    onChanged(listener) {
      listeners.displays.add(listener);
      return () => listeners.displays.delete(listener);
    }
  } satisfies PillDeps["displays"];
}

function createFakeShareBorder(calls: string[]) {
  return {
    cover: monitor => calls.push(`cover ${monitor.index}`),
    hideBorder: () => calls.push("hideBorder")
  } satisfies PillDeps["shareBorder"];
}

function createFakeUpdates({
  world,
  calls,
  listeners,
  isPackaged
}: {
  world: FakeWorld;
  calls: string[];
  listeners: FakeListeners;
  isPackaged: boolean;
}) {
  return {
    installed: isPackaged ? "1.0.0" : undefined,
    get ready() {
      return world.readyVersion === undefined ? undefined : { version: world.readyVersion };
    },
    check({ isManual }) {
      calls.push(`check ${isManual}`);
      return Promise.resolve(world.checkResult);
    },
    install: () => world.isInstallOk,
    onReadyChanged(listener) {
      listeners.updates.add(listener);
      return () => listeners.updates.delete(listener);
    },
    watch() {
      calls.push("watch");
      return () => calls.push("unwatch");
    }
  } satisfies PillDeps["updates"];
}

function createFakeShell({ world, calls }: { world: FakeWorld; calls: string[] }) {
  return {
    google: {
      beginExtensionSetup() {
        calls.push("beginExtensionSetup");
      }
    },
    microphones: {
      list: () => Promise.resolve(world.microphones),
      select(id) {
        calls.push(`selectMicrophone ${id}`);
      }
    },
    previousApp: {
      settle() {
        calls.push("settle");
        return Promise.resolve();
      },
      restore: () => calls.push("restore")
    },
    window: {
      bringToFront: () => calls.push("bringToFront"),
      restorePreviousApp: () => calls.push("restorePreviousApp"),
      moveBy: ({ deltaX, deltaY }) => calls.push(`moveBy ${deltaX} ${deltaY}`),
      clipTo: ({ region }) => calls.push(`clipTo ${JSON.stringify(region)}`)
    }
  } satisfies Pick<PillDeps, "google" | "microphones" | "previousApp" | "window">;
}

function createFakeEnginesPort({
  engines,
  listeners,
  queue
}: {
  engines: FakeEngine[];
  listeners: FakeListeners;
  queue: { next: NextEngine };
}) {
  return {
    create({ kind, monitor }) {
      const { next } = queue;
      const fake = createFakeEngine({
        kind,
        monitor,
        hasLevels: next.reportsLevels ?? false,
        extensionListeners: listeners.extension
      });
      fake.startControl.fail = next.fail;
      fake.startControl.gate = next.gate;
      queue.next = {};
      engines.push(fake);
      return fake.engine;
    }
  } satisfies PillDeps["engines"];
}

// Every port the pill controller takes, over the fake world: what the pill asks of them lands in
// `calls`, what it logs in `logs`, and each engine it creates in `engines`
export function createFakeDeps({
  world,
  engines,
  calls,
  logs,
  listeners,
  queue,
  isPackaged
}: {
  world: FakeWorld;
  engines: FakeEngine[];
  calls: string[];
  logs: string[];
  listeners: FakeListeners;
  queue: { next: NextEngine };
  isPackaged: boolean;
}) {
  return {
    ...createFakeShell({
      world,
      calls
    }),
    settings: createFakeSettings({
      world,
      calls
    }),
    displays: createFakeDisplays({
      world,
      listeners
    }),
    updates: createFakeUpdates({
      world,
      calls,
      listeners,
      isPackaged
    }),
    engines: createFakeEnginesPort({
      engines,
      listeners,
      queue
    }),
    shareBorder: createFakeShareBorder(calls),
    openExternal: uri => calls.push(`open ${uri}`),
    pageTitle: () => Promise.resolve(undefined),
    copyText(text) {
      calls.push(`copy ${text}`);
      return Promise.resolve();
    },
    quit: () => calls.push("quit"),
    log: message => logs.push(message),
    delay: () => Promise.resolve()
  } satisfies PillDeps;
}
