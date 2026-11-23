import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GlowMode, PillActionKind } from "@gemini-live/protocol/view";

import { EngineKind, LiveEventKind, LiveStatus } from "@/contracts/live-engine.ts";
import { KeyTrigger } from "@/core/instance/key-trigger.ts";
import { expectedView, LISTENING, started } from "@/pill/testing/expected-view.ts";
import { DESK, HEADSET } from "@/pill/testing/fake-deps.ts";
import { PRIMARY, SECONDARY } from "@/pill/testing/fake-monitors.ts";
import { createFakePill, settle } from "@/pill/testing/fake-pill.ts";

describe("starting a conversation", () => {
  it("shows the pill listening, unmuted and shared, on a tap", async () => {
    const pill = await started();
    assert.deepEqual(pill.controller.view(), expectedView(LISTENING));
    assert.equal(pill.engine.calls.started, 1);
    assert.equal(pill.engine.engine.isMuted, false);
    assert.deepEqual(pill.calls.slice(2), ["settle", "cover 1"]);
  });

  it("shows Connecting until the engine is up", async () => {
    const pill = createFakePill();
    const gate = Promise.withResolvers<void>();
    pill.prepareNextEngine({ gate: gate.promise });
    void pill.controller.onTrigger(KeyTrigger.TAP);
    await settle();
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        status: LiveStatus.CONNECTING,
        isShown: true,
        sharedDisplay: PRIMARY.deviceName,
        microphones: [HEADSET, DESK]
      })
    );
    gate.resolve();
    await settle();
    assert.equal(pill.controller.view()?.status, LiveStatus.LISTENING);
  });

  it("follows voice levels instead of breathing when the engine reports them", async () => {
    const pill = createFakePill();
    pill.prepareNextEngine({ reportsLevels: true });
    await pill.controller.onTrigger(KeyTrigger.TAP);
    await settle();
    assert.equal(pill.controller.view()?.glow.mode, GlowMode.REST);
    pill.engine.emit({
      kind: LiveEventKind.LEVEL,
      peak: 0.4349,
      isUser: false
    });
    await settle();
    assert.deepEqual(pill.controller.view()?.glow, {
      mode: GlowMode.LEVEL,
      level: 0.43,
      isUser: false
    });
  });

  it("starts on the active display", async () => {
    const pill = createFakePill();
    pill.world.active = SECONDARY;
    await pill.controller.onTrigger(KeyTrigger.HOLD_START);
    await settle();
    assert.equal(pill.controller.view()?.sharedDisplay, SECONDARY.deviceName);
  });

  it("clears the last session's captions", async () => {
    const pill = await started();
    pill.engine.emit({
      kind: LiveEventKind.TRANSCRIPT,
      text: "old",
      isUser: true
    });
    await pill.controller.apply({ kind: PillActionKind.END });
    await settle();
    await pill.controller.onTrigger(KeyTrigger.TAP);
    await settle();
    assert.deepEqual(pill.controller.view()?.lines, []);
  });
});

describe("a new session after muting", () => {
  it("never shows the old mute, not even while connecting", async () => {
    const pill = await started();
    await pill.controller.apply({ kind: PillActionKind.MUTE });
    await pill.controller.onTrigger(KeyTrigger.TAP);
    const seen: boolean[] = [];
    pill.controller.subscribe(view => seen.push(view.isMuted));
    seen.length = 0;
    await pill.controller.onTrigger(KeyTrigger.TAP);
    assert.deepEqual([...new Set(seen)], [false]);
  });
});

describe("switching engines", () => {
  it("restarts an open pill on the new engine", async () => {
    const pill = await started();
    await pill.controller.apply({
      kind: PillActionKind.SET_ENGINE,
      engine: EngineKind.API_KEY
    });
    await settle();
    assert.equal(pill.engines.length, 2);
    assert.equal(pill.engines[0]?.calls.disposed, 1);
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        ...LISTENING,
        engine: EngineKind.API_KEY
      })
    );
  });

  it("only saves the choice when the pill is closed", async () => {
    const pill = createFakePill();
    await pill.controller.apply({
      kind: PillActionKind.SET_ENGINE,
      engine: EngineKind.API_KEY
    });
    await settle();
    assert.equal(pill.engines.length, 0);
    assert.equal(pill.controller.view()?.engine, EngineKind.API_KEY);
    assert.equal(pill.controller.view()?.isShown, false);
  });

  it("does nothing for the engine already chosen", async () => {
    const pill = await started();
    await pill.controller.apply({
      kind: PillActionKind.SET_ENGINE,
      engine: EngineKind.GOOGLE
    });
    await settle();
    assert.equal(pill.engines.length, 1);
  });

  it("drops the extension panel when leaving Google", async () => {
    const pill = await started();
    for (const listener of pill.listeners.extension) {
      listener(true);
    }

    await settle();
    assert.equal(pill.controller.view()?.isExtensionNeeded, true);
    await pill.controller.apply({
      kind: PillActionKind.SET_ENGINE,
      engine: EngineKind.API_KEY
    });
    await settle();
    assert.equal(pill.controller.view()?.isExtensionNeeded, false);
  });
});
