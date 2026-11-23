import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PillActionKind } from "@gemini-live/protocol/view";

import { EngineKind, LiveStatus } from "@/contracts/live-engine.ts";
import { expectedView, LISTENING, started } from "@/pill/testing/expected-view.ts";
import { DESK, HEADSET } from "@/pill/testing/fake-deps.ts";
import { settle } from "@/pill/testing/fake-pill.ts";

describe("the API key prompt", () => {
  it("asks first when the engine needs a key and there is none", async () => {
    const pill = await started({
      engineKind: EngineKind.API_KEY,
      hasApiKey: false
    });
    assert.equal(pill.engines.length, 0);
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        status: LiveStatus.NEEDS_API_KEY,
        engine: EngineKind.API_KEY,
        isShown: true,
        isKeyPromptShown: true,
        isFocusable: true,
        microphones: [HEADSET, DESK]
      })
    );
  });

  it("saves a submitted key, hides the prompt and starts over", async () => {
    const pill = await started({
      engineKind: EngineKind.API_KEY,
      hasApiKey: false
    });
    await pill.controller.apply({
      kind: PillActionKind.SUBMIT_KEY,
      key: "AIza-secret"
    });
    await settle();
    assert.equal(pill.calls.includes("setApiKey AIza-secret"), true);
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        ...LISTENING,
        engine: EngineKind.API_KEY
      })
    );
    assert.equal(pill.engine.engine.kind, EngineKind.API_KEY);
  });

  it("goes back to Google when cancelled with no key to fall back on", async () => {
    const pill = await started({
      engineKind: EngineKind.API_KEY,
      hasApiKey: false
    });
    await pill.controller.apply({ kind: PillActionKind.CANCEL_KEY });
    await settle();
    assert.deepEqual(pill.controller.view(), expectedView(LISTENING));
    assert.equal(pill.engine.engine.kind, EngineKind.GOOGLE);
  });

  it("keeps the current key and engine when cancelled with a key saved", async () => {
    const pill = await started({ engineKind: EngineKind.API_KEY });
    await pill.controller.apply({ kind: PillActionKind.ASK_FOR_KEY });
    assert.equal(pill.controller.view()?.isKeyPromptShown, true);
    assert.equal(pill.controller.view()?.status, LiveStatus.LISTENING);
    assert.equal(pill.controller.view()?.isFocusable, true);
    await pill.controller.apply({ kind: PillActionKind.CANCEL_KEY });
    await settle();
    assert.equal(pill.controller.view()?.isKeyPromptShown, false);
    assert.equal(pill.controller.view()?.isFocusable, false);
    assert.equal(pill.controller.view()?.engine, EngineKind.API_KEY);
    assert.equal(pill.engines.length, 1);
  });

  it("stays focusable while the prompt waits, whatever the window asks", async () => {
    const pill = await started({ engineKind: EngineKind.API_KEY });
    await pill.controller.apply({ kind: PillActionKind.ASK_FOR_KEY });
    await pill.controller.apply({
      kind: PillActionKind.SET_FOCUSABLE,
      isFocusable: false
    });
    assert.equal(pill.controller.view()?.isFocusable, true);
  });
});

describe("the extension steps", () => {
  it("shows the steps after connecting, and hides them once it is no longer needed", async () => {
    const pill = await started();
    for (const listener of pill.listeners.extension) {
      listener(true);
    }

    await pill.controller.apply({ kind: PillActionKind.CONNECT_EXTENSION });
    assert.equal(pill.calls.includes("beginExtensionSetup"), true);
    assert.equal(pill.controller.view()?.isExtensionNeeded, true);
    assert.equal(pill.controller.view()?.isExtensionStepsShown, true);
    for (const listener of pill.listeners.extension) {
      listener(false);
    }

    await settle();
    assert.equal(pill.controller.view()?.isExtensionNeeded, false);
    assert.equal(pill.controller.view()?.isExtensionStepsShown, false);
  });

  it("ignores the need from a Google session winding down after a switch", async () => {
    const pill = await started({ engineKind: EngineKind.API_KEY });
    for (const listener of pill.listeners.extension) {
      listener(true);
    }

    await settle();
    assert.equal(pill.controller.view()?.isExtensionNeeded, false);
  });
});
