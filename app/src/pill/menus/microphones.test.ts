import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PillActionKind } from "@gemini-live/protocol/view";

import { started } from "@/pill/testing/expected-view.ts";
import { DESK } from "@/pill/testing/fake-deps.ts";
import { settle } from "@/pill/testing/fake-pill.ts";

describe("the microphone menu", () => {
  it("lists the microphones on show and on refresh", async () => {
    const pill = await started();
    pill.world.microphones = [DESK];
    await pill.controller.apply({ kind: PillActionKind.REFRESH_MICROPHONES });
    await settle();
    assert.deepEqual(pill.controller.view()?.microphones, [DESK]);
  });

  it("saves a chosen microphone and tells the engine side", async () => {
    const pill = await started();
    await pill.controller.apply({
      kind: PillActionKind.SET_MICROPHONE,
      microphoneId: "mic-2"
    });
    assert.equal(pill.controller.view()?.microphoneId, "mic-2");
    assert.equal(pill.world.microphoneId, "mic-2");
    assert.equal(pill.calls.at(-1), "selectMicrophone mic-2");
    assert.equal(pill.logs.at(-1), "microphone -> Desk");
  });

  it("goes back to the Windows default", async () => {
    const pill = await started();
    await pill.controller.apply({
      kind: PillActionKind.SET_MICROPHONE,
      microphoneId: "mic-2"
    });
    await pill.controller.apply({
      kind: PillActionKind.SET_MICROPHONE,
      microphoneId: null
    });
    assert.equal(pill.controller.view()?.microphoneId, null);
    assert.equal(pill.logs.at(-1), "microphone -> Default (Windows)");
  });

  it("refuses a microphone that is not listed", async () => {
    const pill = await started();
    await assert.rejects(
      pill.controller.apply({
        kind: PillActionKind.SET_MICROPHONE,
        microphoneId: "ghost"
      }),
      { message: "There is no microphone 'ghost'" }
    );
    assert.equal(pill.controller.view()?.microphoneId, null);
  });
});
