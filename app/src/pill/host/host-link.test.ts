import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PillActionKind, VIEW_NAME, WindowMessage } from "@gemini-live/protocol/view";
import type { PillView, WindowProtocol } from "@gemini-live/protocol/view";
import { defineMessaging } from "winui-svelte/messaging";
import { MessageType } from "winui-svelte/state/host";
import type { Json, StateProtocol } from "winui-svelte/state/host";

import { KeyTrigger } from "@/core/instance/key-trigger.ts";
import { linkedTransports } from "@/lib/transport/linked-transports.ts";
import { openPillLink } from "@/pill/host/host-link.ts";
import { createFakePill, settle } from "@/pill/test-fakes.ts";

function connect() {
  const transports = linkedTransports();
  const pill = createFakePill();
  const logs: string[] = [];
  const link = openPillLink({
    transport: transports.first,
    log: message => logs.push(message)
  });
  const window = defineMessaging<StateProtocol<Json> & WindowProtocol>({ transport: transports.second });
  const snapshots: unknown[] = [];
  const patches: unknown[] = [];
  const windowCalls: unknown[] = [];
  window.onMessage(MessageType.snapshot, message => {
    snapshots.push(message.data);
  });
  window.onMessage(MessageType.patch, message => {
    patches.push(message.data);
  });
  window.onMessage(WindowMessage.BRING_TO_FRONT, () => {
    windowCalls.push("bringToFront");
  });
  window.onMessage(WindowMessage.RESTORE_PREVIOUS_APP, () => {
    windowCalls.push("restorePreviousApp");
  });
  window.onMessage(WindowMessage.MOVE_BY, message => {
    windowCalls.push(message.data);
  });
  link.serve(pill.controller);
  return {
    pill,
    link,
    window,
    snapshots,
    patches,
    windowCalls,
    logs
  };
}

describe("the pill link", () => {
  it("sends the whole view first", async () => {
    const { snapshots, pill } = connect();
    await settle();
    assert.deepEqual(snapshots, [
      {
        name: VIEW_NAME,
        value: pill.controller.view()
      }
    ]);
  });

  it("sends a patch for a change, ahead of the answer to the action", async () => {
    const { window, patches, pill } = connect();
    await settle();
    await window.sendMessage(MessageType.action, { kind: PillActionKind.MUTE });
    assert.equal(patches.length, 1);
    assert.deepEqual(patches[0], {
      name: VIEW_NAME,
      ops: [
        {
          op: "set",
          path: ["isMuted"],
          value: true
        }
      ]
    });
    assert.equal(pill.controller.view()?.isMuted, true);
  });

  it("answers a refused action with its text", async () => {
    const { window } = connect();
    await settle();
    await assert.rejects(
      window.sendMessage(MessageType.action, {
        kind: PillActionKind.SHARE,
        displayId: "ghost"
      }),
      { message: "There is no display 'ghost'" }
    );
  });

  it("answers an invalid action with an error and logs it", async () => {
    const { window, logs } = connect();
    await settle();
    const invalid: Json = { kind: "nope" };
    await assert.rejects(window.sendMessage(MessageType.action, invalid));
    assert.equal(
      logs.some(message => message.startsWith("pill: refused an action")),
      true
    );
  });

  it("follows a conversation as patches", async () => {
    const { pill, patches } = connect();
    await pill.controller.onTrigger(KeyTrigger.TAP);
    await settle();
    const view: PillView | undefined = pill.controller.view();
    assert.equal(view?.isShown, true);
    assert.ok(patches.length > 0);
  });

  it("reaches the window for its own abilities", async () => {
    const { link, windowCalls } = connect();
    link.windowPort.bringToFront();
    link.windowPort.restorePreviousApp();
    const move = {
      deltaX: 4,
      deltaY: -2
    };
    link.windowPort.moveBy(move);
    await settle();
    assert.deepEqual(windowCalls, ["bringToFront", "restorePreviousApp", move]);
  });
});
