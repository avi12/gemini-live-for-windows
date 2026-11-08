import {
  ActivationKind,
  describeActivation,
  RECOVERED_ARGUMENT,
  STARTUP_TASK_ACTIVATION_KIND,
  triggerFromArgument,
  userArguments
} from "./activation.ts";
import { KeyTrigger } from "@/core/instance/key-trigger.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("triggerFromArgument", () => {
  it("reads every state, with or without the slashes", () => {
    assert.equal(triggerFromArgument("geminilive-key://?state=Tap"), KeyTrigger.tap);
    assert.equal(triggerFromArgument("geminilive-key://?state=HoldStart"), KeyTrigger.holdStart);
    assert.equal(triggerFromArgument("geminilive-key:?state=HoldStop"), KeyTrigger.holdStop);
  });

  it("ignores the case of the state", () => {
    assert.equal(triggerFromArgument("geminilive-key://?state=holdstart"), KeyTrigger.holdStart);
  });

  it("treats a missing or unknown state as a tap", () => {
    assert.equal(triggerFromArgument("geminilive-key://"), KeyTrigger.tap);
    assert.equal(triggerFromArgument("geminilive-key://?state=Nonsense"), KeyTrigger.tap);
    assert.equal(triggerFromArgument("geminilive-key://?state="), KeyTrigger.tap);
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
      kind: ActivationKind.key,
      trigger: KeyTrigger.holdStart
    });
  });

  it("finds the URI among other arguments", () => {
    assert.deepEqual(describeActivation({ args: ["--x", "geminilive-key://?state=Tap"] }), {
      kind: ActivationKind.key,
      trigger: KeyTrigger.tap
    });
  });

  it("is a plain launch without arguments", () => {
    assert.deepEqual(describeActivation({ args: [] }), { kind: ActivationKind.launch });
  });

  it("is a sign-in start when Windows reports the startup task", () => {
    assert.deepEqual(
      describeActivation({
        args: [],
        packagedKind: STARTUP_TASK_ACTIVATION_KIND
      }), {
        kind: ActivationKind.startup
      }
    );
  });

  it("stays a plain launch for any other packaged kind", () => {
    assert.deepEqual(
      describeActivation({
        args: [],
        packagedKind: 0
      }), { kind: ActivationKind.launch }
    );
  });

  it("is a recovery when the app started itself again", () => {
    assert.deepEqual(describeActivation({ args: [RECOVERED_ARGUMENT] }), { kind: ActivationKind.recovered });
  });

  it("prefers the key press over the startup kind", () => {
    const activation = describeActivation({
      args: ["geminilive-key://?state=Tap"],
      packagedKind: STARTUP_TASK_ACTIVATION_KIND
    });
    assert.equal(activation.kind, ActivationKind.key);
  });
});

describe("userArguments", () => {
  it("drops the node and script slots of a SEA argv", () => {
    assert.deepEqual(userArguments(["exe", "exe", "geminilive-key:?state=Tap"]), ["geminilive-key:?state=Tap"]);
  });
});
