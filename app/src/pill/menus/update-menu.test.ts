import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PillActionKind } from "@gemini-live/protocol/view";

import { UpdateCheck } from "@/core/updates/update-checker.ts";
import { INSTALLER_NOTE, NO_UPDATE, UNPACKAGED } from "@/pill/menus/update-menu.ts";
import { started } from "@/pill/testing/expected-view.ts";
import { createFakePill, settle } from "@/pill/testing/fake-pill.ts";

describe("updates", () => {
  it("offers a ready update and flags it available", async () => {
    const pill = createFakePill();
    pill.world.readyVersion = "2.0.0";
    for (const listener of pill.listeners.updates) {
      listener();
    }

    await settle();
    assert.deepEqual(pill.controller.view()?.update, {
      readyVersion: "2.0.0",
      isAutoUpdateOn: true
    });
  });

  it("opens the installer and leaves a note", async () => {
    const pill = await started();
    pill.world.readyVersion = "2.0.0";
    await pill.controller.apply({ kind: PillActionKind.UPDATE });
    assert.deepEqual(pill.controller.view()?.lines, [
      {
        id: "line-0",
        text: INSTALLER_NOTE,
        isUser: false,
        isNote: true
      }
    ]);
  });

  it("refuses to install when nothing is ready", async () => {
    const pill = createFakePill();
    pill.world.isInstallOk = false;
    await assert.rejects(pill.controller.apply({ kind: PillActionKind.UPDATE }), { message: NO_UPDATE });
  });

  it("says what a manual check found", async () => {
    const pill = createFakePill();
    await pill.controller.apply({ kind: PillActionKind.CHECK_FOR_UPDATES });
    await settle();
    assert.equal(pill.calls.includes("check true"), true);
    assert.equal(pill.controller.view()?.lines[0]?.text, "Gemini Live 1.0.0 is the latest version.");
    assert.equal(pill.controller.view()?.lines[0]?.isNote, true);
  });

  it("says a ready version, and a failure", async () => {
    const ready = createFakePill();
    ready.world.checkResult = UpdateCheck.READY;
    ready.world.readyVersion = "2.0.0";
    await ready.controller.apply({ kind: PillActionKind.CHECK_FOR_UPDATES });
    await settle();
    assert.equal(
      ready.controller.view()?.lines[0]?.text,
      "Version 2.0.0 is ready. Open the gear menu to restart into it."
    );

    const failed = createFakePill();
    failed.world.checkResult = UpdateCheck.FAILED;
    await failed.controller.apply({ kind: PillActionKind.CHECK_FOR_UPDATES });
    await settle();
    assert.equal(failed.controller.view()?.lines[0]?.text, "Couldn't get the update from GitHub.");
  });

  it("refuses to check when unpackaged", async () => {
    const pill = createFakePill({ isPackaged: false });
    await assert.rejects(pill.controller.apply({ kind: PillActionKind.CHECK_FOR_UPDATES }), { message: UNPACKAGED });
  });

  it("turns looking on its own off and on, looking right away when turned on", async () => {
    const pill = createFakePill();
    await pill.controller.apply({
      kind: PillActionKind.SET_AUTO_UPDATE,
      isOn: false
    });
    assert.equal(pill.controller.view()?.update?.isAutoUpdateOn, false);
    assert.equal(pill.calls.includes("check false"), false);
    await pill.controller.apply({
      kind: PillActionKind.SET_AUTO_UPDATE,
      isOn: true
    });
    await settle();
    assert.equal(pill.controller.view()?.update?.isAutoUpdateOn, true);
    assert.equal(pill.calls.includes("check false"), true);
  });
});
