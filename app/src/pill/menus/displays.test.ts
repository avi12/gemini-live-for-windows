import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PillActionKind } from "@gemini-live/protocol/view";

import { displayEntry, expectedView, LISTENING, started } from "@/pill/testing/expected-view.ts";
import { PRIMARY, SECONDARY } from "@/pill/testing/fake-monitors.ts";
import { createFakePill, settle } from "@/pill/testing/fake-pill.ts";

const SECONDARY_NAME = "Display 2 · 2560×1440";

describe("displays and sharing", () => {
  it("shares another display and moves the border to it", async () => {
    const pill = await started();
    await pill.controller.apply({
      kind: PillActionKind.SHARE,
      displayId: SECONDARY.deviceName
    });
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        ...LISTENING,
        sharedDisplay: SECONDARY.deviceName
      })
    );
    assert.equal(pill.calls.at(-1), "cover 2");
    assert.equal(pill.logs.at(-1), `sharing ${SECONDARY_NAME}`);
  });

  it("refuses a display that does not exist", async () => {
    const pill = await started();
    await assert.rejects(
      pill.controller.apply({
        kind: PillActionKind.SHARE,
        displayId: "ghost"
      }),
      { message: "There is no display 'ghost'" }
    );
  });

  it("does nothing to share with no conversation", async () => {
    const pill = createFakePill();
    await pill.controller.apply({
      kind: PillActionKind.SHARE,
      displayId: SECONDARY.deviceName
    });
    assert.equal(pill.controller.view()?.sharedDisplay, null);
  });

  it("moves the share to the active display when the shared one is unplugged", async () => {
    const pill = await started();
    await pill.controller.apply({
      kind: PillActionKind.SHARE,
      displayId: SECONDARY.deviceName
    });
    pill.world.displays = [PRIMARY];
    for (const listener of pill.listeners.displays) {
      listener();
    }

    await settle();
    assert.deepEqual(
      pill.controller.view(),
      expectedView({
        ...LISTENING,
        displays: [displayEntry(PRIMARY)]
      })
    );
    assert.equal(pill.logs.includes("displays changed: 1"), true);
  });

  it("re-shares a display that survived, since its bounds may have moved", async () => {
    const pill = await started();
    const movedPrimary = {
      ...PRIMARY,
      width: SECONDARY.width,
      height: SECONDARY.height
    };
    pill.world.displays = [movedPrimary, SECONDARY];
    for (const listener of pill.listeners.displays) {
      listener();
    }

    await settle();
    assert.equal(pill.calls.at(-1), "cover 1");
    assert.equal(pill.engine.engine.monitor.width, SECONDARY.width);
    assert.equal(pill.controller.view()?.displays[0]?.width, SECONDARY.width);
  });

  it("shows a changed display list even with no conversation", () => {
    const pill = createFakePill();
    pill.world.displays = [PRIMARY];
    for (const listener of pill.listeners.displays) {
      listener();
    }

    assert.equal(pill.controller.view()?.displays.length, 1);
  });
});
