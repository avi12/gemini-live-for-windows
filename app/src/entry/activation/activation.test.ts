import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { KeyTrigger } from "@/core/instance/key-trigger.ts";

import {
  ActivationKind,
  describeActivation,
  RECOVERED_ARGUMENT,
  STARTUP_TASK_ACTIVATION_KIND,
  triggerFromArgument,
  userArguments
} from "./activation.ts";

describe("triggerFromArgument", () => {
  it("reads every state, with or without the slashes", () => {
    assert.equal(triggerFromArgument("geminilive-key://?state=Tap"), KeyTrigger.TAP);
    assert.equal(triggerFromArgument("geminilive-key://?state=HoldStart"), KeyTrigger.HOLD_START);
    assert.equal(triggerFromArgument("geminilive-key:?state=HoldStop"), KeyTrigger.HOLD_STOP);
  });

  it("ignores the case of the state", () => {
    assert.equal(triggerFromArgument("geminilive-key://?state=holdstart"), KeyTrigger.HOLD_START);
  });

  it("treats a missing or unknown state as a tap", () => {
    assert.equal(triggerFromArgument("geminilive-key://"), KeyTrigger.TAP);
    assert.equal(triggerFromArgument("geminilive-key://?state=Nonsense"), KeyTrigger.TAP);
    assert.equal(triggerFromArgument("geminilive-key://?state="), KeyTrigger.TAP);
  });

  it("ignores other schemes and plain words", () => {
    assert.equal(triggerFromArgument("https://example.com/?state=HoldStart"), undefined);
    assert.equal(triggerFromArgument("--background"), undefined);
    assert.equal(triggerFromArgument(""), undefined);
  });
});

describe("describeActivation", () => {
  it("is a key press when the URI is an argument", () => {
    assert.deepEqual(describeActivation({ args: ["geminilive-key://?state=HoldStart"] }), {
      kind: ActivationKind.KEY,
      trigger: KeyTrigger.HOLD_START
    });
  });

  it("finds the URI among other arguments", () => {
    assert.deepEqual(describeActivation({ args: ["--x", "geminilive-key://?state=Tap"] }), {
      kind: ActivationKind.KEY,
      trigger: KeyTrigger.TAP
    });
  });

  it("is a plain launch without arguments", () => {
    assert.deepEqual(describeActivation({ args: [] }), { kind: ActivationKind.LAUNCH });
  });

  it("is a sign-in start when Windows reports the startup task", () => {
    assert.deepEqual(
      describeActivation({
        args: [],
        packagedKind: STARTUP_TASK_ACTIVATION_KIND
      }),
      {
        kind: ActivationKind.STARTUP
      }
    );
  });

  it("stays a plain launch for any other packaged kind", () => {
    assert.deepEqual(
      describeActivation({
        args: [],
        packagedKind: 0
      }),
      { kind: ActivationKind.LAUNCH }
    );
  });

  it("is a recovery when the app started itself again", () => {
    assert.deepEqual(describeActivation({ args: [RECOVERED_ARGUMENT] }), { kind: ActivationKind.RECOVERED });
  });

  it("prefers the key press over the startup kind", () => {
    const activation = describeActivation({
      args: ["geminilive-key://?state=Tap"],
      packagedKind: STARTUP_TASK_ACTIVATION_KIND
    });
    assert.equal(activation.kind, ActivationKind.KEY);
  });
});

describe("userArguments", () => {
  it("drops the node and script slots of a SEA argv", () => {
    assert.deepEqual(userArguments(["exe", "exe", "geminilive-key:?state=Tap"]), ["geminilive-key:?state=Tap"]);
  });
});
