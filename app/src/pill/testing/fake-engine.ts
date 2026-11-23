import type { EngineKind, LiveEngine, LiveEvent, LiveEventListener } from "@/contracts/live-engine.ts";
import type { Monitor } from "@/contracts/monitor.ts";

// How the next start of a fake engine ends: held until `gate` settles, then failing with `fail`
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

function createFakeSubscriptions({
  listeners,
  extensionListeners
}: {
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

// A conversation engine the test drives by hand: it counts starts and disposals, and `emit` plays
// an event to whoever listens
export function createFakeEngine({
  kind,
  monitor,
  hasLevels = false,
  extensionListeners = new Set()
}: {
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
