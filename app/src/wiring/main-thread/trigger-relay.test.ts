import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { KeyTrigger } from "@/core/instance/key-trigger.ts";
import { KeySource } from "@/entry/activation/protocol.ts";
import {
  createTriggerRelay,
  FORWARDED_ECHO_MILLISECONDS,
  REPEAT_ECHO_FROM_MILLISECONDS,
  REPEAT_ECHO_UNTIL_MILLISECONDS
} from "@/wiring/main-thread/trigger-relay.ts";

const ECHO_DELAY_MILLISECONDS = 3500;

function pressOf({ trigger, source }: { trigger: KeyTrigger; source: KeySource }) {
  return {
    trigger,
    source
  };
}

describe("the trigger relay", () => {
  it("hands over the presses that came before the target, in order", () => {
    const relay = createTriggerRelay();
    relay.send(
      pressOf({
        trigger: KeyTrigger.HOLD_START,
        source: KeySource.FAST_PATH
      })
    );
    relay.send(
      pressOf({
        trigger: KeyTrigger.HOLD_STOP,
        source: KeySource.FAST_PATH
      })
    );
    const heard: KeyTrigger[] = [];
    relay.attach(trigger => heard.push(trigger));
    assert.deepEqual(heard, [KeyTrigger.HOLD_START, KeyTrigger.HOLD_STOP]);
  });

  it("passes later presses straight through", () => {
    const relay = createTriggerRelay();
    const heard: KeyTrigger[] = [];
    relay.attach(trigger => heard.push(trigger));
    relay.send(
      pressOf({
        trigger: KeyTrigger.TAP,
        source: KeySource.COLD_START
      })
    );
    assert.deepEqual(heard, [KeyTrigger.TAP]);
  });

  it("hands each waiting press over once", () => {
    const relay = createTriggerRelay();
    relay.send(
      pressOf({
        trigger: KeyTrigger.TAP,
        source: KeySource.COLD_START
      })
    );
    relay.attach(() => undefined);
    const heard: KeyTrigger[] = [];
    relay.attach(trigger => heard.push(trigger));
    assert.deepEqual(heard, []);
  });
});

describe("the shell's echo of a fast-path press", () => {
  function setup() {
    const clock = { at: 0 };
    const logged: string[] = [];
    const relay = createTriggerRelay({
      now: () => clock.at,
      log: message => logged.push(message)
    });
    const heard: KeyTrigger[] = [];
    relay.attach(trigger => heard.push(trigger));
    return {
      clock,
      relay,
      heard,
      logged
    };
  }

  it("is dropped when a forwarded press follows a fast-path one", () => {
    const { clock, relay, heard, logged } = setup();
    relay.send(
      pressOf({
        trigger: KeyTrigger.TAP,
        source: KeySource.FAST_PATH
      })
    );
    clock.at = ECHO_DELAY_MILLISECONDS;
    relay.send(
      pressOf({
        trigger: KeyTrigger.TAP,
        source: KeySource.FORWARDED
      })
    );
    assert.deepEqual(heard, [KeyTrigger.TAP]);
    assert.equal(logged.filter(message => message.includes("dropped")).length, 1);
  });

  it("is a real press once the window has passed", () => {
    const { clock, relay, heard } = setup();
    relay.send(
      pressOf({
        trigger: KeyTrigger.TAP,
        source: KeySource.FAST_PATH
      })
    );
    clock.at = FORWARDED_ECHO_MILLISECONDS;
    relay.send(
      pressOf({
        trigger: KeyTrigger.TAP,
        source: KeySource.FORWARDED
      })
    );
    assert.deepEqual(heard, [KeyTrigger.TAP, KeyTrigger.TAP]);
  });

  it("never drops a forwarded press when no fast-path one came first", () => {
    const { relay, heard } = setup();
    relay.send(
      pressOf({
        trigger: KeyTrigger.TAP,
        source: KeySource.FORWARDED
      })
    );
    assert.deepEqual(heard, [KeyTrigger.TAP]);
  });

  it("is dropped when the shell repeats the fast-path tap itself", () => {
    const { clock, relay, heard } = setup();
    relay.send(
      pressOf({
        trigger: KeyTrigger.TAP,
        source: KeySource.FAST_PATH
      })
    );
    clock.at = ECHO_DELAY_MILLISECONDS;
    relay.send(
      pressOf({
        trigger: KeyTrigger.TAP,
        source: KeySource.FAST_PATH
      })
    );
    assert.deepEqual(heard, [KeyTrigger.TAP]);
  });

  it("keeps a quick second fast-path press", () => {
    const { clock, relay, heard } = setup();
    relay.send(
      pressOf({
        trigger: KeyTrigger.TAP,
        source: KeySource.FAST_PATH
      })
    );
    clock.at = REPEAT_ECHO_FROM_MILLISECONDS - 1;
    relay.send(
      pressOf({
        trigger: KeyTrigger.TAP,
        source: KeySource.FAST_PATH
      })
    );
    assert.deepEqual(heard, [KeyTrigger.TAP, KeyTrigger.TAP]);
  });

  it("keeps a fast-path press after the repeat band", () => {
    const { clock, relay, heard } = setup();
    relay.send(
      pressOf({
        trigger: KeyTrigger.TAP,
        source: KeySource.FAST_PATH
      })
    );
    clock.at = REPEAT_ECHO_UNTIL_MILLISECONDS;
    relay.send(
      pressOf({
        trigger: KeyTrigger.TAP,
        source: KeySource.FAST_PATH
      })
    );
    assert.deepEqual(heard, [KeyTrigger.TAP, KeyTrigger.TAP]);
  });
});
