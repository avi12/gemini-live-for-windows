import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createFocusEscapeKey, createHeldKey, HotkeyCombination } from "@/overlays/window/hotkeys.ts";
import type { HotkeyCombination as Combination, RegisterHotkey } from "@/overlays/window/hotkeys.ts";

function fakeSystem() {
  const owned = new Map<Combination, () => void>();
  const registrations: Combination[] = [];
  const lines: string[] = [];
  function register({ keys, onpressed }: Parameters<RegisterHotkey>[0]) {
    if (owned.has(keys)) {
      throw new Error(`conflict on ${keys}`);
    }

    owned.set(keys, onpressed);
    registrations.push(keys);
    return {
      unregister() {
        owned.delete(keys);
      }
    };
  }

  return {
    owned,
    registrations,
    lines,
    register,
    log: {
      write(message: string) {
        lines.push(message);
      }
    },
    press: (keys: Combination) => owned.get(keys)?.()
  };
}

describe("createHeldKey", () => {
  it("takes the key only while held", () => {
    const system = fakeSystem();
    const key = createHeldKey({
      keys: HotkeyCombination.ESCAPE,
      register: system.register,
      onPressed: () => undefined,
      log: system.log
    });
    assert.equal(system.owned.size, 0);
    key.hold(true);
    assert.equal(system.owned.has(HotkeyCombination.ESCAPE), true);
    assert.equal(key.isHeld, true);
    key.hold(false);
    assert.equal(system.owned.size, 0);
    assert.equal(key.isHeld, false);
  });

  it("registers once however often it is held", () => {
    const system = fakeSystem();
    const key = createHeldKey({
      keys: HotkeyCombination.ESCAPE,
      register: system.register,
      onPressed: () => undefined,
      log: system.log
    });
    key.hold(true);
    key.hold(true);
    assert.equal(system.registrations.length, 1);
  });

  it("can be released twice", () => {
    const system = fakeSystem();
    const key = createHeldKey({
      keys: HotkeyCombination.ESCAPE,
      register: system.register,
      onPressed: () => undefined,
      log: system.log
    });
    key.hold(true);
    key.hold(false);
    key.hold(false);
    assert.equal(key.isHeld, false);
  });

  it("can be taken again after a release", () => {
    const system = fakeSystem();
    const key = createHeldKey({
      keys: HotkeyCombination.ESCAPE,
      register: system.register,
      onPressed: () => undefined,
      log: system.log
    });
    key.hold(true);
    key.hold(false);
    key.hold(true);
    assert.equal(system.registrations.length, 2);
  });

  it("reaches the handler on a press", () => {
    const system = fakeSystem();
    let presses = 0;
    const key = createHeldKey({
      keys: HotkeyCombination.ESCAPE,
      register: system.register,
      onPressed: () => presses++,
      log: system.log
    });
    key.hold(true);
    system.press(HotkeyCombination.ESCAPE);
    assert.equal(presses, 1);
  });

  it("only logs a key another app holds, and may retry", () => {
    const system = fakeSystem();
    system.owned.set(HotkeyCombination.ESCAPE, () => undefined);
    const key = createHeldKey({
      keys: HotkeyCombination.ESCAPE,
      register: system.register,
      onPressed: () => undefined,
      log: system.log
    });
    key.hold(true);
    assert.equal(key.isHeld, false);
    assert.deepEqual(system.lines, ["hotkey: Esc is taken by another app"]);
    system.owned.clear();
    key.hold(true);
    assert.equal(key.isHeld, true);
  });
});

describe("createFocusEscapeKey", () => {
  it("is Esc and starts released", () => {
    const system = fakeSystem();
    const key = createFocusEscapeKey({
      register: system.register,
      onPressed: () => undefined,
      log: system.log
    });
    assert.equal(system.owned.size, 0);
    key.hold(true);
    assert.equal(system.owned.has(HotkeyCombination.ESCAPE), true);
  });
});
