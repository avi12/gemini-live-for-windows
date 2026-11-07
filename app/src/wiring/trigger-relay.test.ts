import { KeyTrigger } from "@/core/instance/key-trigger.ts";
import { createTriggerRelay } from "@/wiring/trigger-relay.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("the trigger relay", () => {
  it("hands over the presses that came before the target, in order", () => {
    const relay = createTriggerRelay();
    relay.send(KeyTrigger.holdStart);
    relay.send(KeyTrigger.holdStop);
    const heard: KeyTrigger[] = [];
    relay.attach(trigger => heard.push(trigger));
    assert.deepEqual(heard, [KeyTrigger.holdStart, KeyTrigger.holdStop]);
  });

  it("passes later presses straight through", () => {
    const relay = createTriggerRelay();
    const heard: KeyTrigger[] = [];
    relay.attach(trigger => heard.push(trigger));
    relay.send(KeyTrigger.tap);
    assert.deepEqual(heard, [KeyTrigger.tap]);
  });

  it("hands each waiting press over once", () => {
    const relay = createTriggerRelay();
    relay.send(KeyTrigger.tap);
    relay.attach(() => undefined);
    const heard: KeyTrigger[] = [];
    relay.attach(trigger => heard.push(trigger));
    assert.deepEqual(heard, []);
  });
});
