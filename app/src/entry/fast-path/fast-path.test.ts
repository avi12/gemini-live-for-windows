import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { KeyTrigger } from "@/core/instance/key-trigger.ts";

import { createCopilotMessageHook, triggerFromWParam, WM_COPILOT, WParam } from "./fast-path.ts";

const OUR_WINDOW = 0x1234n;
const UNDECLARED_WPARAM = 3n;
const NO_WINDOW = 0n;

function press({
  hwnd = OUR_WINDOW,
  id = WM_COPILOT,
  wParam = WParam.tap
}: {
  hwnd?: bigint;
  id?: number;
  wParam?: bigint;
}) {
  const triggers: KeyTrigger[] = [];
  const hook = createCopilotMessageHook({
    hwnd: OUR_WINDOW,
    onTrigger: trigger => triggers.push(trigger)
  });
  const isHandled = hook({
    hwnd,
    id,
    wParam,
    lParam: 0n
  });
  return {
    isHandled,
    triggers
  };
}

describe("triggerFromWParam", () => {
  it("maps the manifest's MessageWParam numbers", () => {
    assert.equal(triggerFromWParam(WParam.tap), KeyTrigger.TAP);
    assert.equal(triggerFromWParam(WParam.holdStart), KeyTrigger.HOLD_START);
    assert.equal(triggerFromWParam(WParam.holdStop), KeyTrigger.HOLD_STOP);
  });

  it("rejects numbers the manifest does not declare", () => {
    assert.equal(triggerFromWParam(UNDECLARED_WPARAM), undefined);
  });
});

describe("createCopilotMessageHook", () => {
  it("reports each trigger of our window and handles the message", () => {
    assert.deepEqual(press({ wParam: 1n }), {
      isHandled: true,
      triggers: [KeyTrigger.HOLD_START]
    });
  });

  it("ignores other messages, other windows and unknown values", () => {
    assert.deepEqual(press({ id: WM_COPILOT + 1 }), {
      isHandled: false,
      triggers: []
    });
    assert.deepEqual(press({ hwnd: NO_WINDOW }), {
      isHandled: false,
      triggers: []
    });
    assert.deepEqual(press({ wParam: 9n }), {
      isHandled: false,
      triggers: []
    });
  });
});
