import { EngineKind } from "@/contracts/live-engine.ts";
import type { LiveEngine, LiveEvent, LiveEventListener } from "@/contracts/live-engine.ts";
import type { Monitor, Region } from "@/contracts/monitor.ts";
import { UpdateCheck } from "@/core/updates/update-checker.ts";
import { createPillController } from "@/pill/controller.ts";
import type { PillDeps, ScreenFocusOptions } from "@/pill/ports.ts";
import type { PillNamed } from "@/pill/types.ts";

export const PRIMARY: Monitor = {
  deviceName: "\\\\.\\DISPLAY1",
  index: 1,
  isPrimary: true,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  workRight: 1920,
  workBottom: 1040
};

export const SECONDARY: Monitor = {
  deviceName: "\\\\.\\DISPLAY2",
  index: 2,
  isPrimary: false,
  x: 1920,
  y: 0,
  width: 2560,
  height: 1440,
  workRight: 4480,
  workBottom: 1400
};

const DEFAULT_MICROPHONES: readonly PillNamed[] = [
  {
    id: "mic-1",
    name: "Headset"
  },
  {
    id: "mic-2",
    name: "Desk"
  }
];

interface NextEngine {
  fail?: Error | undefined;
  gate?: Promise<void> | undefined;
  reportsLevels?: boolean;
}

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

interface FakeStartControl {
  fail: Error | undefined;
  gate: Promise<void> | undefined;
}

function createFakeStartControl() {
  const control: FakeStartControl = {
    fail: undefined,
    gate: undefined
  };
  return control;
}

async function waitForFakeStart(startControl: FakeStartControl) {
  await startControl.gate;

  const { fail } = startControl;
  if (fail) {
    throw fail;
  }
}

function createFakeSubscriptions({ listeners, extensionListeners }: {
  listeners: Set<LiveEventListener>;
  extensionListeners: Set<(isNeeded: boolean) => void>;
}) {
  return {
    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onExtensionNeeded(listener) {
      extensionListeners.add(listener);
      return () => extensionListeners.delete(listener);
    }
  } satisfies Pick<LiveEngine, "onEvent" | "onExtensionNeeded">;
}

export function createFakeEngine({ kind, monitor, hasLevels = false, extensionListeners = new Set() }: {
  kind: EngineKind;
  monitor: Monitor;
  hasLevels?: boolean;
  extensionListeners?: Set<(isNeeded: boolean) => void>;
}) {
  const listeners = new Set<LiveEventListener>();
  const startControl = createFakeStartControl();
  const calls = {
    started: 0,
    disposed: 0
  };

  let shared = monitor;
  let isCameraShared = false;
  const engine: LiveEngine = {
    kind,
    reportsLevels: hasLevels,
    get monitor() {
      return shared;
    },
    get isCameraShared() {
      return isCameraShared;
    },
    isMuted: true,
    region: undefined,
    ...createFakeSubscriptions({
      listeners,
      extensionListeners
    }),
    useCamera(isOn) {
      isCameraShared = isOn;
      return Promise.resolve(true);
    },
    start() {
      calls.started += 1;
      return waitForFakeStart(startControl);
    },
    share(next) {
      engine.region = undefined;
      shared = next;
    },
    dispose() {
      calls.disposed += 1;
      return Promise.resolve();
    }
  };

  return {
    engine,
    calls,
    startControl,
    emit(event: LiveEvent) {
      for (const listener of listeners) {
        listener(event);
      }
    }
  };
}

export type FakeEngine = ReturnType<typeof createFakeEngine>;

function createFakeWorld({ engineKind, hasApiKey }: {
  engineKind: EngineKind;
  hasApiKey: boolean;
}) {
  const world: FakeWorld = {
    engineKind,
    hasApiKey,
    microphoneId: null,
    isAutoUpdateOn: true,
    displays: [PRIMARY, SECONDARY],
    active: PRIMARY,
    microphones: DEFAULT_MICROPHONES,
    readyVersion: undefined,
    isInstallOk: true,
    checkResult: UpdateCheck.upToDate
  };
  return world;
}

