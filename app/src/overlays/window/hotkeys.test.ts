import { CircleAction } from "@/overlays/protocol.ts";
import {
  CircleKeyCombination,
  createCopyKey,
  createFocusEscapeKey,
  createHeldKey,
  createOverlayKeys,
  holdCircleKey
} from "@/overlays/window/hotkeys.ts";
import type { CircleKeyCombination as Combination, RegisterHotkey } from "@/overlays/window/hotkeys.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
      keys: CircleKeyCombination.escape,
      register: system.register,
      onPressed: () => undefined,
      log: system.log
    });
    assert.equal(system.owned.size, 0);
    key.hold(true);
    assert.equal(system.owned.has(CircleKeyCombination.escape), true);
    assert.equal(key.isHeld, true);
    key.hold(false);
    assert.equal(system.owned.size, 0);
    assert.equal(key.isHeld, false);
  });

  it("registers once however often it is held", () => {
    const system = fakeSystem();
    const key = createHeldKey({
      keys: CircleKeyCombination.escape,
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
      keys: CircleKeyCombination.escape,
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
      keys: CircleKeyCombination.escape,
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
      keys: CircleKeyCombination.escape,
      register: system.register,
      onPressed: () => presses++,
      log: system.log
    });
    key.hold(true);
    system.press(CircleKeyCombination.escape);
    assert.equal(presses, 1);
  });

  it("only logs a key another app holds, and may retry", () => {
    const system = fakeSystem();
    system.owned.set(CircleKeyCombination.escape, () => undefined);
    const key = createHeldKey({
      keys: CircleKeyCombination.escape,
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

describe("holdCircleKey", () => {
  it("holds Win+Alt+C from the start", () => {
    const system = fakeSystem();
    let presses = 0;
    const key = holdCircleKey({
      register: system.register,
      onPressed: () => presses++,
      log: system.log
    });
    assert.equal(key.isHeld, true);
    assert.deepEqual(system.registrations, ["win+alt+c"]);
    system.press(CircleKeyCombination.circle);
    assert.equal(presses, 1);
  });
});

describe("createCopyKey", () => {
  it("is Ctrl+C and starts released", () => {
    const system = fakeSystem();
    const key = createCopyKey({
      register: system.register,
      onPressed: () => undefined,
      log: system.log
    });
    assert.equal(key.isHeld, false);
    key.hold(true);
    assert.deepEqual(system.registrations, ["ctrl+c"]);
  });
});

describe("createOverlayKeys", () => {
  function overlay() {
    const system = fakeSystem();
    const calls: string[] = [];
    const keys = createOverlayKeys({
      register: system.register,
      log: system.log,
      onEscape: () => calls.push("escape"),
      onFinish: action => calls.push(action),
      onSelectText: () => calls.push("text")
    });
    return {
      system,
      calls,
      keys
    };
  }

  it("holds Esc, Enter, L and T only while open", () => {
    const { system, keys } = overlay();
    assert.equal(system.owned.size, 0);
    keys.hold(true);
    assert.deepEqual([...system.owned.keys()].toSorted(), ["enter", "escape", "l", "t"]);
    keys.hold(false);
    assert.equal(system.owned.size, 0);
  });

  it("maps each key to its action", () => {
    const { system, calls, keys } = overlay();
    keys.hold(true);
    system.press(CircleKeyCombination.escape);
    system.press(CircleKeyCombination.askGemini);
    system.press(CircleKeyCombination.lens);
    system.press(CircleKeyCombination.selectText);
    assert.deepEqual(calls, ["escape", CircleAction.askGemini, CircleAction.lens, "text"]);
  });

  it("cannot take Esc while the focus Esc is still held", () => {
    const { system, keys } = overlay();
    const focusEscape = createFocusEscapeKey({
      register: system.register,
      onPressed: () => undefined,
      log: system.log
    });
    focusEscape.hold(true);
    keys.hold(true);
    assert.deepEqual(system.lines, ["hotkey: Esc is taken by another app"]);
  });

  it("takes Esc once the focus Esc was released first", () => {
    const { system, keys } = overlay();
    const focusEscape = createFocusEscapeKey({
      register: system.register,
      onPressed: () => undefined,
      log: system.log
    });
    focusEscape.hold(true);
    focusEscape.hold(false);
    keys.hold(true);
    assert.deepEqual(system.lines, []);
    assert.equal(system.owned.has(CircleKeyCombination.escape), true);
  });
});
