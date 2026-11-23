import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PillActionKind, pillViewSchema } from "@gemini-live/protocol/view";
import type { PillView } from "@gemini-live/protocol/view";

import { LiveEventKind } from "@/contracts/live-engine.ts";
import { expectedView, started } from "@/pill/testing/expected-view.ts";
import { createFakePill, settle } from "@/pill/testing/fake-pill.ts";

describe("the pill view", () => {
  it("is a hidden, idle pill before anything happens", () => {
    const { controller } = createFakePill();
    assert.deepEqual(controller.view(), expectedView({ pillDisplay: null }));
  });

  it("always satisfies the protocol schema", async () => {
    const pill = await started();
    assert.equal(pillViewSchema.safeParse(pill.controller.view()).success, true);
  });

  it("has no update entry when run unpackaged", () => {
    const { controller } = createFakePill({ isPackaged: false });
    assert.equal(controller.view()?.update, null);
  });

  it("starts watching for updates and picks the saved microphone", () => {
    const { calls } = createFakePill();
    assert.deepEqual(calls, ["watch", "selectMicrophone null"]);
  });

  it("coalesces a burst of changes into one view", async () => {
    const pill = await started();
    const seen: PillView[] = [];
    pill.controller.subscribe(view => seen.push(view));
    seen.length = 0;
    pill.engine.emit({
      kind: LiveEventKind.STATUS,
      status: "one"
    });
    pill.engine.emit({
      kind: LiveEventKind.STATUS,
      status: "two"
    });
    pill.engine.emit({
      kind: LiveEventKind.STATUS,
      status: "three"
    });
    await settle();
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.status, "three");
  });

  it("tells a new subscriber the current view first", () => {
    const { controller } = createFakePill();
    const seen: PillView[] = [];
    controller.subscribe(view => seen.push(view));
    assert.deepEqual(seen, [expectedView({ pillDisplay: null })]);
  });
});

describe("window actions", () => {
  it("brings the window to the front when it asks to be focusable", async () => {
    const pill = await started();
    await pill.controller.apply({
      kind: PillActionKind.SET_FOCUSABLE,
      isFocusable: true
    });
    assert.equal(pill.controller.view()?.isFocusable, true);
    assert.equal(pill.calls.at(-1), "bringToFront");
    await pill.controller.apply({
      kind: PillActionKind.SET_FOCUSABLE,
      isFocusable: false
    });
    assert.equal(pill.controller.view()?.isFocusable, false);
  });

  it("moves the window by whole pixels", async () => {
    const pill = createFakePill();
    await pill.controller.apply({
      kind: PillActionKind.MOVE_BY,
      dx: 10.6,
      dy: -3.2
    });
    assert.equal(pill.calls.at(-1), "moveBy 11 -3");
  });

  it("opens a link by its normalized address", async () => {
    const pill = createFakePill();
    await pill.controller.apply({
      kind: PillActionKind.OPEN_LINK,
      uri: "https://Example.com"
    });
    assert.equal(pill.calls.at(-1), "open https://example.com/");
  });

  it("hands text to be copied to the clipboard as it is", async () => {
    const pill = createFakePill();
    await pill.controller.apply({
      kind: PillActionKind.COPY_TEXT,
      text: "שלום, hello"
    });
    assert.equal(pill.calls.at(-1), "copy שלום, hello");
  });

  it("ends the conversation and quits", async () => {
    const pill = await started();
    await pill.controller.apply({ kind: PillActionKind.QUIT });
    await settle();
    assert.equal(pill.calls.includes("quit"), true);
    assert.equal(pill.controller.view()?.isShown, false);
    assert.equal(pill.engine.calls.disposed, 1);
  });
});

describe("disposing", () => {
  it("stops listening", () => {
    const pill = createFakePill();
    pill.controller.dispose();
    assert.equal(pill.calls.includes("unwatch"), true);
    assert.equal(pill.listeners.displays.size, 0);
  });
});