interface FakeListeners {
  displays: Set<() => void>;
  focus: Set<() => void>;
  updates: Set<() => void>;
  extension: Set<(isNeeded: boolean) => void>;
}

function createFakeListeners() {
  return {
    displays: new Set<() => void>(),
    focus: new Set<() => void>(),
    updates: new Set<() => void>(),
    extension: new Set<(isNeeded: boolean) => void>()
  };
}

function createFakeSettings({ world, calls }: {
  world: FakeWorld;
  calls: string[];
}) {
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

function createFakeDisplays({ world, listeners }: {
  world: FakeWorld;
  listeners: FakeListeners;
}) {
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

function createFakeFocus({ calls, listeners }: {
  calls: string[];
  listeners: FakeListeners;
}) {
  return {
    cover: monitor => calls.push(`cover ${monitor.index}`),
    hideBorder: () => calls.push("hideBorder"),
    focusOn({ monitor, region }: {
      monitor: Monitor;
      region: Region;
    }) {
      calls.push(`focusOn ${monitor.index} ${region.width}x${region.height}`);
    },
    unfocus: () => calls.push("unfocus"),
    onChanged(listener) {
      listeners.focus.add(listener);
      return () => listeners.focus.delete(listener);
    }
  } satisfies ReturnType<PillDeps["createFocus"]>;
}

function createFakeUpdates({ world, calls, listeners, isPackaged }: {
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

function createFakeShell({ world, calls }: {
  world: FakeWorld;
  calls: string[];
}) {
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
      moveBy: ({ deltaX, deltaY }) => calls.push(`moveBy ${deltaX} ${deltaY}`)
    }
  } satisfies Pick<PillDeps, "google" | "microphones" | "previousApp" | "window">;
}

function createFakeEnginesPort({ engines, listeners, queue }: {
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

function lastFakeEngine(engines: readonly FakeEngine[]) {
  const last = engines.at(-1);
  if (!last) {
    throw new Error("no engine was created");
  }

  return last;
}

function createFakeHost({ world, calls, logs, listeners, isPackaged }: {
  world: FakeWorld;
  calls: string[];
  logs: string[];
  listeners: FakeListeners;
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
    openExternal: uri => calls.push(`open ${uri}`),
    quit: () => calls.push("quit"),
    log: message => logs.push(message),
    delay: () => Promise.resolve()
  } satisfies Omit<PillDeps, "engines" | "createFocus">;
}

export function createFakePill({ engineKind = EngineKind.google, hasApiKey = true, isPackaged = true }: {
  engineKind?: EngineKind;
  hasApiKey?: boolean;
  isPackaged?: boolean;
} = {}) {
  const world = createFakeWorld({
    engineKind,
    hasApiKey
  });
  const engines: FakeEngine[] = [];
  const logs: string[] = [];
  const calls: string[] = [];
  const listeners = createFakeListeners();
  let focusOptions: ScreenFocusOptions | undefined;
  const queue: { next: NextEngine } = {
    next: {}
  };

  const deps: PillDeps = {
    ...createFakeHost({
      world,
      calls,
      logs,
      listeners,
      isPackaged
    }),
    engines: createFakeEnginesPort({
      engines,
      listeners,
      queue
    }),
    createFocus(options) {
      focusOptions = options;
      return createFakeFocus({
        calls,
        listeners
      });
    }
  };

  const controller = createPillController(deps);

  return {
    controller,
    world,
    engines,
    logs,
    calls,
    listeners,
    get focusOptions() {
      return focusOptions;
    },
    prepareNextEngine(options: NextEngine) {
      queue.next = options;
    },
    get engine() {
      return lastFakeEngine(engines);
    }
  };
}

export async function settle() {
  await new Promise(resolve => {
    setImmediate(resolve);
  });
}
