import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PillActionKind } from "@gemini-live/protocol/view";

import { LiveStatus } from "@/contracts/live-engine.ts";
import { KeyTrigger } from "@/core/instance/key-trigger.ts";
import { expectedView, started } from "@/pill/testing/expected-view.ts";
import { DESK, HEADSET } from "@/pill/testing/fake-deps.ts";
import { createFakePill, settle } from "@/pill/testing/fake-pill.ts";

describe("the Copilot key", () => {
  it("ends the conversation on a tap while one runs, and hands focus back", async () => {
    const pill = await started();
    await pill.controller.onTrigger(KeyTrigger.TAP);
    await settle();
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        status: LiveStatus.LISTENING,
        microphones: [HEADSET, DESK]
      })
    );
    assert.equal(pill.engine.calls.disposed, 1);
    assert.equal(pill.calls.at(-1), "restore");
  });

  it("unmutes on a hold while one runs", async () => {
    const pill = await started();
    await pill.controller.apply({ kind: PillActionKind.MUTE });
    assert.equal(pill.controller.view()?.isMuted, true);
    assert.equal(pill.engine.engine.isMuted, true);
    await pill.controller.onTrigger(KeyTrigger.HOLD_START);
    assert.equal(pill.controller.view()?.isMuted, false);
    assert.equal(pill.engine.engine.isMuted, false);
    assert.equal(pill.engines.length, 1);
  });

  it("starts on a hold when idle, and does nothing on release", async () => {
    const pill = createFakePill();
    await pill.controller.onTrigger(KeyTrigger.HOLD_STOP);
    assert.equal(pill.engines.length, 0);
    await pill.controller.onTrigger(KeyTrigger.HOLD_START);
    assert.equal(pill.engines.length, 1);
  });
});
