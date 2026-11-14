import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CircleAction } from "@/overlays/protocol.ts";
import {
  CIRCLE_START_FAILURE,
  CIRCLE_START_MILLISECONDS,
  createCircleLifecycle
} from "@/overlays/window/circle-lifecycle.ts";

function setup() {
  const steps: string[] = [];
  let fire: (() => void) | undefined;
  let waited: number | undefined;
  const lifecycle = createCircleLifecycle({
    releaseKeys: () => steps.push("keys"),
    unmount: () => steps.push("unmount"),
    schedule(options) {
      fire = options.callback;
      waited = options.milliseconds;
      return () => steps.push("cancelled");
    }
  });
  return {
    lifecycle,
    steps,
    fire: () => fire?.(),
    waited: () => waited
  };
}

describe("createCircleLifecycle", () => {
  it("cancels the wait, releases the keys, unmounts and answers", async () => {
    const { lifecycle, steps } = setup();
    lifecycle.close({ isCancelled: true });
    assert.deepEqual(await lifecycle.answer, { isCancelled: true });
    assert.deepEqual(steps, ["cancelled", "keys", "unmount"]);
  });

  it("closes once however many times it is asked", async () => {
    const { lifecycle, steps } = setup();
    lifecycle.close({ isCancelled: true });
    lifecycle.close({
      isCancelled: false,
      action: CircleAction.LENS,
      region: {
        x: 0,
        y: 0,
        width: 1,
        height: 1
      }
    });
    lifecycle.fail("late");
    assert.deepEqual(await lifecycle.answer, { isCancelled: true });
    assert.deepEqual(
      steps.filter(step => step === "keys"),
      ["keys"]
    );
    assert.deepEqual(
      steps.filter(step => step === "unmount"),
      ["unmount"]
    );
  });

  it("closes with an error when the window never reports a size", async () => {
    const { lifecycle, steps, fire, waited } = setup();
    assert.equal(waited(), CIRCLE_START_MILLISECONDS);
    fire();
    assert.deepEqual(await lifecycle.answer, {
      isCancelled: true,
      error: CIRCLE_START_FAILURE
    });
    assert.deepEqual(
      steps.filter(step => step === "unmount"),
      ["unmount"]
    );
  });

  it("stops waiting for a size once the controller started", () => {
    const { lifecycle, steps } = setup();
    lifecycle.started();
    assert.deepEqual(steps, ["cancelled"]);
  });

  it("closes with an error when the window cannot be placed", async () => {
    const { lifecycle } = setup();
    lifecycle.fail("no such display");
    assert.deepEqual(await lifecycle.answer, {
      isCancelled: true,
      error: "no such display"
    });
  });
});
