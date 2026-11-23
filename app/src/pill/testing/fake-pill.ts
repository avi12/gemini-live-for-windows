import { EngineKind } from "@/contracts/live-engine.ts";
import { createPillController } from "@/pill/controller.ts";
import { createFakeDeps, createFakeListeners, createFakeWorld } from "@/pill/testing/fake-deps.ts";
import type { NextEngine } from "@/pill/testing/fake-deps.ts";
import type { FakeEngine } from "@/pill/testing/fake-engine.ts";

function lastFakeEngine(engines: readonly FakeEngine[]) {
  const last = engines.at(-1);
  if (!last) {
    throw new Error("no engine was created");
  }

  return last;
}

// The pill controller over fake ports, with the handles a test stages and checks it through
export function createFakePill({
  engineKind = EngineKind.GOOGLE,
  hasApiKey = true,
  isPackaged = true
}: {
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
  const queue: { next: NextEngine } = {
    next: {}
  };

  const controller = createPillController(
    createFakeDeps({
      world,
      engines,
      calls,
      logs,
      listeners,
      queue,
      isPackaged
    })
  );

  return {
    controller,
    world,
    engines,
    logs,
    calls,
    listeners,
    prepareNextEngine(options: NextEngine) {
      queue.next = options;
    },
    get engine() {
      return lastFakeEngine(engines);
    }
  };
}

// Lets every pending promise and microtask run
export async function settle() {
  await new Promise(resolve => {
    setImmediate(resolve);
  });
}
