import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PillActionKind } from "@gemini-live/protocol/view";

import { EngineKind, LiveEventKind, LiveStatus } from "@/contracts/live-engine.ts";
import { KeyTrigger } from "@/core/instance/key-trigger.ts";
import { expectedView, started } from "@/pill/testing/expected-view.ts";
import { DESK, HEADSET } from "@/pill/testing/fake-deps.ts";
import { createFakePill, settle } from "@/pill/testing/fake-pill.ts";

describe("the engine's events", () => {
  it("turns transcripts into lines and links", async () => {
    const pill = await started();
    pill.engine.emit({
      kind: LiveEventKind.TRANSCRIPT,
      text: "What is the news",
      isUser: true
    });
    pill.engine.emit({
      kind: LiveEventKind.TRANSCRIPT,
      text: "Try example.com",
      isUser: false
    });
    pill.engine.emit({
      kind: LiveEventKind.LINKS,
      links: [
        {
          title: "Weather",
          uri: "https://weather.example.com/tlv"
        }
      ]
    });
    await settle();
    const view = pill.controller.view();
    assert.deepEqual(view?.lines, [
      {
        id: "line-0",
        text: "What is the news",
        isUser: true,
        isNote: false
      },
      {
        id: "line-1",
        text: "Try example.com",
        isUser: false,
        isNote: false
      }
    ]);
    assert.deepEqual(view?.links, [
      {
        id: "link-2",
        title: "example.com",
        uri: "https://example.com",
        address: "example.com",
        isSearch: false,
        faviconUri: "https://www.google.com/s2/favicons?domain=example.com&sz=32"
      },
      {
        id: "link-3",
        title: "Weather",
        uri: "https://weather.example.com/tlv",
        address: "weather.example.com/tlv",
        isSearch: false,
        faviconUri: "https://www.google.com/s2/favicons?domain=weather.example.com&sz=32"
      }
    ]);
    assert.deepEqual(pill.logs, ["trigger Tap", "link: https://example.com", "link: https://weather.example.com/tlv"]);
  });

  it("shows the engine's own status", async () => {
    const pill = await started();
    pill.engine.emit({
      kind: LiveEventKind.STATUS,
      status: LiveStatus.RECONNECTING
    });
    await settle();
    assert.equal(pill.controller.view()?.status, LiveStatus.RECONNECTING);
  });

  it("keeps the pill up with the reason when the session ends", async () => {
    const pill = await started();
    pill.engine.emit({
      kind: LiveEventKind.ENDED,
      reason: "The connection dropped"
    });
    await settle();
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        status: LiveStatus.STOPPED,
        statusDetail: "The connection dropped",
        isShown: true,
        isMuted: false,
        microphones: [HEADSET, DESK],
        lines: [
          {
            id: "line-0",
            text: "The connection dropped",
            isUser: false,
            isNote: true
          }
        ]
      })
    );
    assert.equal(pill.engine.calls.disposed, 1);
    assert.equal(pill.calls.includes("hideBorder"), true);
  });

  it("ignores events from an engine that was replaced", async () => {
    const pill = await started();
    const first = pill.engine;
    await pill.controller.apply({
      kind: PillActionKind.SET_ENGINE,
      engine: EngineKind.API_KEY
    });
    await settle();
    first.emit({
      kind: LiveEventKind.ENDED,
      reason: "late"
    });
    await settle();
    assert.equal(pill.controller.view()?.status, LiveStatus.LISTENING);
    assert.deepEqual(pill.controller.view()?.lines, []);
  });
});

describe("a start that fails", () => {
  it("stops with the reason as status detail and a note", async () => {
    const pill = createFakePill();
    pill.prepareNextEngine({ fail: new Error("Gemini is unreachable") });
    await pill.controller.onTrigger(KeyTrigger.TAP);
    await settle();
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        status: LiveStatus.STOPPED,
        statusDetail: "Gemini is unreachable",
        isShown: true,
        microphones: [HEADSET, DESK],
        lines: [
          {
            id: "line-0",
            text: "Gemini is unreachable",
            isUser: false,
            isNote: true
          }
        ]
      })
    );
    assert.equal(pill.engine.calls.disposed, 1);
    assert.equal(pill.logs.includes("start failed: Gemini is unreachable"), true);
  });

  it("asks for a key when the failure is about the API key", async () => {
    const pill = createFakePill({ engineKind: EngineKind.API_KEY });
    pill.prepareNextEngine({ fail: new Error("The API key was rejected") });
    await pill.controller.onTrigger(KeyTrigger.TAP);
    await settle();
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        status: LiveStatus.NEEDS_API_KEY,
        statusDetail: "",
        engine: EngineKind.API_KEY,
        isShown: true,
        isKeyPromptShown: true,
        isFocusable: true,
        microphones: [HEADSET, DESK],
        lines: [
          {
            id: "line-0",
            text: "The API key was rejected",
            isUser: false,
            isNote: true
          }
        ]
      })
    );
  });

  it("says nothing when the session ended while it was connecting", async () => {
    const pill = createFakePill();
    const gate = Promise.withResolvers<void>();
    pill.prepareNextEngine({
      gate: gate.promise,
      fail: new Error("late failure")
    });
    void pill.controller.onTrigger(KeyTrigger.TAP);
    await settle();
    await pill.controller.apply({ kind: PillActionKind.END });
    gate.resolve();
    await settle();
    assert.equal(pill.controller.view()?.status, LiveStatus.CONNECTING);
    assert.equal(pill.controller.view()?.isShown, false);
    assert.deepEqual(pill.controller.view()?.lines, []);
  });
});
