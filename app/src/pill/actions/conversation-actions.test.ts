import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PillActionKind } from "@gemini-live/protocol/view";

import { EngineKind } from "@/contracts/live-engine.ts";
import { started } from "@/pill/testing/expected-view.ts";
import { createFakePill, settle } from "@/pill/testing/fake-pill.ts";

describe("muting", () => {
  it("toggles the tracked state", async () => {
    const pill = await started();
    await pill.controller.apply({ kind: PillActionKind.MUTE });
    assert.equal(pill.controller.view()?.isMuted, true);
    await pill.controller.apply({ kind: PillActionKind.MUTE });
    assert.equal(pill.controller.view()?.isMuted, false);
  });
});

describe("the camera", () => {
  it("shares and unshares on the Google engine", async () => {
    const pill = await started();
    await pill.controller.apply({
      kind: PillActionKind.SET_CAMERA,
      isOn: true
    });
    await settle();
    assert.equal(pill.controller.view()?.isCameraShared, true);
    await pill.controller.apply({
      kind: PillActionKind.SET_CAMERA,
      isOn: false
    });
    await settle();
    assert.equal(pill.controller.view()?.isCameraShared, false);
  });

  it("leaves the camera alone on the API key engine, and logs why", async () => {
    const pill = await started({ engineKind: EngineKind.API_KEY });
    await pill.controller.apply({
      kind: PillActionKind.SET_CAMERA,
      isOn: true
    });
    await settle();
    assert.equal(pill.controller.view()?.isCameraShared, false);
    assert.equal(pill.logs.at(-1), "Camera sharing needs the Gemini subscription engine");
  });

  it("leaves the camera alone with no session running, and logs why", async () => {
    const pill = createFakePill();
    await pill.controller.apply({
      kind: PillActionKind.SET_CAMERA,
      isOn: true
    });
    await settle();
    assert.equal(pill.controller.view()?.isCameraShared, false);
    assert.equal(pill.logs.at(-1), "Camera sharing needs a running session");
  });
});
