import { createPreviousApp, SETTLE_MILLISECONDS } from "@/overlays/focus/previous-app.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function setup() {
  const calls: string[] = [];
  const previousApp = createPreviousApp({
    window: {
      restorePreviousApp: () => calls.push("restore")
    },
    delay(milliseconds) {
      calls.push(`wait ${milliseconds}`);
      return Promise.resolve();
    }
  });
  return {
    previousApp,
    calls
  };
}

describe("the previous app", () => {
  it("asks the UI worker to restore it at once", () => {
    const { previousApp, calls } = setup();
    previousApp.restore();
    assert.deepEqual(calls, ["restore"]);
  });

  it("lets Windows finish handing the foreground over before it asks", async () => {
    const { previousApp, calls } = setup();
    await previousApp.settle();
    assert.deepEqual(calls, [`wait ${SETTLE_MILLISECONDS}`, "restore"]);
  });
});
